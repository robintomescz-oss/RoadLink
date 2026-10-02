import { useEffect, useRef, useState } from "react";
import { fetchRouteMetrics } from "../lib/routeMetrics";
import {
  createRouteMetricsPreviewController,
  type RouteMetricsPreviewSnapshot,
} from "../lib/routeMetricsPreviewLogic";

export function useRouteMetricsPreview(input: {
  originPlaceId: string | null | undefined;
  destinationPlaceId: string | null | undefined;
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

  useEffect(() => {
    controllerRef.current?.update(input);
  }, [input.originPlaceId, input.destinationPlaceId]);

  return {
    ...snapshot,
    retry: () => controllerRef.current?.retry(),
  };
}
