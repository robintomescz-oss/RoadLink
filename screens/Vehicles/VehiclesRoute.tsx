import React from "react";
import { FlatList, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav as BottomNav } from "../../components/AppBottomNav";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import type { CarrierVehicle } from "../../lib/types";

export default function VehiclesRoute() {
  const { profileState } = useAppContext();
  const { vehicles, vehiclesLoading, editVehicle, deleteVehicle } = profileState;
  const goBack = () => navigateLegacy("profile");
  const goToAdd = () => navigateLegacy("vehicleForm");
  const onEdit = (item: CarrierVehicle) => { editVehicle(item); goToAdd(); };
  const onDelete = (item: CarrierVehicle) => {
    deleteVehicle(item);
  };

  // Hardwarové Zpět = návrat na Profil (jinak by Back ukončil aplikaci).
  useHardwareBackTo("profile");

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Moje vozidla" />
      <View style={styles.formBackHeader}>
        <TouchableOpacity style={styles.formBackButton} onPress={goBack} accessibilityLabel="Zpět na profil">
          <Text style={styles.formBackText}>‹ Profil</Text>
        </TouchableOpacity>
      </View>
      {vehiclesLoading ? (
        <View style={styles.scroll}>
          <Text style={styles.empty}>Načítám vozidla…</Text>
        </View>
      ) : vehicles.length === 0 ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.empty}>Žádná vozidla.</Text>
          <TouchableOpacity style={styles.primary} onPress={goToAdd}>
            <Text style={styles.primaryText}>Přidat vozidlo</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <TouchableOpacity style={styles.primary} onPress={goToAdd}>
              <Text style={styles.primaryText}>Přidat vozidlo</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.vehicleCard}
              onPress={() => onEdit(item)}
            >
              <View style={styles.vehicleHeader}>
                <View>
                  <Text style={styles.vehicleName}>{item.name || "Bez názvu"}</Text>
                  <Text style={styles.vehicleInfo}>
                    {item.vehicle_type || "Typ nebyl uveden"}
                    {item.make ? ` • ${item.make}` : ""}
                    {item.model ? ` ${item.model}` : ""}
                    {item.year ? ` (${item.year})` : ""}
                  </Text>
                </View>
                <View style={[styles.statusBadge, item.is_active ? styles.activeBadge : styles.inactiveBadge]}>
                  <Text style={styles.statusBadgeText}>{item.is_active ? "Aktivní" : "Neaktivní"}</Text>
                </View>
              </View>

              <View style={styles.vehicleDetails}>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Registrace</Text>
                  <Text style={styles.vehicleDetailValue}>{item.registration_number || "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Nosnost</Text>
                  <Text style={styles.vehicleDetailValue}>{item.max_weight_kg ? `${item.max_weight_kg} kg` : "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Délka</Text>
                  <Text style={styles.vehicleDetailValue}>{item.max_vehicle_length_cm ? `${item.max_vehicle_length_cm} cm` : "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Šířka</Text>
                  <Text style={styles.vehicleDetailValue}>{item.max_vehicle_width_cm ? `${item.max_vehicle_width_cm} cm` : "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Výška</Text>
                  <Text style={styles.vehicleDetailValue}>{item.max_vehicle_height_cm ? `${item.max_vehicle_height_cm} cm` : "—"}</Text>
                </View>
                <View style={styles.vehicleDetailRow}>
                  <Text style={styles.vehicleDetailLabel}>Kapacita</Text>
                  <Text style={styles.vehicleDetailValue}>{item.capacity ? `${item.capacity}` : "—"}</Text>
                </View>
              </View>

              <View style={styles.vehicleEquipment}>
                <Text style={styles.equipmentLabel}>Vybavení:</Text>
                <View style={styles.equipmentRow}>
                  <Text style={[styles.equipmentItem, item.has_winch && styles.equipmentChecked]}>Naviják</Text>
                  <Text style={[styles.equipmentItem, item.has_hydraulic_platform && styles.equipmentChecked]}>Hydraul. nástavba</Text>
                  <Text style={[styles.equipmentItem, item.has_ramps && styles.equipmentChecked]}>Rampy</Text>
                  <Text style={[styles.equipmentItem, item.has_straps && styles.equipmentChecked]}>Pásy</Text>
                  <Text style={[styles.equipmentItem, item.has_jump_starter && styles.equipmentChecked]}>Startér</Text>
                  <Text style={[styles.equipmentItem, item.has_compressor && styles.equipmentChecked]}>Kompresor</Text>
                </View>
              </View>

              <View style={styles.vehicleActions}>
                <TouchableOpacity style={styles.secondary} onPress={() => onEdit(item)}>
                  <Text style={styles.secondaryText}>Upravit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dangerButton} onPress={() => onDelete(item)}>
                  <Text style={styles.dangerButtonText}>Smazat</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
      <BottomNav />
    </SafeAreaView>
  );
}
