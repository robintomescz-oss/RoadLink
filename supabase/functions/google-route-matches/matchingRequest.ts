import { normalizePlaceId, parseDurationSeconds } from "../google-routes/routeRequest.ts";

export const MATCHING_COMPUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const MATCHING_FIELD_MASK = "routes.distanceMeters,routes.duration";
export const MATCHING_TIMEOUT_MS = 8000;
export const MAX_MATCH_CANDIDATES = 5;

export type MatchingCandidate = {
  route_id: string;
  route_origin_place_id: string;
  route_destination_place_id: string;
  route_distance_meters: number;
  route_duration_seconds: number;
  max_deviation_km: number | null;
  request_id: string;
  request_origin_place_id: string;
  request_destination_place_id: string;
};

export function validateMatchingRequest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const routeId = (body as Record<string, unknown>).routeId;
  return typeof routeId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(routeId.trim())
    ? { routeId: routeId.trim() }
    : null;
}

export function normalizeCandidate(value: unknown): MatchingCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const routeOrigin = normalizePlaceId(row.route_origin_place_id);
  const routeDestination = normalizePlaceId(row.route_destination_place_id);
  const requestOrigin = normalizePlaceId(row.request_origin_place_id);
  const requestDestination = normalizePlaceId(row.request_destination_place_id);
  if (!routeOrigin || !routeDestination || !requestOrigin || !requestDestination) return null;
  if (typeof row.route_id !== "string" || typeof row.request_id !== "string") return null;
  if (typeof row.route_distance_meters !== "number" || row.route_distance_meters < 0) return null;
  if (typeof row.route_duration_seconds !== "number" || row.route_duration_seconds < 0) return null;
  const maxDeviation = row.max_deviation_km === null ? null : Number(row.max_deviation_km);
  if (maxDeviation !== null && (!Number.isFinite(maxDeviation) || maxDeviation < 0)) return null;
  return {
    route_id: row.route_id,
    route_origin_place_id: routeOrigin,
    route_destination_place_id: routeDestination,
    route_distance_meters: Math.round(row.route_distance_meters),
    route_duration_seconds: Math.round(row.route_duration_seconds),
    max_deviation_km: maxDeviation,
    request_id: row.request_id,
    request_origin_place_id: requestOrigin,
    request_destination_place_id: requestDestination,
  };
}

export function buildMatchingRouteBody(candidate: MatchingCandidate) {
  return {
    origin: { placeId: candidate.route_origin_place_id },
    destination: { placeId: candidate.route_destination_place_id },
    intermediates: [
      { placeId: candidate.request_origin_place_id },
      { placeId: candidate.request_destination_place_id },
    ],
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    optimizeWaypointOrder: false,
    units: "METRIC",
    languageCode: "cs",
    regionCode: "cz",
  };
}

export function normalizeMatchingMetrics(payload: unknown, candidate: MatchingCandidate) {
  if (!payload || typeof payload !== "object") return null;
  const routes = (payload as Record<string, unknown>).routes;
  if (!Array.isArray(routes) || !routes[0] || typeof routes[0] !== "object") return null;
  const route = routes[0] as Record<string, unknown>;
  const distance = route.distanceMeters;
  const duration = parseDurationSeconds(route.duration);
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0 || duration === null) return null;
  const detourDistanceMeters = Math.max(0, Math.round(distance) - candidate.route_distance_meters);
  const detourDurationSeconds = Math.max(0, duration - candidate.route_duration_seconds);
  const score = Math.max(0, Math.round(110 - (detourDistanceMeters / 1000) * 2 - (detourDurationSeconds / 60) / 10));
  return {
    requestId: candidate.request_id,
    detourDistanceMeters,
    detourDurationSeconds,
    score,
    reasons: [
      `+${Math.round(detourDistanceMeters / 1000)} km / ${Math.max(1, Math.round(detourDurationSeconds / 60))} min`,
      "termín souhlasí",
      "vhodný typ vozidla",
      "dostatečná kapacita",
    ],
  };
}
