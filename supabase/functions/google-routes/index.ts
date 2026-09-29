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
 *   * Pořadí kontrol je závazné: metoda a JSON → ověření JWT a uživatele →
 *     validace place ID → atomické spotřebování rate limitu → Google Routes.
 *     Selže-li cokoli před posledním krokem, Google se nikdy nezavolá
 *     (fail-closed; žádné fail-open).
 *   * Identita uživatele se bere výhradně z ověřeného tokenu, nikdy z těla.
 *   * Lokální limit RoadLinku a Google 429 se v serverové diagnostice rozlišují
 *     (jiný `source` v logu); klient může zobrazit stejné bezpečné UX.
 *
 * CORS/OPTIONS: existující `google-places` OPTIONS neobsluhuje (jen POST, jinak 405),
 * proto `google-routes` drží stejný vzor a žádné CORS hlavičky nepřidává.
 *
 * Produkční nasazení je stále blokované, i když aplikační rate limit už je
 * navržený (migrace 0016 + rateLimit.ts). Chybí totiž:
 *   (a) Google Cloud denní kvóta pro Compute Routes,
 *   (b) rozpočtové upozornění na projekt,
 *   (c) integrační ověření migrace 0016 (souběh nad živou databází).
 * Do té doby funkce zůstává nenasazená.
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
import { AUTH_FAILURE, parseBearerToken } from "./requestAuth.ts";
import type { SafeFailure } from "./requestAuth.ts";
import { resolveUserId } from "./userIdentity.ts";
import {
  RATE_LIMITED,
  RATE_LIMIT_UNAVAILABLE,
  consumeGoogleRoutesRateLimit,
} from "./rateLimit.ts";

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
    // `source` rozlišuje Google upstream od lokálního limitu RoadLinku.
    console.error("Google Routes request failed", { source: "google_upstream", status: response.status, code: failure.code });
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

  const accessToken = parseBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return jsonResponse({ error: { code: AUTH_FAILURE.code, message: AUTH_FAILURE.message } }, AUTH_FAILURE.status);
  }

  // Ověření u Supabase Auth: identita se nikdy nebere z těla požadavku.
  // Ověřujeme ji i proto, aby se Google nevolal pro zrušené nebo smazané účty.
  const identity = await resolveUserId(accessToken);
  if (!identity.ok) {
    const failure: SafeFailure = identity.failure;
    // Rozlišíme „špatné přihlášení“ od výpadku Auth služby. Logujeme jen
    // bezpečný důvod, nikdy token, user ID ani původní chybu Auth.
    console.error("google-routes caller not verified", {
      source: "supabase_auth",
      reason: failure.code === "auth_unavailable" ? "unavailable" : "unauthorized",
    });
    // Ani limiter, ani Google se v žádném z těchto stavů nesmí zavolat.
    return jsonResponse({ error: { code: failure.code, message: failure.message } }, failure.status);
  }

  try {
    const validation = validateRouteRequest(parsedBody.body);
    if (!validation.ok) {
      return jsonResponse({ error: { code: validation.code, message: validation.message } }, validation.status);
    }

    // Limit se spotřebovává až po ověření identity a vstupu. Uživatel se
    // do RPC neposílá — identitu si databáze odvodí z téhož JWT (auth.uid()).
    const decision = await consumeGoogleRoutesRateLimit(accessToken);
    if (!decision.ok) {
      // Fail-closed: bez rozhodnutí o limitu se Google nesmí zavolat.
      console.error("google-routes rate limiter unavailable", { source: "roadlink_rate_limit", reason: "unavailable" });
      return jsonResponse(
        { error: { code: RATE_LIMIT_UNAVAILABLE.code, message: RATE_LIMIT_UNAVAILABLE.message } },
        RATE_LIMIT_UNAVAILABLE.status,
      );
    }
    if (!decision.allowed) {
      console.error("google-routes local rate limit reached", {
        source: "roadlink_rate_limit",
        retryAfterSeconds: decision.retryAfterSeconds,
      });
      return jsonResponse(
        {
          error: {
            code: RATE_LIMITED.code,
            message: RATE_LIMITED.message,
            retryAfterSeconds: decision.retryAfterSeconds,
          },
        },
        RATE_LIMITED.status,
      );
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
