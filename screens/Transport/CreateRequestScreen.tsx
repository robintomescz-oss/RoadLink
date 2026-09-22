import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { FieldError, FormBackHeader, FormSection, ReviewRow } from "../../components/form/FormParts";
import { showDiscardDraftConfirmation } from "../../components/form/showDiscardDraftConfirmation";
import { useAppContext, type RequestDraft } from "../../contexts/AppContext";
import { supabase } from "../../lib/supabase";
import { styles } from "../../lib/appStyles";
import type { Job } from "../../lib/types";
import { canonicalVehicleType, formatPostgresDate } from "../../lib/labels";
import { coordinatesFromValues, geocodeAddress } from "../../lib/geocode";
import {
  LOADING_STATE_OPTIONS,
  loadingOptionToFields,
  requestSnapshot,
  resolvePrivateAddress,
  validateRequestForm,
  type LoadingStateOption,
  type RequestErrorKey,
} from "../../lib/createFormLogic";
import { validatePublicLocationLabel } from "../../lib/publicMarket";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useFormBackGuard } from "../../hooks/useBackHandlers";

const INITIAL_LOADING_STATE: LoadingStateOption = "drive";

/**
 * screen === "request" z App.tsx.
 * Formulářový stav je lokální. Nepřenesené jsou stavy timePreference,
 * vehicleMobility a canTrailer: v originále se jen zapisovaly a nikde nečetly
 * (createJob bere hodnoty z loadingOptionToFields).
 */
export default function CreateRequestScreen() {
  const {
    userId,
    requestDraft,
    setRequestDraft,
    setActiveJobId,
    setTransportTab,
    locationState: { requestLocation },
    transportState: { setJobs, setCustomerRequests, loadJobs, loadCustomerRequests },
  } = useAppContext();

  // Poslední hodnoty z minula (viz RequestDraft v AppContextu).
  const [pickupText, setPickupText] = useState(requestDraft.pickupText);
  const [destination, setDestination] = useState(requestDraft.destination);
  const [pickupPublicLabel, setPickupPublicLabel] = useState(requestDraft.pickupPublicLabel);
  const [destinationPublicLabel, setDestinationPublicLabel] = useState(requestDraft.destinationPublicLabel);
  const [vehicle, setVehicle] = useState(requestDraft.vehicle);
  const [problem, setProblem] = useState(requestDraft.problem);

  // Při každém otevření začínají prázdné (jako dřív v openRequestFlow).
  const [requestedDate, setRequestedDate] = useState<Date | null>(null);
  const [requestedEndDate, setRequestedEndDate] = useState<Date | null>(null);
  const [dateMode, setDateMode] = useState<"concrete" | "window">("concrete");
  const [requestVehicleModel, setRequestVehicleModel] = useState("");
  const [loadingStateOption, setLoadingStateOption] = useState<LoadingStateOption | null>(INITIAL_LOADING_STATE);
  const [requestErrors, setRequestErrors] = useState<Partial<Record<RequestErrorKey, string>>>({});
  const [requestInitialSnapshot, setRequestInitialSnapshot] = useState<string | null>(() =>
    requestSnapshot({
      pickupText: requestDraft.pickupText,
      destination: requestDraft.destination,
      pickupPublicLabel: requestDraft.pickupPublicLabel,
      destinationPublicLabel: requestDraft.destinationPublicLabel,
      vehicle: requestDraft.vehicle,
      problem: requestDraft.problem,
      requestedDate: null,
      requestedEndDate: null,
      dateMode: "concrete",
      loadingState: INITIAL_LOADING_STATE,
      requestVehicleModel: "",
    })
  );
  const requestScrollRef = useRef<ScrollView | null>(null);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  // Volitelné upřesnění přesných míst — ve výchozím stavu sbalené (soukromé).
  const [showPrecisePlaces, setShowPrecisePlaces] = useState(false);

  // Při zavření formuláře (jakýmkoli způsobem) vrátíme poslední hodnoty do kontextu.
  const draftRef = useRef<RequestDraft>({ pickupText, destination, pickupPublicLabel, destinationPublicLabel, vehicle, problem });
  draftRef.current = { pickupText, destination, pickupPublicLabel, destinationPublicLabel, vehicle, problem };
  useEffect(() => () => setRequestDraft(draftRef.current), []);

  // Dřív efekt na `screen` v App: při vstupu na obrazovku se obnoví poloha.
  useEffect(() => {
    requestLocation();
  }, []);

  function currentRequestSnapshot() {
    return requestSnapshot({
      pickupText,
      destination,
      pickupPublicLabel,
      destinationPublicLabel,
      vehicle,
      problem,
      requestedDate,
      requestedEndDate,
      dateMode,
      loadingState: loadingStateOption,
      requestVehicleModel,
    });
  }

  function applyLoadingState(option: LoadingStateOption) {
    setLoadingStateOption(option);
    setRequestErrors((current) => ({ ...current, loading: undefined }));
  }

  function leaveRequestForm() {
    const dirty = requestInitialSnapshot !== null && currentRequestSnapshot() !== requestInitialSnapshot;
    const leave = () => {
      setRequestErrors({});
      navigateLegacy("create");
    };
    if (!dirty || creatingRequest) leave();
    else showDiscardDraftConfirmation(leave);
  }

  // Hardwarové tlačítko Zpět (Android) a horní ‹ Zpět sdílejí jednu cestu:
  // leaveRequestForm → čistý formulář odejde, rozepsaný ukáže discard dialog.
  useFormBackGuard(leaveRequestForm);

  async function createJob() {
    if (!userId) {
      Alert.alert(
        "RoadLink",
        "Probíhá připojování k účtu. Zkuste to za chvíli."
      );
      return;
    }

    if (creatingRequest) return;

    const validation = validateRequestForm({
      pickupText,
      destination,
      pickupPublicLabel,
      destinationPublicLabel,
      requestedDate,
      requestedEndDate,
      dateMode,
      vehicle,
      loadingState: loadingStateOption,
    });
    setRequestErrors(validation.errors);
    if (!validation.valid) {
      requestScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    const loadingMapping = loadingOptionToFields(loadingStateOption || "unknown");
    let endDate: Date = requestedDate!;
    if (dateMode === "window" && requestedEndDate) {
      endDate = requestedEndDate;
    }

    setCreatingRequest(true);
    try {
      // Veřejné labely (město/obec) — povinné, trimované, max 80 znaků;
      // validované validatePublicLocationLabel (bez e-mailu/URL/telefonu).
      // Nikdy se nepřepisují z přesné adresy — viz ROADLINK_AGENT_RULES.
      const validatedPickupPublic = validatePublicLocationLabel(pickupPublicLabel);
      const validatedDestinationPublic = validatePublicLocationLabel(destinationPublicLabel);
      if (!validatedPickupPublic.valid || !validatedDestinationPublic.valid) {
        setRequestErrors((current) => ({ ...current, publicPlace: (validatedPickupPublic.valid ? validatedDestinationPublic.error : validatedPickupPublic.error) ?? "Zadejte veřejné město/obec." }));
        return;
      }
      // Soukromá přesná adresa: vyplněná hodnota, nebo bezpečný fallback =
      // zadané veřejné město/obec (DB sloupce a geocoding zůstávají beze změny).
      const trimmedPickupAddress = resolvePrivateAddress(validatedPickupPublic.value, pickupText);
      const trimmedDestination = resolvePrivateAddress(validatedDestinationPublic.value, destination);
      const [pickupCoordinates, destinationCoordinates] = await Promise.all([
        geocodeAddress(trimmedPickupAddress),
        geocodeAddress(trimmedDestination),
      ]);

      const { data, error } = await supabase
        .from("tow_requests")
        .insert({
          customer_id: userId,
          pickup_address: trimmedPickupAddress,
          pickup_public_label: validatedPickupPublic.value,
          pickup_lat: pickupCoordinates?.latitude ?? null,
          pickup_lng: pickupCoordinates?.longitude ?? null,
          destination_address: trimmedDestination || "Servis dle domluvy",
          destination_public_label: validatedDestinationPublic.value,
          destination_lat: destinationCoordinates?.latitude ?? null,
          destination_lng: destinationCoordinates?.longitude ?? null,
          vehicle_type: canonicalVehicleType(vehicle),
          vehicle_model: requestVehicleModel.trim() || null,
          problem_description: problem.trim() || null,
          requested_date: formatPostgresDate(requestedDate!),
          date_to: formatPostgresDate(endDate),
          requested_time: null,
          time_preference: "specific",
          vehicle_mobility: loadingMapping.vehicle_mobility,
          can_drive_onto_trailer: loadingMapping.can_drive_onto_trailer,
          status: "open",
        })
        .select()
        .single();

      if (error || !data) {
        console.error("Create tow request:", error?.message);
        Alert.alert(
          "Chyba",
          "Zakázku se nepodařilo uložit do RoadLinku."
        );
        return;
      }

      const job: Job = {
        id: data.id,
        customerName: "Uživatel RoadLink",
        customerId: data.customer_id || userId,
        vehicle: canonicalVehicleType(data.vehicle_type || vehicle),
        problem: data.problem_description || "",
        pickup: coordinatesFromValues(data.pickup_lat, data.pickup_lng) ?? pickupCoordinates,
        pickupAddress: data.pickup_address || trimmedPickupAddress,
        destination:
          data.destination_address || "Servis dle domluvy",
        destinationCoordinates:
          coordinatesFromValues(data.destination_lat, data.destination_lng) ?? destinationCoordinates,
        status: data.status,
        timePreference: data.time_preference || "specific",
        requestedDate: data.requested_date || null,
        requestedEndDate: data.date_to || null,
        requestedTime: data.requested_time || null,
        vehicleMobility: data.vehicle_mobility || loadingMapping.vehicle_mobility,
        vehicleModel: data.vehicle_model || null,
        canTrailer: data.can_drive_onto_trailer ?? loadingMapping.can_drive_onto_trailer,
        createdAt: data.created_at || "",
      };

      setJobs((current) => [job, ...current]);
      setCustomerRequests((current) => [job, ...current]);
      setActiveJobId(job.id);
      setTransportTab("mine");
      await loadJobs();
      await loadCustomerRequests();

      setPickupText(trimmedPickupAddress);
      draftRef.current = { ...draftRef.current, pickupText: trimmedPickupAddress };
      setRequestInitialSnapshot(null);
      setRequestErrors({});
      navigateLegacy("requestSuccess");
    } finally {
      setCreatingRequest(false);
    }
  }

  const loadingLabel = loadingStateOption ? loadingOptionToFields(loadingStateOption).label : "Vyberte stav nakládky";

  return (
    <SafeAreaView style={styles.container}>
      <FormBackHeader title="Poptávka přepravy" onBack={leaveRequestForm} />
      <ScrollView ref={requestScrollRef} style={styles.scroll} contentContainerStyle={styles.requestContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.formIntroTitle}>Nová poptávka</Text>
        <Text style={styles.formIntroText}>Zadejte trasu, termín a stav vozidla. Odeslání vytvoří poptávku v Trhu přepravy.</Text>

        <FormSection title="Trasa">
          <Text style={styles.label}>Odkud – město/obec</Text>
          <Text style={styles.publicHintText}>Tento údaj bude viditelný veřejně.</Text>
          <TextInput style={styles.compactInput} value={pickupPublicLabel} onChangeText={(value) => { setPickupPublicLabel(value); setRequestErrors((current) => ({ ...current, publicPlace: undefined, route: undefined })); }} placeholder="Např. Praha" maxLength={80} returnKeyType="next" />
          <Text style={styles.label}>Kam – město/obec</Text>
          <Text style={styles.publicHintText}>Tento údaj bude viditelný veřejně.</Text>
          <TextInput style={styles.compactInput} value={destinationPublicLabel} onChangeText={(value) => { setDestinationPublicLabel(value); setRequestErrors((current) => ({ ...current, publicPlace: undefined, route: undefined })); }} placeholder="Např. Brno" maxLength={80} returnKeyType="next" />
          <TouchableOpacity style={styles.expandToggle} onPress={() => setShowPrecisePlaces((current) => !current)} accessibilityRole="button" accessibilityState={{ expanded: showPrecisePlaces }} accessibilityLabel="Upřesnit přesné místo">
            <Text style={styles.expandToggleText}>{showPrecisePlaces ? "− Upřesnit přesné místo" : "+ Upřesnit přesné místo"}</Text>
          </TouchableOpacity>
          {showPrecisePlaces ? (
            <>
              <Text style={styles.label}>Přesné místo nakládky (soukromé)</Text>
              <TextInput style={styles.compactInput} value={pickupText} onChangeText={(value) => { setPickupText(value); setRequestErrors((current) => ({ ...current, route: undefined })); }} placeholder="Např. Praha, ulice a číslo popisné" returnKeyType="next" />
              <Text style={styles.label}>Přesné místo vykládky (soukromé)</Text>
              <TextInput style={styles.compactInput} value={destination} onChangeText={(value) => { setDestination(value); setRequestErrors((current) => ({ ...current, route: undefined })); }} placeholder="Např. Brno, ulice a číslo popisné" returnKeyType="next" />
              <Text style={styles.privateHintText}>Přesné místo je soukromé a zobrazí se pouze oprávněnému účastníkovi přepravy.</Text>
            </>
          ) : null}
          <FieldError message={requestErrors.route} />
          <FieldError message={requestErrors.publicPlace} />
          <TouchableOpacity style={styles.inlineSecondary} onPress={requestLocation} accessibilityLabel="Použít aktuální polohu">
            <Text style={styles.secondaryText}>⌖ Použít aktuální polohu</Text>
          </TouchableOpacity>
        </FormSection>

        <FormSection title="Termín">
          <View style={styles.chipGrid}>
            <TouchableOpacity style={[styles.selectChip, dateMode === "concrete" && styles.selectChipActive]} onPress={() => { setDateMode("concrete"); setRequestErrors((current) => ({ ...current, date: undefined })); }}>
              <Text style={[styles.selectChipText, dateMode === "concrete" && styles.selectChipTextActive]}>Konkrétní datum</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.selectChip, dateMode === "window" && styles.selectChipActive]} onPress={() => { setDateMode("window"); setRequestErrors((current) => ({ ...current, date: undefined })); }}>
              <Text style={[styles.selectChipText, dateMode === "window" && styles.selectChipTextActive]}>Časové okno</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.label}>{dateMode === "window" ? "Od" : "Datum přepravy"}</Text>
          <TouchableOpacity style={[styles.inlineSecondary, styles.inlinePicker]} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.secondaryText}>{requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text>
          </TouchableOpacity>
          {showDatePicker ? (
            <DateTimePicker value={requestedDate || new Date()} mode="date" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowDatePicker(false); if (event.type === "set" && date) { setRequestedDate(date); setRequestErrors((current) => ({ ...current, date: undefined })); } }} />
          ) : null}
          {dateMode === "window" ? (
            <>
              <Text style={styles.label}>Do</Text>
              <TouchableOpacity style={[styles.inlineSecondary, styles.inlinePicker]} onPress={() => setShowEndDatePicker(true)}>
                <Text style={styles.secondaryText}>{requestedEndDate ? requestedEndDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text>
              </TouchableOpacity>
              {showEndDatePicker ? (
                <DateTimePicker value={requestedEndDate || requestedDate || new Date()} mode="date" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowEndDatePicker(false); if (event.type === "set" && date) { setRequestedEndDate(date); setRequestErrors((current) => ({ ...current, date: undefined })); } }} />
              ) : null}
            </>
          ) : null}
          <FieldError message={requestErrors.date} />
        </FormSection>

        <FormSection title="Vozidlo">
          <View style={styles.chipGrid}>
            {["Osobní automobil", "SUV / 4x4", "Motocykl", "Dodávka", "Užitkové", "Ostatní"].map((value) => (
              <TouchableOpacity key={value} style={[styles.selectChip, vehicle === value && styles.selectChipActive]} onPress={() => { setVehicle(value); setRequestErrors((current) => ({ ...current, vehicle: undefined })); }}>
                <Text style={[styles.selectChipText, vehicle === value && styles.selectChipTextActive]}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <FieldError message={requestErrors.vehicle} />
          <Text style={styles.label}>Značka a model · volitelné</Text>
          <TextInput style={styles.compactInput} value={requestVehicleModel} onChangeText={setRequestVehicleModel} placeholder="Škoda Octavia" />
        </FormSection>

        <FormSection title="Stav vozidla pro nakládku">
          {LOADING_STATE_OPTIONS.map((item) => (
            <TouchableOpacity key={item.option} style={[styles.optionCard, loadingStateOption === item.option && styles.optionCardActive]} onPress={() => applyLoadingState(item.option)} accessibilityRole="button">
              <Text style={[styles.optionTitle, loadingStateOption === item.option && styles.optionTitleActive]}>{item.label}</Text>
              <Text style={[styles.optionDescription, loadingStateOption === item.option && styles.optionDescriptionActive]}>{item.description}</Text>
            </TouchableOpacity>
          ))}
          <FieldError message={requestErrors.loading} />
        </FormSection>

        <FormSection title="Poznámka">
          <TextInput style={[styles.compactInput, styles.multilineInput]} value={problem} onChangeText={setProblem} placeholder="Např. vozidlo má zablokované kolo, přístup je z úzké ulice…" multiline />
        </FormSection>

        <FormSection title="Kontrola a odeslání">
          <ReviewRow label="Trasa" value={`${pickupPublicLabel.trim() || "Odkud neuvedeno"} → ${destinationPublicLabel.trim() || "Kam neuvedeno"}`} />
          <ReviewRow label="Termín" value={dateMode === "window" ? `${requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Od neuvedeno"} – ${requestedEndDate ? requestedEndDate.toLocaleDateString("cs-CZ") : "Do neuvedeno"}` : requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Datum neuvedeno"} />
          <ReviewRow label="Vozidlo" value={`${vehicle}${requestVehicleModel.trim() ? ` · ${requestVehicleModel.trim()}` : ""}`} />
          <ReviewRow label="Nakládka" value={loadingLabel} />
          <TouchableOpacity style={styles.primary} disabled={creatingRequest} onPress={createJob} accessibilityLabel="Odeslat poptávku">
            <Text style={styles.primaryText}>{creatingRequest ? "Odesílám…" : "Odeslat poptávku"}</Text>
          </TouchableOpacity>
        </FormSection>
      </ScrollView>
    </SafeAreaView>
  );
}
