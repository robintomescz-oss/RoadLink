import type { RouteMetrics, RouteMetricsResult } from "./routeMetrics";
import { describeRouteMetricsError } from "./routeMetrics";

export type RouteMetricsPreviewStatus = "idle" | "loading" | "success" | "error" | "rate_limited";

export type RouteMetricsPreviewSnapshot = {
  status: RouteMetricsPreviewStatus;
  pairKey: string | null;
  metrics: RouteMetrics | null;
  errorMessage: string | null;
  retryAfterSeconds?: number;
  readyToSubmit: boolean;
};

export type FetchRouteMetrics = (input: {
  originPlaceId: string;
  destinationPlaceId: string;
  /** Průjezdní body v zadaném pořadí; prázdné pole = přímá trasa. */
  viaPlaceIds?: string[];
}) => Promise<RouteMetricsResult>;

type ControllerOptions = {
  fetchRouteMetrics: FetchRouteMetrics;
  onChange?: (snapshot: RouteMetricsPreviewSnapshot) => void;
  logger?: Pick<Console, "log" | "warn" | "error">;
};

const INITIAL_SNAPSHOT: RouteMetricsPreviewSnapshot = {
  status: "idle",
  pairKey: null,
  metrics: null,
  errorMessage: null,
  readyToSubmit: false,
};

/**
 * Klíč trasy pro cache a porovnání.
 *
 * Zahrnuje i průjezdní body: "Plzeň → Ostrava" a "Plzeň → Praha přes Ostrava"
 * mají stejný odjezd a cíl, ale jinou trasu a jinou vzdálenost. Bez `via` v klíči
 * by se druhá varianta vrátila z cache první.
 */
export function routePairKey(
  originPlaceId: string | null | undefined,
  destinationPlaceId: string | null | undefined,
  viaPlaceIds?: readonly string[] | null,
) {
  const origin = typeof originPlaceId === "string" ? originPlaceId.trim() : "";
  const destination = typeof destinationPlaceId === "string" ? destinationPlaceId.trim() : "";
  if (!origin || !destination) return null;
  const via = (viaPlaceIds ?? []).map((value) => String(value).trim()).filter(Boolean).join(",");
  return via ? `${origin}::${destination}::via:${via}` : `${origin}::${destination}`;
}

export function formatRouteDistanceKm(distanceMeters: number) {
  return `${Math.round(distanceMeters / 1000)} km`;
}

export function formatRouteDuration(durationSeconds: number) {
  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  if (totalMinutes <= 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function routeMetricsPreviewLabel(input: {
  originLabel: string | null | undefined;
  destinationLabel: string | null | undefined;
  viaLabels?: readonly string[] | null;
  metrics: RouteMetrics;
}) {
  const origin = input.originLabel?.trim() || "Odkud";
  const destination = input.destinationLabel?.trim() || "Kam";
  // "Cheb → Praha přes Plzeň" — průjezd je součást názvu trasy, ne samostatný řádek.
  const via = (input.viaLabels ?? []).map((value) => value.trim()).filter(Boolean).join(" přes ");
  const title = via ? `${origin} → ${destination} přes ${via}` : `${origin} → ${destination}`;
  return {
    title,
    summary: `${formatRouteDistanceKm(input.metrics.distanceMeters)} · přibližně ${formatRouteDuration(input.metrics.durationSeconds)}`,
  };
}

function safeErrorText(result: RouteMetricsResult) {
  if (result.ok) return null;
  if (result.code === "rate_limited") return "Služba tras je právě vytížená. Počkejte chvíli a zkuste to znovu.";
  return describeRouteMetricsError(result.code);
}

export function createRouteMetricsPreviewController(options: ControllerOptions) {
  let snapshot: RouteMetricsPreviewSnapshot = { ...INITIAL_SNAPSHOT };
  let originPlaceId: string | null = null;
  let destinationPlaceId: string | null = null;
  /** Průjezdní body v zadaném pořadí; prázdné = přímá trasa. */
  let viaPlaceIds: string[] = [];
  let sequence = 0;
  const successfulMetricsByPair = new Map<string, RouteMetrics>();
  const inFlightPairs = new Set<string>();

  function emit(next: RouteMetricsPreviewSnapshot) {
    snapshot = next;
    options.onChange?.(snapshot);
  }

  async function request(pairKey: string, _mode: "auto" | "retry") {
    if (inFlightPairs.has(pairKey)) return;

    // Průjezdní body neparsujeme zpět z klíče (jejich ID obsahují vlastní
    // oddělovače) — použijeme právě zvolenou dvojici včetně `via`.
    if (!originPlaceId || !destinationPlaceId) return;

    const via = viaPlaceIds;
    const requestSequence = ++sequence;
    inFlightPairs.add(pairKey);
    emit({ status: "loading", pairKey, metrics: null, errorMessage: null, readyToSubmit: false });

    try {
      const result = await options.fetchRouteMetrics({ originPlaceId, destinationPlaceId, viaPlaceIds: via });
      if (requestSequence !== sequence || routePairKey(originPlaceId, destinationPlaceId, via) !== pairKey) return;
      if (result.ok) {
        successfulMetricsByPair.set(pairKey, result.metrics);
        emit({ status: "success", pairKey, metrics: result.metrics, errorMessage: null, readyToSubmit: true });
      } else if (result.code === "rate_limited") {
        emit({
          status: "rate_limited",
          pairKey,
          metrics: null,
          errorMessage: safeErrorText(result),
          retryAfterSeconds: result.retryAfterSeconds,
          readyToSubmit: false,
        });
      } else {
        emit({ status: "error", pairKey, metrics: null, errorMessage: safeErrorText(result), readyToSubmit: false });
      }
    } catch (_error) {
      if (requestSequence !== sequence || routePairKey(originPlaceId, destinationPlaceId, via) !== pairKey) return;
      emit({ status: "error", pairKey, metrics: null, errorMessage: describeRouteMetricsError("unknown"), readyToSubmit: false });
    } finally {
      inFlightPairs.delete(pairKey);
    }
  }

  return {
    update(input: {
      originPlaceId: string | null | undefined;
      destinationPlaceId: string | null | undefined;
      viaPlaceIds?: readonly string[] | null;
    }) {
      originPlaceId = typeof input.originPlaceId === "string" ? input.originPlaceId.trim() || null : null;
      destinationPlaceId = typeof input.destinationPlaceId === "string" ? input.destinationPlaceId.trim() || null : null;
      viaPlaceIds = (input.viaPlaceIds ?? [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);
      const nextPairKey = routePairKey(originPlaceId, destinationPlaceId, viaPlaceIds);
      if (!nextPairKey) {
        sequence += 1;
        emit({ ...INITIAL_SNAPSHOT });
        return;
      }
      if (snapshot.pairKey === nextPairKey) {
        if (snapshot.status === "idle") void request(nextPairKey, "auto");
        return;
      }

      sequence += 1;
      const cachedMetrics = successfulMetricsByPair.get(nextPairKey);
      if (cachedMetrics) {
        emit({ status: "success", pairKey: nextPairKey, metrics: cachedMetrics, errorMessage: null, readyToSubmit: true });
        return;
      }

      emit({ status: "idle", pairKey: nextPairKey, metrics: null, errorMessage: null, readyToSubmit: false });
      void request(nextPairKey, "auto");
    },
    retry() {
      const currentPairKey = routePairKey(originPlaceId, destinationPlaceId, viaPlaceIds);
      if (!currentPairKey) {
        emit({ ...INITIAL_SNAPSHOT });
        return Promise.resolve();
      }
      return request(currentPairKey, "retry");
    },
    cancelPendingResponses() {
      sequence += 1;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}
