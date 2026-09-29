/**
 * Edge Function `google-routes` — bezpečný obal nad Google Routes API
 * (Compute Routes) pro RoadLink.
 *
 * Zásady (viz docs/address-routing-matching.md):
 *   * Google klíč existuje jen jako serverový secret (GOOGLE_MAPS_SERVER_API_KEY),
 *     klient ho nikdy nevidí a nikdy ho neposílá.
 *   * Klient posílá jen dvě ověřená place ID; URL, hlavičky ani field mask
 *     nedodává (jsou pevné v routeRequest.ts).
 *   * Vracíme pouze normalizovaná data: distanceMeters a durationSeconds,
 *     případně bezpečný chybový kód. Nikdy adresy, geometrii trasy ani place ID.
 *   * Do logu jde jen HTTP status a bezpečný kód — nikdy klíč, place ID,
 *     přesná adresa ani jiné osobní údaje.
 *   * Funkce vyžaduje platný JWT (supabase/config.toml → verify_jwt = true).
 *   * Neplatné JSON tělo je chyba klienta (400 invalid_request) — nikdy se
 *     nesmí mapovat na 502 upstream_unavailable a nikdy se neloguje.
 *
 * CORS/OPTIONS: existující `google-places` OPTIONS neobsluhuje (jen POST, jinak 405),
 * proto `google-routes` drží stejný vzor a žádné CORS hlavičky nepřidává.
 *
 * POZOR – NESMÍ BÝT NASAZENA DO PRODUKCE, dokud nebude rozhodnuto o rate limitu
 * (nebo jiné ochraně proti nadměrnému čerpání placeného Google Routes API).
 *
 * Funkce se v tomto kroku NEDEPLOYUJE — jen se připravuje.
 */

import {
  ROUTES_COMPUTE_URL,
  ROUTES_FIELD_MASK,
  ROUTES_TIMEOUT_MS,
  buildComputeRoutesBody,
  normalizeRouteMetrics,
  sanitizeRouteError,
  validateRouteRequest,
  type RouteFailure,
  type RouteMetrics,
  type RouteRequestInput,
} from "./routeRequest.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Načte JSON tělo požadavku. Neplatný JSON je chyba klienta (400), nikdy nesmí
 * spadnout do obecného catch bloku a vrátit 502 upstream_unavailable.
 * Obsah těla se nikdy neloguje ani nevrací klientovi.
 */
async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

type ComputeRoutesOutcome =
  | { ok: true; metrics: RouteMetrics }
  | ({ ok: false } & RouteFailure);

async function computeRoutes(input: RouteRequestInput): Promise<ComputeRoutesOutcome> {
  const apiKey = Deno.env.get("GOOGLE_MAPS_SERVER_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_MAPS_SERVER_API_KEY is not configured");

  const response = await fetch(ROUTES_COMPUTE_URL, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": ROUTES_FIELD_MASK,
    },
    body: JSON.stringify(buildComputeRoutesBody(input)),
    signal: AbortSignal.timeout(ROUTES_TIMEOUT_MS),
  });

  if (!response.ok) {
    const failure = sanitizeRouteError(response.status);
    // Logujeme jen status a bezpečný kód, nikdy tělo odpovědi ani vstup.
    console.error("Google Routes request failed", { status: response.status, code: failure.code });
    return { ok: false, ...failure };
  }

  const metrics = normalizeRouteMetrics(await response.json());
  if (!metrics) {
    return { ok: false, status: 404, code: "no_route", message: "No drivable route was found" };
  }

  return { ok: true, metrics };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: { code: "invalid_request", message: "Method not allowed" } }, 405);
  }

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) {
    return jsonResponse(
      { error: { code: "invalid_request", message: "Request body must be valid JSON" } },
      400,
    );
  }

  try {
    const validation = validateRouteRequest(parsedBody.body);
    if (!validation.ok) {
      return jsonResponse({ error: { code: validation.code, message: validation.message } }, validation.status);
    }

    const outcome = await computeRoutes(validation.value);
    if (!outcome.ok) {
      return jsonResponse({ error: { code: outcome.code, message: outcome.message } }, outcome.status);
    }

    return jsonResponse({ route: outcome.metrics });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("google-routes function failed", {
      reason: timedOut ? "timeout" : "unexpected",
    });
    return jsonResponse(
      { error: { code: "upstream_unavailable", message: "Route service is temporarily unavailable" } },
      502,
    );
  }
});
