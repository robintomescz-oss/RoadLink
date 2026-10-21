import React, { useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import { PERSONAL_FUEL_TYPE_OPTIONS, type PersonalFuelType } from "../../lib/personalVehicles";

/**
 * Přidání nebo úprava osobního vozidla.
 *
 * Na rozdíl od `screens/Vehicles/VehicleFormRoute.tsx` nemá stav v AppContext —
 * osobní vozidla mají vlastní hook a nesdílejí nic s přepravním profilem.
 */
export default function PersonalVehicleFormRoute() {
  const { personalVehiclesState } = useAppContext();
  const { addPersonalVehicle, updatePersonalVehicle, editingPersonalVehicleId, editPersonalVehicle } = personalVehiclesState;
  const editingId = editingPersonalVehicleId;

  const [nickname, setNickname] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [fuelType, setFuelType] = useState<PersonalFuelType | "">("");
  const [registration, setRegistration] = useState("");
  const [insuranceProvider, setInsuranceProvider] = useState("");

  // Při úpravě se pole předvyplní z vybraného vozidla. Efekt běží po mountu a
  // po změně `editingId`, takže přechod ze seznamu funguje bez propů v route.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const editingVehicle = personalVehiclesState.personalVehicles.find((item) => item.id === editingId) ?? null;
  if (editingId && prefilledFor !== editingId && editingVehicle) {
    setNickname(editingVehicle.nickname);
    setMake(editingVehicle.make);
    setModel(editingVehicle.model);
    setYear(editingVehicle.year === null ? "" : String(editingVehicle.year));
    setFuelType(editingVehicle.fuelType ?? "");
    setRegistration(editingVehicle.registration ?? "");
    setInsuranceProvider(editingVehicle.insuranceProvider ?? "");
    setPrefilledFor(editingId);
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  // Hardwarové Zpět = návrat na seznam, ne na profil.
  useHardwareBackTo("personalVehicles");

  const resetForm = () => {
    setNickname("");
    setMake("");
    setModel("");
    setYear("");
    setFuelType("");
    setRegistration("");
    setInsuranceProvider("");
    setError(undefined);
    setFieldError(undefined);
  };

  const onSave = async () => {
    setSaving(true);
    setError(undefined);
    setFieldError(undefined);

    const result = editingId
      ? await updatePersonalVehicle(editingId, { nickname, make, model, year, fuelType: fuelType || null, registration, insuranceProvider })
      : await addPersonalVehicle({ nickname, make, model, year, fuelType: fuelType || null, registration, insuranceProvider });

    setSaving(false);

    if (!result.ok) {
      // Rozlišíme chybu pole (chybí název/značka/model) od chyby uložení.
      if (result.message.includes("název, značku")) setFieldError(result.message);
      else setError(result.message);
      return;
    }

    resetForm();
    editPersonalVehicle(null);
    navigateLegacy("personalVehicles");
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title={editingId ? "Upravit moje vozidlo" : "Přidat moje vozidlo"} />
      <View style={styles.formBackHeader}>
        <TouchableOpacity style={styles.formBackButton} onPress={() => navigateLegacy("personalVehicles")} accessibilityLabel="Zpět na moje vozidla">
          <Text style={styles.formBackText}>‹ Moje vozidla</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Název vozidla</Text>
        <TextInput
          style={styles.input}
          value={nickname}
          onChangeText={(value) => { setNickname(value); setFieldError(undefined); }}
          placeholder="Např. Moje auto"
          accessibilityLabel="Název vozidla"
          autoCorrect={false}
        />

        <Text style={styles.label}>Značka</Text>
        <TextInput
          style={styles.input}
          value={make}
          onChangeText={(value) => { setMake(value); setFieldError(undefined); }}
          placeholder="Např. Škoda"
          accessibilityLabel="Značka vozidla"
          autoCorrect={false}
        />

        <Text style={styles.label}>Model</Text>
        <TextInput
          style={styles.input}
          value={model}
          onChangeText={(value) => { setModel(value); setFieldError(undefined); }}
          placeholder="Např. Octavia"
          accessibilityLabel="Model vozidla"
          autoCorrect={false}
        />

        <Text style={styles.label}>Rok výroby · volitelný</Text>
        <TextInput
          style={styles.input}
          value={year}
          onChangeText={(value) => { setYear(value); setFieldError(undefined); }}
          placeholder="Např. 2019"
          accessibilityLabel="Rok výroby"
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Pohon · volitelný</Text>
        <View style={styles.chipGrid}>
          {PERSONAL_FUEL_TYPE_OPTIONS.map((option) => {
            const active = fuelType === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.selectChip, active && styles.selectChipActive]}
                onPress={() => { setFuelType(active ? "" : option.value); setFieldError(undefined); }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={option.label}
              >
                <Text style={[styles.selectChipText, active && styles.selectChipTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Registrační značka · volitelná</Text>
        <TextInput
          style={styles.input}
          value={registration}
          onChangeText={(value) => { setRegistration(value); setFieldError(undefined); }}
          placeholder="Např. 1AB 12345"
          accessibilityLabel="Registrační značka"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <Text style={styles.label}>Pojišťovna · volitelná</Text>
        <TextInput
          style={styles.input}
          value={insuranceProvider}
          onChangeText={(value) => { setInsuranceProvider(value); setFieldError(undefined); }}
          placeholder="Např. Kooperativa"
          accessibilityLabel="Pojišťovna"
          autoCorrect={false}
        />

        <Text style={styles.profileCardHint}>
          Registrace a pojišťovna jsou soukromé. Neukládá se VIN, číslo pojistné smlouvy ani přesná poloha.
        </Text>

        {fieldError ? <Text style={styles.fieldError}>{fieldError}</Text> : null}
        {error ? <Text style={styles.fieldError}>{error}</Text> : null}

        <TouchableOpacity
          style={styles.primary}
          onPress={onSave}
          disabled={saving}
          accessibilityLabel={editingId ? "Uložit změny vozidla" : "Uložit moje vozidlo"}
        >
          <Text style={styles.primaryText}>{saving ? "Ukládám…" : editingId ? "Uložit změny" : "Uložit moje vozidlo"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={resetForm}>
          <Text style={styles.secondaryText}>Vymazat formulář</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
