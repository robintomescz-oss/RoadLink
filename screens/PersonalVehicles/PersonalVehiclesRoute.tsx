import React from "react";
import { FlatList, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav as BottomNav } from "../../components/AppBottomNav";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import type { PersonalVehicleRecord } from "../../hooks/usePersonalVehicles";
import { PERSONAL_FUEL_TYPE_LABELS, personalVehicleDisplayLabel } from "../../lib/personalVehicles";

/**
 * „Moje vozidla“ — soukromá vozidla uživatele.
 *
 * Záměrně oddělené od `screens/Vehicles/VehiclesRoute.tsx`, které pracuje s
 * `carrier_vehicles` (odtahová technika navázaná na přepravní profil).
 * Obsah této obrazovky se nesmí objevit v přepravním trhu, nabídce kapacity
 * ani v matchingu.
 */
export default function PersonalVehiclesRoute() {
  const { personalVehiclesState } = useAppContext();
  const {
    personalVehicles,
    personalVehiclesLoading,
    personalVehiclesError,
    reloadPersonalVehicles,
    deletePersonalVehicle,
    editPersonalVehicle,
  } = personalVehiclesState;

  // Hardwarové Zpět = návrat na Profil (jinak by Back ukončil aplikaci).
  useHardwareBackTo("profile");

  const goBack = () => navigateLegacy("profile");
  const goToAdd = () => { editPersonalVehicle(null); navigateLegacy("personalVehicleForm"); };
  const onEdit = (item: PersonalVehicleRecord) => { editPersonalVehicle(item.id); navigateLegacy("personalVehicleForm"); };

  const onDelete = (item: PersonalVehicleRecord) => {
    deletePersonalVehicle(item.id);
  };

  const reload = () => {
    void reloadPersonalVehicles();
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Moje vozidla" />
      <View style={styles.formBackHeader}>
        <TouchableOpacity style={styles.formBackButton} onPress={goBack} accessibilityLabel="Zpět na profil">
          <Text style={styles.formBackText}>‹ Profil</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.empty}>
        Osobní vozidla slouží k rychlejšímu vyplnění SOS – předvyplní značku, model a registraci.
        Je to volitelný údaj a zůstává soukromý: neukládáme VIN, číslo pojistné smlouvy ani přesnou polohu.
        Vozidla nejsou součástí přepravního trhu ani doporučených shod.
      </Text>

      {personalVehiclesLoading ? (
        <View style={styles.scroll}>
          <Text style={styles.empty}>Načítám moje vozidla…</Text>
        </View>
      ) : personalVehiclesError ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.empty}>{personalVehiclesError}</Text>
          <TouchableOpacity style={styles.secondary} onPress={reload}>
            <Text style={styles.secondaryText}>Zkusit znovu</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : personalVehicles.length === 0 ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.empty}>Zatím nemáte uložené žádné vozidlo. Přidání je volitelné a usnadní vyplnění SOS.</Text>
          <TouchableOpacity style={styles.primary} onPress={goToAdd} accessibilityLabel="Přidat moje vozidlo">
            <Text style={styles.primaryText}>Přidat moje vozidlo</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={personalVehicles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <TouchableOpacity style={styles.primary} onPress={goToAdd} accessibilityLabel="Přidat další moje vozidlo">
              <Text style={styles.primaryText}>Přidat další vozidlo</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <View style={styles.vehicleCard}>
              <View style={styles.vehicleHeader}>
                <View>
                  <Text style={styles.vehicleName}>{personalVehicleDisplayLabel(item)}</Text>
                  <Text style={styles.vehicleInfo}>
                    {item.make} {item.model}
                    {item.year ? ` (${item.year})` : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.vehicleDetails}>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Registrace</Text>
                  <Text style={styles.vehicleDetailValue}>{item.registration || "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Pohon</Text>
                  <Text style={styles.vehicleDetailValue}>{item.fuelType ? PERSONAL_FUEL_TYPE_LABELS[item.fuelType] : "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Pojišťovna</Text>
                  <Text style={styles.vehicleDetailValue}>{item.insuranceProvider || "—"}</Text>
                </View>
              </View>

              <View style={styles.vehicleActions}>
                <TouchableOpacity
                  style={styles.secondary}
                  onPress={() => onEdit(item)}
                  accessibilityLabel={`Upravit ${item.nickname}`}
                >
                  <Text style={styles.secondaryText}>Upravit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dangerButton}
                  onPress={() => onDelete(item)}
                  accessibilityLabel={`Smazat ${item.nickname}`}
                >
                  <Text style={styles.dangerButtonText}>Smazat</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
      <BottomNav />
    </SafeAreaView>
  );
}
