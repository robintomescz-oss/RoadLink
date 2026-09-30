import { supabase } from "./supabase";

export type RouteMatch = {
  requestId: string;
  score: number;
  detourDistanceMeters: number;
  detourDurationSeconds: number;
  reasons: string[];
};

export type RouteMatchesResult =
  | { ok: true; matches: RouteMatch[]; incomplete: boolean }
  | { ok: false; code: "unauthorized" | "rate_limited" | "unavailable"; retryAfterSeconds?: number };

function safeNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseRouteMatch(value: unknown): RouteMatch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const score = safeNonNegativeNumber(row.score);
  const distance = safeNonNegativeNumber(row.detourDistanceMeters);
  const duration = safeNonNegativeNumber(row.detourDurationSeconds);
  if (typeof row.requestId !== "string" || !row.requestId || score === null || distance === null || duration === null) return null;
  if (!Array.isArray(row.reasons) || !row.reasons.every((reason) => typeof reason === "string" && reason.length <= 100)) return null;
  return {
    requestId: row.requestId,
    score: Math.round(score),
    detourDistanceMeters: Math.round(distance),
    detourDurationSeconds: Math.round(duration),
    reasons: row.reasons.slice(0, 6) as string[],
  };
}

export async function fetchRouteMatches(routeId: string): Promise<RouteMatchesResult> {
  const { data, error } = await supabase.functions.invoke("google-route-matches", { body: { routeId } });
  if (error) {
    const context = (error as { context?: { status?: number; json?: () => Promise<unknown> } }).context;
    if (context?.status === 401) return { ok: false, code: "unauthorized" };
    if (context?.status === 429) {
      let retryAfterSeconds: number | undefined;
      try {
        const payload = await context.json?.() as { error?: { retryAfterSeconds?: unknown } } | undefined;
        const value = payload?.error?.retryAfterSeconds;
        if (typeof value === "number" && Number.isFinite(value) && value > 0) retryAfterSeconds = Math.min(Math.ceil(value), 86400);
      } catch { /* bezpečný fallback bez detailů odpovědi */ }
      return { ok: false, code: "rate_limited", retryAfterSeconds };
    }
    return { ok: false, code: "unavailable" };
  }
  if (!data || typeof data !== "object") return { ok: false, code: "unavailable" };
  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.matches)) return { ok: false, code: "unavailable" };
  const matches = payload.matches.map(parseRouteMatch);
  if (matches.some((item) => item === null)) return { ok: false, code: "unavailable" };
  return { ok: true, matches: matches as RouteMatch[], incomplete: payload.incomplete === true };
}

export function routeMatchSummary(match: RouteMatch) {
  const km = Math.round(match.detourDistanceMeters / 1000);
  const minutes = Math.max(1, Math.round(match.detourDurationSeconds / 60));
  return `Skóre ${match.score} · +${km} km / ${minutes} min`;
}
