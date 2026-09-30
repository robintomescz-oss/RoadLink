import { createClient } from "npm:@supabase/supabase-js@2";
import { parseBearerToken } from "../google-routes/requestAuth.ts";
import { resolveUserId } from "../google-routes/userIdentity.ts";
import { consumeGoogleRoutesRateLimit } from "../google-routes/rateLimit.ts";
import {
  MATCHING_COMPUTE_URL,
  MATCHING_FIELD_MASK,
  MATCHING_TIMEOUT_MS,
  MAX_MATCH_CANDIDATES,
  buildMatchingRouteBody,
  normalizeCandidate,
  normalizeMatchingMetrics,
  validateMatchingRequest,
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
    p_limit: MAX_MATCH_CANDIDATES,
  });
  if (error) {
    console.error("matching candidate lookup failed", { source: "candidate_rpc" });
    return json({ error: { code: "service_unavailable" } }, 503);
  }

  const candidates = (Array.isArray(data) ? data : []).map(normalizeCandidate).filter((item) => item !== null);
  const matches: Array<{ requestId: string; detourDistanceMeters: number; detourDurationSeconds: number; score: number; reasons: string[] }> = [];
  let incomplete = false;
  for (const candidate of candidates) {
    const limit = await consumeGoogleRoutesRateLimit(token);
    if (!limit.ok) return json({ error: { code: "rate_limit_unavailable" } }, 503);
    if (!limit.allowed) return json({ error: { code: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds } }, 429);

    try {
      const response = await fetch(MATCHING_COMPUTE_URL, {
        method: "POST",
        headers: { ...JSON_HEADERS, "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": MATCHING_FIELD_MASK },
        body: JSON.stringify(buildMatchingRouteBody(candidate)),
        signal: AbortSignal.timeout(MATCHING_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error("matching route calculation failed", { source: "google_upstream", status: response.status });
        incomplete = true;
        continue;
      }
      const metrics = normalizeMatchingMetrics(await response.json(), candidate);
      const maxMeters = Math.max(0, candidate.max_deviation_km || 0) * 1000;
      if (metrics && metrics.detourDistanceMeters <= maxMeters) matches.push(metrics);
    } catch {
      console.error("matching route calculation failed", { source: "google_upstream", reason: "unavailable" });
      incomplete = true;
    }
  }

  matches.sort((a, b) => b.score - a.score || a.detourDistanceMeters - b.detourDistanceMeters || a.requestId.localeCompare(b.requestId));
  return json({ matches, incomplete });
});
