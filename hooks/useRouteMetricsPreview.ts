import { useEffect, useRef, useState } from "react";
import { fetchRouteMetrics } from "../lib/routeMetrics";
import {
  createRouteMetricsPreviewController,
  type RouteMetricsPreviewSnapshot,
} from "../lib/routeMetricsPreviewLogic";

export function useRouteMetricsPreview(input: {
  originPlaceId: string | null | undefined;
  destinationPlaceId: string | null | undefined;
  viaPlaceIds?: readonly string[] | null;
}) {
  const mountedRef = useRef(false);
  const controllerRef = useRef<ReturnType<typeof createRouteMetricsPreviewController> | null>(null);
  const [snapshot, setSnapshot] = useState<RouteMetricsPreviewSnapshot>({
    status: "idle",
    pairKey: null,
    metrics: null,
    errorMessage: null,
    readyToSubmit: false,
  });

  if (!controllerRef.current) {
    controllerRef.current = createRouteMetricsPreviewController({
      fetchRouteMetrics,
      onChange: (nextSnapshot) => {
        if (mountedRef.current) setSnapshot(nextSnapshot);
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Přepočítá se i při změně průjezdních bodů. `via` je nové pole při každém
  // renderu, proto se porovnává jeho obsah, ne reference objektu.
  const viaKey = (input.viaPlaceIds ?? []).join(",");
  useEffect(() => {
    controllerRef.current?.update({ ...input, viaPlaceIds: viaKey ? viaKey.split(",") : [] });
  }, [input.originPlaceId, input.destinationPlaceId, viaKey]);

  return {
    ...snapshot,
    retry: () => controllerRef.current?.retry(),
  };
}
