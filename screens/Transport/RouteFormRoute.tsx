import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "../../lib/supabase";
import { canonicalVehicleType } from "../../lib/labels";
import { buildRouteMetricsPayload, capacitySnapshot, normalizeViaPlaces, routeMetricsSubmitBlockReason, MAX_VIA_PLACES, type CapacityErrorKey, validateCapacityForm } from "../../lib/createFormLogic";
import { FormBackHeader, FormSection, FieldError, ReviewRow } from "../../components/form/FormParts";
import { RouteMetricsPreviewCard } from "../../components/form/RouteMetricsPreviewCard";
import { VerifiedLocationInput } from "../../components/form/VerifiedLocationInput";
import { showDiscardDraftConfirmation } from "../../components/form/showDiscardDraftConfirmation";
import { validatePublicLocationLabel } from "../../lib/publicMarket";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { styles } from "../../lib/appStyles";
import { useFormBackGuard } from "../../hooks/useBackHandlers";
import { useRouteMetricsPreview } from "../../hooks/useRouteMetricsPreview";
import type { VerifiedLocation } from "../../lib/verifiedLocation";

export default function RouteFormRoute() {
  const { userId, transportState } = useAppContext();
  const { loadRoutes } = transportState;
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [routeFromPublicLabel, setRouteFromPublicLabel] = useState("");
  const [routeToPublicLabel, setRouteToPublicLabel] = useState("");
  const [fromLocation, setFromLocation] = useState<VerifiedLocation | null>(null);
  const [toLocation, setToLocation] = useState<VerifiedLocation | null>(null);
  const [routeDepartureDate, setRouteDepartureDate] = useState<Date | null>(null);
  const [routeDepartureTime, setRouteDepartureTime] = useState<Date | null>(null);
  const [routeSpaces, setRouteSpaces] = useState("1");
  const [viaPlaces, setViaPlaces] = useState<VerifiedLocation[]>([]);
  const [routeVehicleTypes, setRouteVehicleTypes] = useState("Osobní automobil");
  const [routePrice, setRoutePrice] = useState("");
  const [routePriceMode, setRoutePriceMode] = useState<"fixed" | "negotiable">("fixed");
  const [routeDescription, setRouteDescription] = useState("");
  const [routeErrors, setRouteErrors] = useState<Partial<Record<CapacityErrorKey, string>>>({});
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [showRouteDatePicker, setShowRouteDatePicker] = useState(false);
  const [showRouteTimePicker, setShowRouteTimePicker] = useState(false);
  const routeScrollRef = useRef<ScrollView | null>(null);
  const initialSnapshotRef = useRef<string | null>(null);
  const routePreview = useRouteMetricsPreview({
    originPlaceId: fromLocation?.placeId ?? null,
    destinationPlaceId: toLocation?.placeId ?? null,
    viaPlaceIds: viaPlaces.map((place) => place.placeId),
  });
  const capacityRouteBlockReason = routeMetricsSubmitBlockReason({
    originPlaceId: fromLocation?.placeId ?? null,
    destinationPlaceId: toLocation?.placeId ?? null,
    preview: routePreview,
  });

  function currentRouteSnapshot() {
    return capacitySnapshot({ routeFrom, routeTo, fromPublicLabel: routeFromPublicLabel, toPublicLabel: routeToPublicLabel, routeDepartureDate, routeDepartureTime, routeSpaces, viaPlaces, routeVehicleTypes, routePrice, routePriceMode, routeDescription });
  }

  useEffect(() => {
    initialSnapshotRef.current = currentRouteSnapshot();
  }, []);

  function showDiscardDraftConfirmation(onDiscard: () => void) {
    Alert.alert("Zahodit rozepsané údaje?", "Máte rozepsané údaje. Pokud odejdete, změny se neuloží.", [
      { text: "Pokračovat v úpravách", style: "cancel" },
      { text: "Zahodit", style: "destructive", onPress: onDiscard },
    ]);
  }

  function leaveRouteForm() {
    const dirty = initialSnapshotRef.current !== null && currentRouteSnapshot() !== initialSnapshotRef.current;
    const leave = () => {
      setRouteErrors({});
      navigateLegacy("create");
    };
    if (!dirty || creatingRoute) leave();
    else showDiscardDraftConfirmation(leave);
  }

  // Hardwarové Zpět (Android) a horní ‹ Zpět sdílejí jednu cestu:
  // leaveRouteForm → čistý formulář odejde, rozepsaný ukáže discard dialog.
  useFormBackGuard(leaveRouteForm);

  async function createRoute() {
    if (!userId) return;
    const validation = validateCapacityForm({ routeFrom, routeTo, fromPublicLabel: routeFromPublicLabel, toPublicLabel: routeToPublicLabel, routeDepartureDate, routeDepartureTime, routeSpaces, routeVehicleTypes, routePriceMode, routePrice });
    setRouteErrors(validation.errors);
    if (!fromLocation || !toLocation) {
      setRouteErrors((current) => ({ ...current, route: "Vyberte obě ověřená místa z nabídky." }));
    }
    if (!validation.valid || !fromLocation || !toLocation) {
      routeScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (capacityRouteBlockReason) {
      setRouteErrors((current) => ({ ...current, route: capacityRouteBlockReason }));
      routeScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (creatingRoute) return;

    const availableSpaces = Number(routeSpaces);
    const price = routePrice.trim() === "" ? null : Number(routePrice);

    // Průjezdní body se normalizují znovu těsně před insertem, ne jen v UI:
    // tím se do databáze nedostane bod shodný s odjezdem/cílem ani duplikát.
    const viaPlaceIds = normalizeViaPlaces({
      viaPlaces,
      originPlaceId: fromLocation?.placeId ?? null,
      destinationPlaceId: toLocation?.placeId ?? null,
    });
    if (!viaPlaceIds) {
      setRouteErrors((current) => ({
        ...current,
        route: `Průjezdní body musí být různé od odjezdu a cíle (nejvýše ${MAX_VIA_PLACES}).`,
      }));
      return;
    }

    setCreatingRoute(true);
    try {
      // Veřejné labely (město/obec) — povinné, trimované, max 80 znaků;
      // validované validatePublicLocationLabel (bez e-mailu/URL/telefonu).
      // Nikdy se nepřepisují z přesné adresy — viz ROADLINK_AGENT_RULES.
      const validatedFromPublic = validatePublicLocationLabel(routeFromPublicLabel);
      const validatedToPublic = validatePublicLocationLabel(routeToPublicLabel);
      if (!validatedFromPublic.valid || !validatedToPublic.valid) {
        setRouteErrors((current) => ({ ...current, publicPlace: (validatedFromPublic.valid ? validatedToPublic.error : validatedFromPublic.error) ?? "Zadejte veřejné město/obec." }));
        return;
      }
      const fromAddress = fromLocation.formattedAddress;
      const toAddress = toLocation.formattedAddress;
      const vehicleType = canonicalVehicleType(routeVehicleTypes);
      const fromCoordinates = { latitude: fromLocation.latitude, longitude: fromLocation.longitude };
      const toCoordinates = { latitude: toLocation.latitude, longitude: toLocation.longitude };
      const routeMetricsPayload = buildRouteMetricsPayload({
        originPlaceId: fromLocation.placeId,
        destinationPlaceId: toLocation.placeId,
        preview: routePreview,
      });
      const departureAt = new Date(routeDepartureDate!);
      // Čas je volitelný: bez zadaného času odjíždí nabídka od půlnoci daného dne.
      const hours = routeDepartureTime ? routeDepartureTime.getHours() : 0;
      const minutes = routeDepartureTime ? routeDepartureTime.getMinutes() : 0;
      departureAt.setHours(hours, minutes, 0, 0);
      const { error } = await supabase.from("carrier_routes").insert({
        driver_id: userId,
        from_address: fromAddress,
        from_public_label: validatedFromPublic.value,
        from_lat: fromCoordinates?.latitude ?? null,
        from_lng: fromCoordinates?.longitude ?? null,
        to_address: toAddress,
        to_public_label: validatedToPublic.value,
        to_lat: toCoordinates?.latitude ?? null,
        to_lng: toCoordinates?.longitude ?? null,
        departure_at: departureAt.toISOString(),
        available_spaces: availableSpaces,
        via_place_ids: viaPlaceIds.length > 0 ? viaPlaceIds.map((place) => place.placeId) : null,
        via_public_labels: viaPlaceIds.length > 0 ? viaPlaceIds.map((place) => place.publicLabel) : null,
        vehicle_types: [vehicleType],
        price: routePriceMode === "negotiable" ? null : price,
        description: routeDescription,
        ...routeMetricsPayload,
        status: "open",
      });
      if (error) {
        console.error("Create carrier route:", error.message);
        Alert.alert("Chyba", "Trasu se nepodařilo uložit.");
        return;
      }
      await loadRoutes();
      setRouteDepartureDate(null);
      setRouteDepartureTime(null);
      setViaPlaces([]);
      Alert.alert("Trasa vytvořena", "Vaše nabídka volné trasy byla uložena.");
      setRouteErrors({});
      initialSnapshotRef.current = null;
      navigateLegacy("transport");
    } finally {
      setCreatingRoute(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <FormBackHeader title="Volná kapacita" onBack={leaveRouteForm} />
      <ScrollView ref={routeScrollRef} style={styles.scroll} contentContainerStyle={styles.requestContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.formIntroTitle}>Nová volná kapacita</Text>
        <Text style={styles.formIntroText}>Nabídněte volné místo na trase, kterou už plánujete jet.</Text>
        <FormSection title="Trasa">
          <Text style={styles.publicHintText}>Vyberte existující místo z nabídky. Veřejně se zobrazí pouze město nebo oblast; přesná adresa zůstane soukromá.</Text>
          <VerifiedLocationInput label="Místo odjezdu" placeholder="Začněte psát adresu nebo obec" value={fromLocation} onChange={(location) => { setFromLocation(location); setRouteFrom(location?.formattedAddress ?? ""); setRouteFromPublicLabel(location?.publicLabel ?? ""); setRouteErrors((current) => ({ ...current, publicPlace: undefined, route: undefined })); }} onError={(message) => setRouteErrors((current) => ({ ...current, route: message }))} />
          <VerifiedLocationInput label="Cíl trasy" placeholder="Začněte psát adresu nebo obec" value={toLocation} onChange={(location) => { setToLocation(location); setRouteTo(location?.formattedAddress ?? ""); setRouteToPublicLabel(location?.publicLabel ?? ""); setRouteErrors((current) => ({ ...current, publicPlace: undefined, route: undefined })); }} onError={(message) => setRouteErrors((current) => ({ ...current, route: message }))} />
          {viaPlaces.map((place, index) => (
            <View key={place.placeId} style={styles.viaRow}>
              <View style={styles.viaRowText}>
                <Text style={styles.viaRowTitle}>Přes {place.publicLabel}</Text>
              </View>
              <TouchableOpacity
                style={styles.viaRemove}
                onPress={() => setViaPlaces((current) => current.filter((_, position) => position !== index))}
                accessibilityRole="button"
                accessibilityLabel={`Odebrat průjezdní bod ${place.publicLabel}`}
              >
                <Text style={styles.viaRemoveText}>Odebrat</Text>
              </TouchableOpacity>
            </View>
          ))}
          {viaPlaces.length < MAX_VIA_PLACES ? (
            <VerifiedLocationInput
              label={viaPlaces.length === 0 ? "Průjezdní bod · volitelný" : "Další průjezdní bod · volitelný"}
              placeholder="Např. Plzeň"
              value={null}
              onChange={(location) => {
                if (!location) return;
                setViaPlaces((current) => (current.some((item) => item.placeId === location.placeId) ? current : [...current, location]));
                setRouteErrors((current) => ({ ...current, route: undefined }));
              }}
              onError={(message) => setRouteErrors((current) => ({ ...current, route: message }))}
            />
          ) : (
            <Text style={styles.publicHintText}>Maximum {MAX_VIA_PLACES} průjezdních bodů. Přebytečný bod odeberte tlačítkem Odebrat.</Text>
          )}
          <RouteMetricsPreviewCard originLabel={routeFromPublicLabel} destinationLabel={routeToPublicLabel} viaLabels={viaPlaces.map((place) => place.publicLabel)} preview={routePreview} />
          <FieldError message={routeErrors.route} />
          <FieldError message={routeErrors.publicPlace} />
        </FormSection>
        <FormSection title="Odjezd">
          <Text style={styles.label}>Datum odjezdu</Text>
          <TouchableOpacity style={styles.inlineSecondary} onPress={() => setShowRouteDatePicker(true)}><Text style={styles.secondaryText}>{routeDepartureDate ? routeDepartureDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text></TouchableOpacity>
          {showRouteDatePicker ? <DateTimePicker value={routeDepartureDate || new Date()} mode="date" display="default" onValueChange={(_, date) => { setShowRouteDatePicker(false); setRouteDepartureDate(date); setRouteErrors((current) => ({ ...current, departure: undefined })); }} onDismiss={() => setShowRouteDatePicker(false)} /> : null}
          <Text style={styles.label}>Přibližný čas odjezdu · volitelný</Text>
          <TouchableOpacity style={styles.inlineSecondary} onPress={() => setShowRouteTimePicker(true)}><Text style={styles.secondaryText}>{routeDepartureTime ? `${String(routeDepartureTime.getHours()).padStart(2, "0")}:${String(routeDepartureTime.getMinutes()).padStart(2, "0")}` : "Vybrat čas"}</Text></TouchableOpacity>
          {showRouteTimePicker ? <DateTimePicker value={routeDepartureTime || new Date()} mode="time" display="default" onValueChange={(_, date) => { setShowRouteTimePicker(false); setRouteDepartureTime(date); setRouteErrors((current) => ({ ...current, departure: undefined })); }} onDismiss={() => setShowRouteTimePicker(false)} /> : null}
          <FieldError message={routeErrors.departure} />
        </FormSection>
        <FormSection title="Kapacita">
          <Text style={styles.label}>Počet volných míst</Text>
          <TextInput style={styles.compactInput} value={routeSpaces} onChangeText={(value) => { setRouteSpaces(value); setRouteErrors((current) => ({ ...current, capacity: undefined })); }} placeholder="Počet míst" keyboardType="numeric" />
          <FieldError message={routeErrors.capacity} />
        </FormSection>
        <FormSection title="Přijímaná vozidla">
          <Text style={styles.label}>Typ vozidla</Text>
          <TextInput style={styles.compactInput} value={routeVehicleTypes} onChangeText={(value) => { setRouteVehicleTypes(value); setRouteErrors((current) => ({ ...current, vehicle: undefined })); }} placeholder="Typ vozidla" />
          <FieldError message={routeErrors.vehicle} />
        </FormSection>
        <FormSection title="Cena a poznámka">
          <View style={styles.chipGrid}>
            <TouchableOpacity style={[styles.selectChip, routePriceMode === "fixed" && styles.selectChipActive]} onPress={() => { setRoutePriceMode("fixed"); setRouteErrors((current) => ({ ...current, price: undefined })); }}><Text style={[styles.selectChipText, routePriceMode === "fixed" && styles.selectChipTextActive]}>Pevná cena</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.selectChip, routePriceMode === "negotiable" && styles.selectChipActive]} onPress={() => { setRoutePriceMode("negotiable"); setRouteErrors((current) => ({ ...current, price: undefined })); }}><Text style={[styles.selectChipText, routePriceMode === "negotiable" && styles.selectChipTextActive]}>Cena dohodou</Text></TouchableOpacity>
          </View>
          {routePriceMode === "fixed" ? <TextInput style={styles.compactInput} value={routePrice} onChangeText={(value) => { setRoutePrice(value); setRouteErrors((current) => ({ ...current, price: undefined })); }} placeholder="Cena v Kč" keyboardType="numeric" /> : null}
          <FieldError message={routeErrors.price} />
          <Text style={styles.label}>Poznámka</Text>
          <TextInput style={[styles.compactInput, styles.multilineInput]} value={routeDescription} onChangeText={setRouteDescription} placeholder="Doplňující informace" multiline />
        </FormSection>
        <FormSection title="Kontrola a odeslání">
          <ReviewRow label="Trasa" value={`${routeFromPublicLabel.trim() || "Odkud neuvedeno"} → ${routeToPublicLabel.trim() || "Kam neuvedeno"}`} />
          <ReviewRow label="Odjezd" value={`${routeDepartureDate ? routeDepartureDate.toLocaleDateString("cs-CZ") : "Datum neuvedeno"}${routeDepartureTime ? ` · ${String(routeDepartureTime.getHours()).padStart(2, "0")}:${String(routeDepartureTime.getMinutes()).padStart(2, "0")}` : ""}`} />
          <ReviewRow label="Kapacita" value={`${routeSpaces || "0"} ${Number(routeSpaces) === 1 ? "místo" : Number(routeSpaces) >= 2 && Number(routeSpaces) <= 4 ? "místa" : "míst"}`} />
          <ReviewRow label="Vozidla" value={routeVehicleTypes.trim() || "Neuvedeno"} />
          <ReviewRow label="Cena" value={routePriceMode === "negotiable" ? "Cena dohodou" : routePrice.trim() ? `${routePrice.trim()} Kč` : "Neuvedeno"} />
          <FieldError message={capacityRouteBlockReason ?? undefined} />
          <TouchableOpacity style={[styles.primary, (creatingRoute || Boolean(capacityRouteBlockReason)) && styles.primaryDisabled]} onPress={createRoute} disabled={creatingRoute || Boolean(capacityRouteBlockReason)} accessibilityLabel="Vytvořit nabídku volné kapacity"><Text style={styles.primaryText}>{creatingRoute ? "Ukládám…" : "Vytvořit nabídku trasy"}</Text></TouchableOpacity>
        </FormSection>
      </ScrollView>
    </SafeAreaView>
  );
}
