import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { styles } from "../../lib/appStyles";
import { DESIGN } from "../../lib/design";
import { routeMetricsPreviewLabel, type RouteMetricsPreviewSnapshot } from "../../lib/routeMetricsPreviewLogic";

type Props = {
  originLabel: string;
  destinationLabel: string;
  /** Veřejné názvy průjezdních bodů; prázdné = přímá trasa. */
  viaLabels?: string[];
  preview: RouteMetricsPreviewSnapshot & { retry?: () => void | Promise<void> };
};

export function RouteMetricsPreviewCard({ originLabel, destinationLabel, viaLabels, preview }: Props) {
  if (!preview.pairKey && preview.status === "idle") {
    return (
      <View style={styles.routePreviewCard}>
        <Text style={styles.routePreviewTitle}>Náhled trasy</Text>
        <Text style={styles.routePreviewText}>Vyberte výchozí a cílové místo z nabídky.</Text>
      </View>
    );
  }

  if (preview.status === "loading") {
    return (
      <View style={styles.routePreviewCard}>
        <View style={styles.routePreviewRow}>
          <ActivityIndicator color={DESIGN.colors.primary} />
          <Text style={styles.routePreviewText}>Počítám trasu…</Text>
        </View>
      </View>
    );
  }

  if (preview.status === "success" && preview.metrics) {
    const label = routeMetricsPreviewLabel({ originLabel, destinationLabel, viaLabels, metrics: preview.metrics });
    return (
      <View style={[styles.routePreviewCard, styles.routePreviewSuccess]}>
        <Text style={styles.routePreviewTitle}>{label.title}</Text>
        <Text style={styles.routePreviewValue}>{label.summary}</Text>
      </View>
    );
  }

  const isRateLimited = preview.status === "rate_limited";
  return (
    <View style={styles.routePreviewCard}>
      <Text style={styles.routePreviewTitle}>{isRateLimited ? "Trasu teď nelze ověřit" : "Trasu se nepodařilo ověřit"}</Text>
      <Text style={styles.routePreviewText}>{preview.errorMessage || (isRateLimited ? "Počkejte chvíli a zkuste to znovu." : "Nejprve je potřeba ověřit trasu.")}</Text>
      <TouchableOpacity style={styles.routePreviewRetry} onPress={preview.retry} accessibilityRole="button" accessibilityLabel="Zkusit znovu ověřit trasu">
        <Text style={styles.routePreviewRetryText}>Zkusit znovu</Text>
      </TouchableOpacity>
    </View>
  );
}
