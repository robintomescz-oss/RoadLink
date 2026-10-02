export type MatchingRequestCandidate = {
  id: string;
  status: string;
  requestedDate: string | null;
  requestedEndDate: string | null;
  vehicleType: string | null;
  requiredSpaces?: number | null;
};

export type MatchingRouteCandidate = {
  id: string;
  status: string;
  departureAt: string | null;
  availableSpaces: number | null;
  maxDeviationKm: number | null;
  vehicleTypes: string[] | null;
};

export type MatchingDetour = {
  distanceMeters: number;
  durationSeconds: number;
};

export type MatchRejectionReason =
  | "not_open"
  | "missing_schedule"
  | "date_mismatch"
  | "vehicle_mismatch"
  | "insufficient_capacity"
  | "invalid_detour"
  | "deviation_exceeded";

export type MatchEvaluation =
  | {
      eligible: true;
      requestId: string;
      routeId: string;
      score: number;
      detourDistanceMeters: number;
      detourDurationSeconds: number;
      reasons: string[];
    }
  | {
      eligible: false;
      requestId: string;
      routeId: string;
      rejection: MatchRejectionReason;
    };

function normalizedVehicleType(value: string | null | undefined) {
  return (value || "").trim().toLocaleLowerCase("cs-CZ");
}

function isoDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function roundedKm(distanceMeters: number) {
  return Math.round(distanceMeters / 1000);
}

function roundedMinutes(durationSeconds: number) {
  return Math.max(1, Math.round(durationSeconds / 60));
}

export function evaluateTransportMatch(input: {
  request: MatchingRequestCandidate;
  route: MatchingRouteCandidate;
  detour: MatchingDetour;
}): MatchEvaluation {
  const { request, route, detour } = input;
  const rejected = (rejection: MatchRejectionReason): MatchEvaluation => ({
    eligible: false,
    requestId: request.id,
    routeId: route.id,
    rejection,
  });

  if (request.status !== "open" || route.status !== "open") return rejected("not_open");

  const requestedFrom = isoDate(request.requestedDate);
  const requestedTo = isoDate(request.requestedEndDate || request.requestedDate);
  const departureDate = isoDate(route.departureAt);
  if (!requestedFrom || !requestedTo || !departureDate) return rejected("missing_schedule");
  if (departureDate < requestedFrom || departureDate > requestedTo) return rejected("date_mismatch");

  const requestedVehicle = normalizedVehicleType(request.vehicleType);
  const supportedVehicles = (route.vehicleTypes || []).map(normalizedVehicleType).filter(Boolean);
  if (!requestedVehicle || !supportedVehicles.includes(requestedVehicle)) return rejected("vehicle_mismatch");

  const requiredSpaces = Math.max(1, Math.trunc(request.requiredSpaces || 1));
  if (!Number.isFinite(route.availableSpaces) || (route.availableSpaces as number) < requiredSpaces) {
    return rejected("insufficient_capacity");
  }

  if (
    !Number.isFinite(detour.distanceMeters) ||
    !Number.isFinite(detour.durationSeconds) ||
    detour.distanceMeters < 0 ||
    detour.durationSeconds < 0
  ) {
    return rejected("invalid_detour");
  }

  // Nevyplněná tolerance znamená přímou trasu bez povolené zajížďky.
  const maxDeviationKm = Math.max(0, route.maxDeviationKm || 0);
  const detourKm = detour.distanceMeters / 1000;
  if (detourKm > maxDeviationKm) return rejected("deviation_exceeded");

  const detourMinutes = detour.durationSeconds / 60;
  const exactDateBonus = requestedFrom === requestedTo ? 15 : 10;
  const spareCapacityBonus = Math.min(10, Math.max(0, (route.availableSpaces as number) - requiredSpaces) * 2);
  const score = Math.max(0, Math.round(100 + exactDateBonus + 10 + spareCapacityBonus - detourKm * 2 - detourMinutes / 10));

  return {
    eligible: true,
    requestId: request.id,
    routeId: route.id,
    score,
    detourDistanceMeters: Math.round(detour.distanceMeters),
    detourDurationSeconds: Math.round(detour.durationSeconds),
    reasons: [
      `+${roundedKm(detour.distanceMeters)} km / ${roundedMinutes(detour.durationSeconds)} min`,
      requestedFrom === requestedTo ? "termín přesně souhlasí" : "termín je v požadovaném okně",
      "vhodný typ vozidla",
      "dostatečná kapacita",
    ],
  };
}

export function rankTransportMatches(evaluations: MatchEvaluation[]) {
  return evaluations
    .filter((item): item is Extract<MatchEvaluation, { eligible: true }> => item.eligible)
    .sort((a, b) => b.score - a.score || a.detourDistanceMeters - b.detourDistanceMeters || a.routeId.localeCompare(b.routeId));
}
