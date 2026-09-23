import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "../../lib/supabase";
import { geocodeAddress } from "../../lib/geocode";
import { canonicalVehicleType } from "../../lib/labels";
import { capacitySnapshot, resolvePrivateAddress, type CapacityErrorKey, validateCapacityForm } from "../../lib/createFormLogic";
import { FormBackHeader, FormSection, FieldError, ReviewRow } from "../../components/form/FormParts";
import { showDiscardDraftConfirmation } from "../../components/form/showDiscardDraftConfirmation";
import { validatePublicLocationLabel } from "../../lib/publicMarket";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { styles } from "../../lib/appStyles";
import { useFormBackGuard } from "../../hooks/useBackHandlers";

export default function RouteFormRoute() {
  const { userId, transportState } = useAppContext();
  const { loadRoutes } = transportState;
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [routeFromPublicLabel, setRouteFromPublicLabel] = useState("");
  const [routeToPublicLabel, setRouteToPublicLabel] = useState("");
  const [routeDepartureDate, setRouteDepartureDate] = useState<Date | null>(null);
  const [routeDepartureTime, setRouteDepartureTime] = useState<Date | null>(null);
  const [routeSpaces, setRouteSpaces] = useState("1");
  const [routeMaxDeviationKm, setRouteMaxDeviationKm] = useState("");
  const [routeVehicleTypes, setRouteVehicleTypes] = useState("Osobní automobil");
  const [routePrice, setRoutePrice] = useState("");
  const [routePriceMode, setRoutePriceMode] = useState<"fixed" | "negotiable">("fixed");
  const [routeDescription, setRouteDescription] = useState("");
  const [routeErrors, setRouteErrors] = useState<Partial<Record<CapacityErrorKey, string>>>({});
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [showRouteDatePicker, setShowRouteDatePicker] = useState(false);
  const [showRouteTimePicker, setShowRouteTimePicker] = useState(false);
  // Volitelné upřesnění přesných míst — ve výchozím stavu sbalené (soukromé).
  const [showPrecisePlaces, setShowPrecisePlaces] = useState(false);
  const routeScrollRef = useRef<ScrollView | null>(null);
  const initialSnapshotRef = useRef<string | null>(null);

  function currentRouteSnapshot() {
    return capacitySnapshot({ routeFrom, routeTo, fromPublicLabel: routeFromPublicLabel, toPublicLabel: routeToPublicLabel, routeDepartureDate, routeDepartureTime, routeSpaces, routeMaxDeviationKm, routeVehicleTypes, routePrice, routePriceMode, routeDescription });
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
    const validation = validateCapacityForm({ routeFrom, routeTo, fromPublicLabel: routeFromPublicLabel, toPublicLabel: routeToPublicLabel, routeDepartureDate, routeDepartureTime, routeSpaces, routeMaxDeviationKm, routeVehicleTypes, routePriceMode, routePrice });
    setRouteErrors(validation.errors);
    if (!validation.valid) {
      routeScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (creatingRoute) return;

    const deviationText = routeMaxDeviationKm.trim();
    const maxDeviationKm = deviationText === "" ? null : Number(deviationText);
    const availableSpaces = Number(routeSpaces);
    const price = routePrice.trim() === "" ? null : Number(routePrice);

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
      // Soukromá přesná místa: vyplněná hodnota, nebo bezpečný fallback =
      // zadané veřejné město/obec (DB sloupce a geocoding zůstávají beze změny).
      const fromAddress = resolvePrivateAddress(validatedFromPublic.value, routeFrom);
      const toAddress = resolvePrivateAddress(validatedToPublic.value, routeTo);
      const vehicleType = canonicalVehicleType(routeVehicleTypes);
      const [fromCoordinates, toCoordinates] = await Promise.all([geocodeAddress(fromAddress), geocodeAddress(toAddress)]);
      const departureAt = new Date(routeDepartureDate!);
      departureAt.setHours(routeDepartureTime!.getHours(), routeDepartureTime!.getMinutes(), 0, 0);
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
        max_deviation_km: maxDeviationKm,
        vehicle_types: [vehicleType],
        price: routePriceMode === "negotiable" ? null : price,
        description: routeDescription,
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
      setRouteMaxDeviationKm("");
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
          <Text style={styles.label}>Odkud – město/obec</Text>
          <Text style={styles.publicHintText}>Tento údaj bude viditelný veřejně.</Text>
          <TextInput style={styles.compactInput} value={routeFromPublicLabel} onChangeText={(value) => { setRouteFromPublicLabel(value); setRouteErrors((current) => ({ ...current, publicPlace: undefined, route: undefined })); }} placeholder="Např. Praha" maxLength={80} />
          <Text style={styles.label}>Kam – město/obec</Text>
          <Text style={styles.publicHintText}>Tento údaj bude viditelný veřejně.</Text>
          <TextInput style={styles.compactInput} value={routeToPublicLabel} onChangeText={(value) => { setRouteToPublicLabel(value); setRouteErrors((current) => ({ ...current, publicPlace: undefined, route: undefined })); }} placeholder="Např. Brno" maxLength={80} />
          <TouchableOpacity style={styles.expandToggle} onPress={() => setShowPrecisePlaces((current) => !current)} accessibilityRole="button" accessibilityState={{ expanded: showPrecisePlaces }} accessibilityLabel="Upřesnit přesné místo">
            <Text style={styles.expandToggleText}>{showPrecisePlaces ? "− Upřesnit přesné místo" : "+ Upřesnit přesné místo"}</Text>
          </TouchableOpacity>
          {showPrecisePlaces ? (
            <>
              <Text style={styles.label}>Přesné místo nakládky (soukromé)</Text>
              <TextInput style={styles.compactInput} value={routeFrom} onChangeText={(value) => { setRouteFrom(value); setRouteErrors((current) => ({ ...current, route: undefined })); }} placeholder="Místo odjezdu – ulice, číslo popisné" />
              <Text style={styles.label}>Přesné místo vykládky (soukromé)</Text>
              <TextInput style={styles.compactInput} value={routeTo} onChangeText={(value) => { setRouteTo(value); setRouteErrors((current) => ({ ...current, route: undefined })); }} placeholder="Cíl trasy – ulice, číslo popisné" />
              <Text style={styles.privateHintText}>Přesné místo je soukromé a zobrazí se pouze oprávněnému účastníkovi přepravy.</Text>
            </>
          ) : null}
          <FieldError message={routeErrors.route} />
          <FieldError message={routeErrors.publicPlace} />
        </FormSection>
        <FormSection title="Odjezd">
          <Text style={styles.label}>Datum odjezdu</Text>
          <TouchableOpacity style={styles.inlineSecondary} onPress={() => setShowRouteDatePicker(true)}><Text style={styles.secondaryText}>{routeDepartureDate ? routeDepartureDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text></TouchableOpacity>
          {showRouteDatePicker ? <DateTimePicker value={routeDepartureDate || new Date()} mode="date" display="default" onValueChange={(_, date) => { setShowRouteDatePicker(false); setRouteDepartureDate(date); setRouteErrors((current) => ({ ...current, departure: undefined })); }} onDismiss={() => setShowRouteDatePicker(false)} /> : null}
          <Text style={styles.label}>Přibližný čas odjezdu</Text>
          <TouchableOpacity style={styles.inlineSecondary} onPress={() => setShowRouteTimePicker(true)}><Text style={styles.secondaryText}>{routeDepartureTime ? `${String(routeDepartureTime.getHours()).padStart(2, "0")}:${String(routeDepartureTime.getMinutes()).padStart(2, "0")}` : "Vybrat čas"}</Text></TouchableOpacity>
          {showRouteTimePicker ? <DateTimePicker value={routeDepartureTime || new Date()} mode="time" display="default" onValueChange={(_, date) => { setShowRouteTimePicker(false); setRouteDepartureTime(date); setRouteErrors((current) => ({ ...current, departure: undefined })); }} onDismiss={() => setShowRouteTimePicker(false)} /> : null}
          <FieldError message={routeErrors.departure} />
        </FormSection>
        <FormSection title="Kapacita">
          <Text style={styles.label}>Počet volných míst</Text>
          <TextInput style={styles.compactInput} value={routeSpaces} onChangeText={(value) => { setRouteSpaces(value); setRouteErrors((current) => ({ ...current, capacity: undefined })); }} placeholder="Počet míst" keyboardType="numeric" />
          <Text style={styles.label}>Maximální odchylka od trasy · volitelné km</Text>
          <TextInput style={styles.compactInput} value={routeMaxDeviationKm} onChangeText={(value) => { setRouteMaxDeviationKm(value); setRouteErrors((current) => ({ ...current, capacity: undefined })); }} placeholder="Odchylka v km" keyboardType="numeric" accessibilityLabel="Maximální odchylka od trasy v km" />
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
          <ReviewRow label="Kapacita" value={`${routeSpaces || "0"} ${Number(routeSpaces) === 1 ? "místo" : Number(routeSpaces) >= 2 && Number(routeSpaces) <= 4 ? "místa" : "míst"}${routeMaxDeviationKm.trim() ? ` · odchylka ${routeMaxDeviationKm.trim()} km` : ""}`} />
          <ReviewRow label="Vozidla" value={routeVehicleTypes.trim() || "Neuvedeno"} />
          <ReviewRow label="Cena" value={routePriceMode === "negotiable" ? "Cena dohodou" : routePrice.trim() ? `${routePrice.trim()} Kč` : "Neuvedeno"} />
          <TouchableOpacity style={styles.primary} onPress={createRoute} disabled={creatingRoute} accessibilityLabel="Vytvořit nabídku volné kapacity"><Text style={styles.primaryText}>{creatingRoute ? "Ukládám…" : "Vytvořit nabídku trasy"}</Text></TouchableOpacity>
        </FormSection>
      </ScrollView>
    </SafeAreaView>
  );
}
