import React from "react";
import { ScrollView, StatusBar as NativeStatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import TransportCard from "./TransportCard";
import { previewRequests, previewRoutes } from "./transportFixtures";

// Development-only visual preview of transport cards with fictional local
// data (long place names, missing optional values, status variants and cards
// with/without actions). Rendered only when App opens "transportPreview"
// behind __DEV__. No Supabase calls, no mutations, clearly labeled as preview.
function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function priceLabel(value: number | null): string | null {
  if (value === null) return null;
  return `${value.toLocaleString("cs-CZ")} Kč`;
}

export default function TransportPreviewScreen({ onBack }: { onBack: () => void }) {
  return (
    <View style={[s.root, { paddingTop: NativeStatusBar.currentHeight ?? 0 }]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.eyebrow}>NÁHLED — místní testovací data, ne živý feed</Text>
        <Text style={s.title}>TransportCard stavy</Text>
        <Text style={s.copy}>Fiktivní karty pokrývají dlouhé trasy, chybějící metadata, různé statusy a varianty s akcí i bez akce.</Text>

        {previewRequests.map((item) => (
          <TransportCard
            key={item.id}
            kind="request"
            badge={item.badge}
            route={`${item.pickupAddress ?? "Místo vyzvednutí neuvedeno"} → ${item.destination}`}
            vehicle={item.vehicle}
            meta={[formatDateTime(item.requestedDate), item.vehicleMobility]}
            status={item.status}
            actionLabel={item.actionLabel}
            accessibilityLabel={`Náhled karty ${item.id}`}
            onPress={item.actionable ? () => {} : undefined}
          />
        ))}

        {previewRoutes.map((route) => (
          <TransportCard
            key={route.id}
            kind="capacity"
            badge={route.badge}
            route={`${route.fromAddress} → ${route.toAddress}`}
            vehicle={route.vehicleTypes}
            meta={[
              route.departureAt ? `Odjezd: ${formatDateTime(route.departureAt)}` : null,
              route.maxDeviationKm !== null ? `Max. odchylka ${route.maxDeviationKm} km` : null,
              route.availableSpaces !== null ? `${route.availableSpaces} ${route.availableSpaces === 1 ? "volné místo" : "volná místa"}` : null,
              priceLabel(route.price),
            ]}
            status={route.status}
            actionLabel={route.actionLabel}
            accessibilityLabel={`Náhled karty ${route.id}`}
            onPress={route.actionable ? () => {} : undefined}
          />
        ))}

        <TouchableOpacity style={s.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Zpět na Přepravu">
          <Text style={s.backText}>‹ Zpět na Přepravu</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F6F8FB" },
  content: { padding: 20, paddingBottom: 96, backgroundColor: "#F6F8FB" },
  eyebrow: { color: "#667085", fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 8 },
  title: { color: "#17212B", fontSize: 22, lineHeight: 28, fontWeight: "800", marginBottom: 6 },
  copy: { color: "#667085", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  back: { marginTop: 16 },
  backText: { color: "#102A43", fontSize: 14, fontWeight: "700" },
});
