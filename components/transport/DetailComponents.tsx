import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../../lib/theme";

const DETAIL_LOCAL_COLORS = {
  primaryShadow: "#061525",
  dangerBorder: "#F4B8B8",
  dangerSurface: "#FFF7F7",
} as const;

type DetailShellProps = {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
};

export function DetailShell({ title, onBack, children }: DetailShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.detailScreen}>
      <StatusBar style="dark" />
      <View style={[styles.detailTopBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity style={styles.detailBackButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Zpět">
          <Text style={styles.detailBackText}>‹ Zpět</Text>
        </TouchableOpacity>
        <Text style={styles.detailTopTitle}>{title}</Text>
        <View style={styles.detailTopSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.requestDetailContent, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

type DetailStatusHeaderProps = {
  label: string;
  statusLabel: string;
  vehicle: string;
  vehicleModel?: string | null;
  pickupLabel: string;
  destination: string;
  timingLabel: string;
  preferenceLabel?: string | null;
};

export function DetailStatusHeader({
  label,
  statusLabel,
  vehicle,
  vehicleModel,
  pickupLabel,
  destination,
  timingLabel,
  preferenceLabel,
}: DetailStatusHeaderProps) {
  return (
    <View style={styles.detailStatusCard}>
      <View style={styles.detailStatusTopRow}>
        <Text style={styles.detailEyebrow}>{label}</Text>
        <Text style={styles.detailStatusPill}>{statusLabel}</Text>
      </View>
      <Text style={styles.detailVehicleTitle}>{vehicle}</Text>
      {vehicleModel?.trim() ? <Text style={styles.detailSubtle}>{vehicleModel}</Text> : null}
      <View style={styles.detailRouteBlock}>
        <View style={styles.detailRoutePoint}>
          <View style={styles.detailRouteDot} />
          <View style={styles.detailRouteTextBlock}>
            <Text style={styles.detailRouteLabel}>Vyzvednutí</Text>
            <Text style={styles.detailRouteValue}>{pickupLabel}</Text>
          </View>
        </View>
        <View style={styles.detailRouteConnector} />
        <View style={styles.detailRoutePoint}>
          <View style={[styles.detailRouteDot, styles.detailRouteDotDestination]} />
          <View style={styles.detailRouteTextBlock}>
            <Text style={styles.detailRouteLabel}>Cíl</Text>
            <Text style={styles.detailRouteValue}>{destination}</Text>
          </View>
        </View>
      </View>
      <View style={styles.detailMetaStrip}>
        <Text style={styles.detailMetaLabel}>Termín</Text>
        <Text style={styles.detailMetaValue}>{timingLabel}</Text>
      </View>
      {preferenceLabel ? (
        <View style={styles.detailMetaStripMuted}>
          <Text style={styles.detailMetaLabel}>Preference</Text>
          <Text style={styles.detailMetaValue}>{preferenceLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

type DetailSectionProps = {
  title: string;
  children: React.ReactNode;
};

export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <View style={styles.detailCard}>
      <Text style={styles.detailSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

type DetailInfoRowProps = {
  label: string;
  value: React.ReactNode;
};

export function DetailInfoRow({ label, value }: DetailInfoRowProps) {
  if (value === null || value === undefined || value === "") return null;

  return (
    <View style={styles.detailInfoRow}>
      <Text style={styles.detailInfoLabel}>{label}</Text>
      <Text style={styles.detailInfoValue}>{value}</Text>
    </View>
  );
}

type DetailActionProps = {
  label: string;
  loadingLabel?: string;
  loading?: boolean;
  onPress: () => void;
};

export function DetailPrimaryAction({ label, loadingLabel, loading, onPress }: DetailActionProps) {
  return (
    <TouchableOpacity style={styles.detailPrimaryButton} disabled={loading} onPress={onPress}>
      <Text style={styles.detailPrimaryButtonText}>{loading && loadingLabel ? loadingLabel : label}</Text>
    </TouchableOpacity>
  );
}

type DetailSecondaryActionProps = DetailActionProps & {
  destructive?: boolean;
};

export function DetailSecondaryAction({ label, loadingLabel, loading, destructive = false, onPress }: DetailSecondaryActionProps) {
  return (
    <TouchableOpacity style={[styles.detailSecondaryButton, destructive && styles.detailDangerButton]} disabled={loading} onPress={onPress}>
      <Text style={[styles.detailSecondaryButtonText, destructive && styles.detailDangerButtonText]}>{loading && loadingLabel ? loadingLabel : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  requestDetailContent: { padding: spacing.xl, paddingTop: spacing.md, paddingBottom: 40, backgroundColor: colors.background },
  detailScreen: { flex: 1, backgroundColor: colors.background },
  detailTopBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailBackButton: { minHeight: 40, minWidth: 84, justifyContent: "center" },
  detailBackText: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  detailTopTitle: { flex: 1, color: colors.primaryText, fontSize: 17, fontWeight: "800", textAlign: "center" },
  detailTopSpacer: { width: 84 },
  detailStatusCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surface, shadowColor: DETAIL_LOCAL_COLORS.primaryShadow, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  detailStatusTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.sm },
  detailEyebrow: { color: colors.navy, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  detailStatusPill: { alignSelf: "flex-start", maxWidth: "48%", color: colors.navy, backgroundColor: colors.lightBlue, borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  detailVehicleTitle: { color: colors.primaryText, fontSize: 22, lineHeight: 28, fontWeight: "800" },
  detailSubtle: { color: colors.secondaryText, fontSize: 13, lineHeight: 18, marginTop: 3 },
  detailRouteBlock: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  detailRoutePoint: { flexDirection: "row", alignItems: "flex-start" },
  detailRouteDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navy, marginTop: 5, marginRight: spacing.md },
  detailRouteDotDestination: { backgroundColor: colors.actionBlue },
  detailRouteConnector: { width: 1, height: 18, marginLeft: 4.5, marginVertical: 3, backgroundColor: colors.border },
  detailRouteTextBlock: { flex: 1 },
  detailRouteLabel: { color: colors.secondaryText, fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  detailRouteValue: { color: colors.primaryText, fontSize: 16, lineHeight: 22, fontWeight: "700", marginTop: 2 },
  detailMetaStrip: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  detailMetaStripMuted: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, marginTop: spacing.sm },
  detailMetaLabel: { color: colors.secondaryText, fontSize: 12, fontWeight: "800" },
  detailMetaValue: { flex: 1, color: colors.primaryText, fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "right" },
  detailCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surface },
  detailSectionTitle: { color: colors.primaryText, fontSize: 15, fontWeight: "800", marginBottom: spacing.md },
  detailInfoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  detailInfoLabel: { flex: 0.42, color: colors.secondaryText, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  detailInfoValue: { flex: 0.58, color: colors.primaryText, fontSize: 14, lineHeight: 20, fontWeight: "600", textAlign: "right" },
  detailPrimaryButton: { minHeight: 54, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.actionBlue },
  detailPrimaryButtonText: { color: colors.surface, fontSize: 14, fontWeight: "800", letterSpacing: 0.2 },
  detailSecondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surface },
  detailSecondaryButtonText: { color: colors.primaryText, fontSize: 14, fontWeight: "800" },
  detailDangerButton: { borderColor: DETAIL_LOCAL_COLORS.dangerBorder, backgroundColor: DETAIL_LOCAL_COLORS.dangerSurface },
  detailDangerButtonText: { color: colors.danger },
});
