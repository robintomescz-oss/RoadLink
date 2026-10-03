import { createClient } from "npm:@supabase/supabase-js@2";
import { parseBearerToken } from "../google-routes/requestAuth.ts";
import { resolveUserId } from "../google-routes/userIdentity.ts";
import { consumeGoogleRoutesRateLimit } from "../google-routes/rateLimit.ts";
import {
  MATCHING_COMPUTE_URL,
  MATCHING_FIELD_MASK,
  MATCHING_MATRIX_FIELD_MASK,
  MATCHING_MATRIX_URL,
  MATCHING_TIMEOUT_MS,
  MAX_EXACT_VARIANTS_PER_CANDIDATE,
  MAX_MATCH_CANDIDATES,
  MAX_MATCH_ROUTE_CALLS,
  buildMatchFromDetour,
  buildMatchingMatrixBody,
  buildMatrixPoints,
  buildRouteCoordinateMap,
  buildRoutePlanningPoints,
  buildVariantRouteBody,
  computeVariantDetour,
  enumerateInsertionVariants,
  isWithinDeviation,
  normalizeCandidate,
  normalizeVariantComputation,
  parseMatchingMatrix,
  rankVariantsByApproximation,
  rankVariantsByCoordinates,
  selectBestVariantMatch,
  validateMatchingRequest,
  type EvaluatedVariant,
  type MatchingCandidate,
  type MatchingMetrics,
} from "./matchingRequest.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: { code: "invalid_request" } }, 405);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "invalid_request" } }, 400); }
  const validated = validateMatchingRequest(body);
  if (!validated) return json({ error: { code: "invalid_request" } }, 400);

  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) return json({ error: { code: "unauthorized" } }, 401);
  const identity = await resolveUserId(token);
  if (!identity.ok) return json({ error: { code: identity.failure.code } }, identity.failure.status);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleKey = Deno.env.get("GOOGLE_MAPS_SERVER_API_KEY");
  if (!supabaseUrl || !serviceKey || !googleKey) return json({ error: { code: "service_unavailable" } }, 503);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("get_route_matching_candidates_internal", {
    p_route_id: validated.routeId,
    p_driver_id: identity.userId,
    // RPC samo vrací nejbližší kandidáty podle vzdálenosti od celé trasy, takže
    // široké okno ani přenos zbytečných řádků už není potřeba.
    p_limit: MAX_MATCH_CANDIDATES,
  });
  if (error) {
    console.error("matching candidate lookup failed", { source: "candidate_rpc" });
    return json({ error: { code: "service_unavailable" } }, 503);
  }

  const working: MatchingCandidate[] = (Array.isArray(data) ? data : [])
    .map(normalizeCandidate)
    .filter((item) => item !== null);
  let incomplete = false;

  const matches: MatchingMetrics[] = [];
  // Rozpočet Google volání pro celý požadavek. Jakmile dojde, zbytek variant
  // i kandidátů se nevyhodnotí a výsledek se označí jako neúplný — nikdy se
  // nesmí tvářit jako kompletní „žádné shody".
  let routeCalls = 0;

  // Spotřebuje jeden slot limiteru a rozpočtu pro jedno Google volání.
  // "denied" na začátku požadavku (routeCalls === 0) je poctivá odpověď 429;
  // uprostřed výpočtu už raději vrátíme částečný výsledek jako neúplný.
  type GoogleCallResult =
    | { ok: true }
    | { ok: false; reason: "unavailable" }
    | { ok: false; reason: "denied"; startOfRequest: boolean; retryAfterSeconds: number };
  async function takeGoogleCall(): Promise<GoogleCallResult> {
    if (routeCalls >= MAX_MATCH_ROUTE_CALLS) {
      return { ok: false, reason: "denied", startOfRequest: routeCalls === 0, retryAfterSeconds: 60 };
    }
    const limit = await consumeGoogleRoutesRateLimit(token);
    if (!limit.ok) return { ok: false, reason: "unavailable" };
    if (!limit.allowed) {
      return { ok: false, reason: "denied", startOfRequest: routeCalls === 0, retryAfterSeconds: limit.retryAfterSeconds };
    }
    routeCalls += 1;
    return { ok: true };
  }

  outer: for (const candidate of working) {
    let variantBudgetExhausted = false;
    const allVariants = enumerateInsertionVariants(candidate);
    // Žádná přípustná varianta (např. nakládka je až za vykládkou) znamená,
    // že poptávku nelze na trasu vložit — kandidát se přeskočí.
    if (allVariants.length === 0) continue;

    let orderedVariants = allVariants;
    const basePoints = buildRoutePlanningPoints(candidate);
    if (allVariants.length > MAX_EXACT_VARIANTS_PER_CANDIDATE) {
      // 1) Nejdřív zdarma ze soukromých souřadnic (žádné Google volání).
      const coordinateMap = buildRouteCoordinateMap(candidate);
      if (coordinateMap) {
        orderedVariants = rankVariantsByCoordinates(coordinateMap, basePoints, allVariants);
      } else {
        // 2) Bez souřadnic zbývá dražší Route Matrix jako jeden slot.
        const call = await takeGoogleCall();
        if (!call.ok) {
          if (call.reason === "unavailable") return json({ error: { code: "rate_limit_unavailable" } }, 503);
          if (call.startOfRequest) return json({ error: { code: "rate_limited", retryAfterSeconds: call.retryAfterSeconds } }, 429);
          incomplete = true;
          variantBudgetExhausted = true;
          break;
        }

        const matrixPoints = buildMatrixPoints(candidate);
        try {
          const response = await fetch(MATCHING_MATRIX_URL, {
            method: "POST",
            headers: { ...JSON_HEADERS, "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": MATCHING_MATRIX_FIELD_MASK },
            body: JSON.stringify(buildMatchingMatrixBody(matrixPoints)),
            signal: AbortSignal.timeout(MATCHING_TIMEOUT_MS),
          });
          if (response.ok) {
            const table = parseMatchingMatrix(await response.json(), matrixPoints);
            if (table) {
              orderedVariants = rankVariantsByApproximation(basePoints, allVariants, table);
            } else {
              incomplete = true;
            }
          } else {
            console.error("matching matrix calculation failed", { source: "google_upstream", status: response.status });
            incomplete = true;
          }
        } catch {
          console.error("matching matrix calculation failed", { source: "google_upstream", reason: "unavailable" });
          incomplete = true;
        }
      }
    }

    const variants = orderedVariants.slice(0, MAX_EXACT_VARIANTS_PER_CANDIDATE);
    if (variants.length < allVariants.length) incomplete = true;

    const evaluated: EvaluatedVariant[] = [];
    for (const variant of variants) {
      // Obě místa poptávky už leží na plánované trase — zajížďka je nulová,
      // platí se jen z uložené metriky a Google se zbytečně nevolá.
      if (variant.zeroDetour) {
        evaluated.push({ variant, match: buildMatchFromDetour(candidate, { detourDistanceMeters: 0, detourDurationSeconds: 0 }) });
        continue;
      }

      const call = await takeGoogleCall();
      if (!call.ok) {
        if (call.reason === "unavailable") return json({ error: { code: "rate_limit_unavailable" } }, 503);
        if (call.startOfRequest) return json({ error: { code: "rate_limited", retryAfterSeconds: call.retryAfterSeconds } }, 429);
        incomplete = true;
        variantBudgetExhausted = true;
        break;
      }

      try {
        const response = await fetch(MATCHING_COMPUTE_URL, {
          method: "POST",
          headers: { ...JSON_HEADERS, "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": MATCHING_FIELD_MASK },
          body: JSON.stringify(buildVariantRouteBody(variant.sequence)),
          signal: AbortSignal.timeout(MATCHING_TIMEOUT_MS),
        });
        if (!response.ok) {
          console.error("matching route calculation failed", { source: "google_upstream", status: response.status });
          incomplete = true;
          continue;
        }
        const detour = computeVariantDetour(candidate, normalizeVariantComputation(await response.json()));
        if (detour) evaluated.push({ variant, match: buildMatchFromDetour(candidate, detour) });
      } catch {
        console.error("matching route calculation failed", { source: "google_upstream", reason: "unavailable" });
        incomplete = true;
      }
    }

    const best = selectBestVariantMatch(evaluated);
    if (best && isWithinDeviation(best.match, candidate)) matches.push(best.match);
    if (variantBudgetExhausted) break outer;
  }

  matches.sort((a, b) => b.score - a.score || a.detourDistanceMeters - b.detourDistanceMeters || a.requestId.localeCompare(b.requestId));
  return json({ matches, incomplete });
});
