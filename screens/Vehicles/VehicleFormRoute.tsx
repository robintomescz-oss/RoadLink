import React from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav as BottomNav } from "../../components/AppBottomNav";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { parseVehicleNumericFields } from "../../hooks/useProfile";

export default function VehicleFormRoute() {
  const { profileState } = useAppContext();
  const {
    editingVehicleId,
    vehicleName, setVehicleName,
    vehicleType, setVehicleType,
    vehicleMake, setVehicleMake,
    vehicleModel, setVehicleModel,
    vehicleYear, setVehicleYear,
    vehicleRegistrationNumber, setVehicleRegistrationNumber,
    vehicleMaxWeight, setVehicleMaxWeight,
    vehicleMaxLength, setVehicleMaxLength,
    vehicleMaxWidth, setVehicleMaxWidth,
    vehicleMaxHeight, setVehicleMaxHeight,
    vehicleCapacity, setVehicleCapacity,
    vehicleDescription, setVehicleDescription,
    vehicleIsActive, setVehicleIsActive,
    vehicleHasWinch, setVehicleHasWinch,
    vehicleHasHydraulicPlatform, setVehicleHasHydraulicPlatform,
    vehicleHasRamps, setVehicleHasRamps,
    vehicleHasStraps, setVehicleHasStraps,
    vehicleHasJumpStarter, setVehicleHasJumpStarter,
    vehicleHasCompressor, setVehicleHasCompressor,
    saveVehicle,
  } = profileState;
  const numeric = parseVehicleNumericFields({
    year: vehicleYear,
    maxWeight: vehicleMaxWeight,
    maxLength: vehicleMaxLength,
    maxWidth: vehicleMaxWidth,
    maxHeight: vehicleMaxHeight,
    capacity: vehicleCapacity,
  });
  const valid = numeric.allValid;
  const goBack = () => navigateLegacy("vehicles");
  const onSubmit = () => {
    if (valid) saveVehicle();
  };
  return (
    <SafeAreaView style={styles.container}>
      <Header title={editingVehicleId ? "Upravit vozidlo" : "Přidat vozidlo"} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Základní informace</Text>
        <Text style={styles.label}>Název vozidla</Text>
        <TextInput style={styles.input} value={vehicleName} onChangeText={setVehicleName} placeholder="Např. Osobní auto 1" />

        <Text style={styles.label}>Typ vozidla</Text>
        <TextInput style={styles.input} value={vehicleType} onChangeText={setVehicleType} placeholder="Např. Osobní auto, SUV, Dodávka" />

        <Text style={styles.label}>Značka (volitelné)</Text>
        <TextInput style={styles.input} value={vehicleMake} onChangeText={setVehicleMake} placeholder="Např. Škoda, Mercedes" />

        <Text style={styles.label}>Model (volitelné)</Text>
        <TextInput style={styles.input} value={vehicleModel} onChangeText={setVehicleModel} placeholder="Např. Octavia, Vito" />

        <Text style={styles.label}>Rok výroby (volitelné)</Text>
        <TextInput style={styles.input} value={vehicleYear} onChangeText={setVehicleYear} placeholder="Např. 2020" keyboardType="numeric" />

        <Text style={styles.label}>Registrace (volitelné)</Text>
        <TextInput style={styles.input} value={vehicleRegistrationNumber} onChangeText={setVehicleRegistrationNumber} placeholder="Např. 1A2 3456" />

        <Text style={styles.sectionTitle}>Rozměry a nosnost</Text>
        <Text style={styles.label}>Max. nosnost (kg)</Text>
        <TextInput style={styles.input} value={vehicleMaxWeight} onChangeText={setVehicleMaxWeight} placeholder="Např. 3500" keyboardType="numeric" />

        <Text style={styles.label}>Max. délka (cm)</Text>
        <TextInput style={styles.input} value={vehicleMaxLength} onChangeText={setVehicleMaxLength} placeholder="Např. 500" keyboardType="numeric" />

        <Text style={styles.label}>Max. šířka (cm)</Text>
        <TextInput style={styles.input} value={vehicleMaxWidth} onChangeText={setVehicleMaxWidth} placeholder="Např. 200" keyboardType="numeric" />

        <Text style={styles.label}>Max. výška (cm)</Text>
        <TextInput style={styles.input} value={vehicleMaxHeight} onChangeText={setVehicleMaxHeight} placeholder="Např. 250" keyboardType="numeric" />

        <Text style={styles.label}>Kapacita (volitelné)</Text>
        <TextInput style={styles.input} value={vehicleCapacity} onChangeText={setVehicleCapacity} placeholder="Např. 4" keyboardType="numeric" />

        <Text style={styles.label}>Popis (volitelné)</Text>
        <TextInput style={[styles.input, styles.multilineInput]} value={vehicleDescription} onChangeText={setVehicleDescription} placeholder="Doplňující informace o vozidle" multiline />

        <Text style={styles.sectionTitle}>Stav a vybavení</Text>
        <Text style={styles.label}>Je vozidlo aktivní?</Text>
        <View style={styles.chips}>
          <TouchableOpacity style={[styles.chip, vehicleIsActive && styles.chipActive]} onPress={() => setVehicleIsActive(true)}>
            <Text>Aktivní</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, !vehicleIsActive && styles.chipActive]} onPress={() => setVehicleIsActive(false)}>
            <Text>Neaktivní</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Vybavení (stačí označit)</Text>
        <View style={styles.chips}>
          <TouchableOpacity style={[styles.chip, vehicleHasWinch && styles.chipActive]} onPress={() => setVehicleHasWinch(!vehicleHasWinch)}>
            <Text>Naviják</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, vehicleHasHydraulicPlatform && styles.chipActive]} onPress={() => setVehicleHasHydraulicPlatform(!vehicleHasHydraulicPlatform)}>
            <Text>Hydraulická nástavba</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, vehicleHasRamps && styles.chipActive]} onPress={() => setVehicleHasRamps(!vehicleHasRamps)}>
            <Text>Rampy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, vehicleHasStraps && styles.chipActive]} onPress={() => setVehicleHasStraps(!vehicleHasStraps)}>
            <Text>Pásy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, vehicleHasJumpStarter && styles.chipActive]} onPress={() => setVehicleHasJumpStarter(!vehicleHasJumpStarter)}>
            <Text>Startér</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, vehicleHasCompressor && styles.chipActive]} onPress={() => setVehicleHasCompressor(!vehicleHasCompressor)}>
            <Text>Kompresor</Text>
          </TouchableOpacity>
        </View>

        {!valid ? (
          <Text style={styles.fieldError}>Zkontrolujte číselné hodnoty (rok, nosnost, rozměry).</Text>
        ) : null}
        <TouchableOpacity style={styles.primary} onPress={onSubmit}>
          <Text style={styles.primaryText}>Uložit vozidlo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={goBack}>
          <Text style={styles.secondaryText}>Zpět na vozidla</Text>
        </TouchableOpacity>
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}
