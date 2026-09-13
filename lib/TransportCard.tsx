import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing } from "./theme";

// Shared presentation for transport overview cards (requests + available capacity).
// Data mapping and actions stay at the call site in App.tsx; this component
// only arranges: type badge, route (origin → destination), vehicle, metadata,
// status and an optional action affordance. It performs no data mutation.
export type TransportCardKind = "request" | "capacity";

type Props = {
  kind: TransportCardKind;
  badge: string;
  route: string;
  vehicle?: string | null;
  meta?: Array<string | null | undefined>;
  status?: string | null;
  actionLabel?: string | null;
  accessibilityLabel: string;
  onPress?: () => void;
};

function TransportCardContent({ kind, badge, route, vehicle, meta = [], status, actionLabel, onPress }: Props) {
  const metaLines = meta.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  const hasAction = Boolean(onPress || actionLabel);

  return (
    <>
      <View style={s.header}>
        <View style={[s.badge, kind === "capacity" ? s.badgeCapacity : s.badgeRequest]}>
          <Text style={[s.badgeText, kind === "capacity" ? s.badgeTextCapacity : s.badgeTextRequest]}>{badge}</Text>
        </View>
        {status ? <Text style={s.status} numberOfLines={2}>{status}</Text> : null}
      </View>
      <Text style={s.route} allowFontScaling>{route}</Text>
      {vehicle ? <Text style={s.vehicle} allowFontScaling>{vehicle}</Text> : null}
      {metaLines.length > 0 ? (
        <View style={s.metaBlock}>
          {metaLines.map((line, index) => (
            <Text key={`${line}-${index}`} style={s.meta} allowFontScaling>{line}</Text>
          ))}
        </View>
      ) : null}
      {hasAction ? (
        <View style={s.footer}>
          {actionLabel ? <Text style={s.action}>{actionLabel}</Text> : <View />}
          {onPress ? <Text style={s.arrow}>→</Text> : null}
        </View>
      ) : null}
    </>
  );
}

export default function TransportCard(props: Props) {
  if (props.onPress) {
    return (
      <TouchableOpacity style={s.card} onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}>
        <TransportCardContent {...props} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.card} accessibilityLabel={props.accessibilityLabel}>
      <TransportCardContent {...props} />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    shadowColor: colors.navy,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.xs, gap: spacing.sm, flexWrap: "wrap" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 8 },
  badgeRequest: { backgroundColor: colors.lightBlue },
  badgeCapacity: { backgroundColor: "#EAF7EF" },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.8 },
  badgeTextRequest: { color: colors.navy },
  badgeTextCapacity: { color: colors.success },
  status: { flexShrink: 1, color: colors.secondaryText, fontSize: 11, lineHeight: 15, fontWeight: "700", textAlign: "right", textTransform: "uppercase" },
  route: { color: colors.primaryText, fontSize: 16, lineHeight: 22, fontWeight: "800", marginTop: spacing.xs },
  vehicle: { color: colors.primaryText, fontSize: 14, lineHeight: 19, fontWeight: "600", marginTop: spacing.xs },
  metaBlock: { marginTop: spacing.xs },
  meta: { color: colors.secondaryText, fontSize: 12, lineHeight: 17, marginTop: 1 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, gap: spacing.sm },
  action: { color: colors.navy, fontSize: 12, lineHeight: 16, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  arrow: { color: colors.secondaryText, fontSize: 19, lineHeight: 22, fontWeight: "700" },
});
