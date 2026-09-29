/**
 * Klientský kontrakt pro Edge Function `google-routes`.
 *
 * Záměrně zatím NENÍ zapojen do odesílání formulářů ani do produkčních payloadů —
 * připravuje se pro krok, kdy se do poptávky/volné kapacity začnou ukládat
 * ověřené metriky trasy (viz docs/address-routing-matching.md a migrace 0015).
 *
 * Pravidla:
 *   * Klient posílá jen dvě ověřená place ID; URL ani hlavičky nevolí.
 *   * Klíč pro Google je pouze na serveru, klient ho nikdy nevidí.
 *   * Odpověď se normalizuje na distanceMeters/durationSeconds a bezpečný kód;
 *     texty z Google se klientovi nikdy nezobrazují.
 */

import { supabase } from "./supabase";

export const ROUTE_METRICS_FUNCTION = "google-routes";

export type RouteMetrics = {
  distanceMeters: number;
  durationSeconds: number;
};

export type RouteMetricsErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "auth_unavailable"
  | "no_route"
  | "rate_limited"
  | "rate_limit_unavailable"
  | "upstream_unavailable"
  | "unknown";

export type RouteMetricsResult =
  | { ok: true; metrics: RouteMetrics }
  | { ok: false; code: RouteMetricsErrorCode; message: string; retryAfterSeconds?: number };

const ERROR_CODES: RouteMetricsErrorCode[] = [
  "invalid_request",
  "unauthorized",
  "auth_unavailable",
  "no_route",
  "rate_limited",
  "rate_limit_unavailable",
  "upstream_unavailable",
  "unknown",
];

/** Stejný strop jako na serveru — delší čekání klientovi nikdy nezobrazujeme. */
export const MAX_RETRY_AFTER_SECONDS = 86400;

function normalizeSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  return null;
}

/** Bezpečné, uživatelsky srozumitelné texty — nikdy nepropouštíme chybu z Google. */
export function describeRouteMetricsError(code: RouteMetricsErrorCode): string {
  switch (code) {
    case "invalid_request":
      return "Vybrané místo se nepodařilo ověřit. Zvolte prosím adresu znovu.";
    case "unauthorized":
      return "Přihlaste se prosím znovu a zkuste to.";
    case "auth_unavailable":
      // Přihlášení uživatele je v pořádku — nenabádáme k odhlášení.
      return "Ověření přihlášení je dočasně nedostupné. Zkuste to prosím znovu.";
    case "no_route":
      return "Pro tato dvě místa se nepodařilo najít trasu.";
    case "rate_limited":
      return "Služba tras je právě vytížená. Zkuste to prosím za chvíli.";
    case "rate_limit_unavailable":
      return "Ochranu proti přetížení služby tras se teď nepodařilo ověřit.";
    default:
      return "Vzdálenost a dobu trasy se teď nepodařilo zjistit.";
  }
}

/**
 * Normalizuje `retryAfterSeconds` z odpovědi. Serveru se nevěří naslepo:
 * nečíselné, nulové i záporné hodnoty se zahazují, příliš velké se zastřihnou.
 */
export function normalizeRetryAfterSeconds(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return undefined;

  const rounded = Math.ceil(numeric);
  if (rounded < 1) return undefined;

  return Math.min(rounded, MAX_RETRY_AFTER_SECONDS);
}

function errorCodeFrom(value: unknown): RouteMetricsErrorCode {
  if (typeof value !== "string") return "unknown";
  return (ERROR_CODES as string[]).includes(value) ? (value as RouteMetricsErrorCode) : "unknown";
}

/**
 * Normalizuje odpověď Edge Function. Čistá funkce bez sítě — testuje se izolovaně.
 */
export function parseRouteMetricsResponse(payload: unknown): RouteMetricsResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "unknown", message: describeRouteMetricsError("unknown") };
  }

  const record = payload as Record<string, unknown>;

  if (record.error) {
    const error = typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : null;
    const code = errorCodeFrom(error?.code);
    const retryAfterSeconds = normalizeRetryAfterSeconds(error?.retryAfterSeconds);
    return {
      ok: false,
      code,
      message: describeRouteMetricsError(code),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }

  const route = typeof record.route === "object" && record.route !== null
    ? (record.route as Record<string, unknown>)
    : null;
  const distanceMeters = route?.distanceMeters;
  const durationSeconds = normalizeSeconds(route?.durationSeconds);

  if (
    typeof distanceMeters !== "number" ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    durationSeconds === null
  ) {
    return { ok: false, code: "unknown", message: describeRouteMetricsError("unknown") };
  }

  return {
    ok: true,
    metrics: { distanceMeters: Math.round(distanceMeters), durationSeconds },
  };
}

/**
 * Zavolá chráněnou Edge Function. Připraveno pro budoucí krok — dnes tuto funkci
 * žádná obrazovka nevolá a formuláře ji nepoužívají.
 */
export async function fetchRouteMetrics(input: {
  originPlaceId: string;
  destinationPlaceId: string;
}): Promise<RouteMetricsResult> {
  const { data, error } = await supabase.functions.invoke(ROUTE_METRICS_FUNCTION, {
    body: {
      originPlaceId: input.originPlaceId,
      destinationPlaceId: input.destinationPlaceId,
    },
  });

  if (error) {
    return { ok: false, code: "upstream_unavailable", message: describeRouteMetricsError("upstream_unavailable") };
  }

  return parseRouteMetricsResponse(data);
}
