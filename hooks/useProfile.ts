import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { supabase } from "../lib/supabase";
import type { CarrierProfile, CarrierVehicle, UserProfile } from "../lib/types";
import {
  buildVehiclePayload,
  mapCarrierProfileToFormFields,
  parseCarrierProfilePublicContact,
  parseVehicleNumericFields,
  type VehicleFormValues,
} from "../lib/profileFormLogic";
export {
  buildVehiclePayload,
  mapCarrierProfileToFormFields,
  parseCarrierProfilePublicContact,
  parseVehicleNumericFields,
} from "../lib/profileFormLogic";

/**
 * Profilová doména: uživatelský profil, přepravní profil a vozový park.
 * Vyextractováno 1:1 z App.tsx — chování beze změny.
 */

// ---- Hook ----

export function useProfile({ userId, screen }: { userId: string | null; screen: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [carrierProfile, setCarrierProfile] = useState<CarrierProfile | null>(null);
  const [carrierProfileLoading, setCarrierProfileLoading] = useState(false);
  const [carrierProfileEditing, setCarrierProfileEditing] = useState(false);
  const [carrierDisplayName, setCarrierDisplayName] = useState("");
  const [carrierBusinessType, setCarrierBusinessType] = useState<"individual" | "company">("individual");
  const [carrierCompanyName, setCarrierCompanyName] = useState("");
  const [carrierIco, setCarrierIco] = useState("");
  const [carrierDescription, setCarrierDescription] = useState("");
  const [carrierServiceArea, setCarrierServiceArea] = useState("");
  const [carrierMaxRadius, setCarrierMaxRadius] = useState("");
  const [carrierYearsExperience, setCarrierYearsExperience] = useState("");
  const [carrierAvailable247, setCarrierAvailable247] = useState(false);
  const [carrierPhonePublic, setCarrierPhonePublic] = useState<boolean>(true);
  const [carrierEmailPublic, setCarrierEmailPublic] = useState<boolean>(false);
  const [carrierPublicPhone, setCarrierPublicPhone] = useState("");
  const [carrierPublicEmail, setCarrierPublicEmail] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [insuranceStatus, setInsuranceStatus] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<CarrierVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehicleEditing, setVehicleEditing] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleRegistrationNumber, setVehicleRegistrationNumber] = useState("");
  const [vehicleMaxWeight, setVehicleMaxWeight] = useState("");
  const [vehicleMaxLength, setVehicleMaxLength] = useState("");
  const [vehicleMaxWidth, setVehicleMaxWidth] = useState("");
  const [vehicleMaxHeight, setVehicleMaxHeight] = useState("");
  const [vehicleCapacity, setVehicleCapacity] = useState("");
  const [vehicleDescription, setVehicleDescription] = useState("");
  const [vehicleHasWinch, setVehicleHasWinch] = useState(false);
  const [vehicleHasHydraulicPlatform, setVehicleHasHydraulicPlatform] = useState(false);
  const [vehicleHasRamps, setVehicleHasRamps] = useState(false);
  const [vehicleHasStraps, setVehicleHasStraps] = useState(false);
  const [vehicleHasJumpStarter, setVehicleHasJumpStarter] = useState(false);
  const [vehicleHasCompressor, setVehicleHasCompressor] = useState(false);
  const [vehicleIsActive, setVehicleIsActive] = useState(true);

  // Zajistí, že existuje carrier_profiles řádek pro aktuálního uživatele.
  // Pokud existuje, vrátí ho. Pokud neexistuje, vytvoří ho s defaultními
  // hodnotami a vrátí nový řádek. Bezpečné volat opakovaně.
  async function ensureCarrierProfile(): Promise<CarrierProfile | null> {
    if (!userId) return null;

    // 1) Pokus o načtení existujícího profilu.
    const { data: existing, error: loadError } = await supabase
      .from("carrier_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (loadError && loadError.code !== "PGRST116") {
      console.error("Ensure carrier profile (load):", loadError.message);
      return null;
    }

    if (existing) {
      setCarrierProfile(existing as CarrierProfile);
      return existing as CarrierProfile;
    }

    // 2) Profil neexistuje → vytvoříme ho s defaultními hodnotami
    //    stejně jako při registraci (viz registerUser).
    const { data: created, error: insertError } = await supabase
      .from("carrier_profiles")
      .insert({
        user_id: userId,
        status: "pending",
        business_type: "individual",
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Ensure carrier profile (insert):", insertError.message);
      Alert.alert(
        "Přepravní profil",
        "Nepodařilo se vytvořit přepravní profil. Zkuste to prosím znovu."
      );
      return null;
    }

    setCarrierProfile(created as CarrierProfile);
    return created as CarrierProfile;
  }

  async function loadProfile() {
    if (!userId) return;

    setProfileLoading(true);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      console.error("Load auth user:", authError?.message || "User not found");
      setProfileLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, phone, role")
      .eq("id", authData.user.id)
      .single();

    if (error) {
      console.error("Load profile:", error.message);
      setProfileLoading(false);
      return;
    }

    const loadedProfile: UserProfile = {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      role: data.role,
      email: authData.user.email || "E-mail není uveden",
    };
    setProfile(loadedProfile);
    setProfileFirstName(loadedProfile.first_name || "");
    setProfileLastName(loadedProfile.last_name || "");
    setProfilePhone(loadedProfile.phone || "");
    setProfileLoading(false);

    await loadCarrierProfile();
  }

  async function loadCarrierProfile() {
    if (!userId) return;

    setCarrierProfileLoading(true);
    const { data, error } = await supabase
      .from("carrier_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Load carrier profile:", error.message);
      setCarrierProfile(null);
      setVerificationStatus(null);
      setInsuranceStatus(null);
      setCarrierProfileLoading(false);
      return;
    }

    if (!data) {
      setCarrierProfile(null);
      setVerificationStatus(null);
      setInsuranceStatus(null);
      setCarrierProfileLoading(false);
      return;
    }

    const loadedProfile = data as CarrierProfile;
    setCarrierProfile(loadedProfile);
    const formFields = mapCarrierProfileToFormFields(loadedProfile);
    setCarrierDisplayName(formFields.displayName);
    setCarrierBusinessType(formFields.businessType);
    setCarrierCompanyName(formFields.companyName);
    setCarrierIco(formFields.ico);
    setCarrierDescription(formFields.description);
    setCarrierServiceArea(formFields.serviceArea);
    setCarrierMaxRadius(formFields.maxRadius);
    setCarrierYearsExperience(formFields.yearsExperience);
    setCarrierAvailable247(formFields.available247);
    setCarrierPhonePublic(formFields.phonePublic);
    setCarrierEmailPublic(formFields.emailPublic);
    setCarrierPublicPhone(formFields.publicPhone);
    setCarrierPublicEmail(formFields.publicEmail);

    const [{ data: verification }, { data: insurance }] = await Promise.all([
      supabase
        .from("carrier_verification")
        .select("status")
        .eq("carrier_id", loadedProfile.id)
        .maybeSingle(),
      supabase
        .from("carrier_insurance")
        .select("status")
        .eq("carrier_id", loadedProfile.id)
        .maybeSingle(),
    ]);
    setVerificationStatus(verification?.status || null);
    setInsuranceStatus(insurance?.status || null);
    setCarrierProfileLoading(false);
  }

  async function activateCarrierProfile() {
    if (!userId || carrierProfileLoading) return;

    setCarrierProfileLoading(true);
    const profile = await ensureCarrierProfile();
    setCarrierProfileLoading(false);

    if (!profile) {
      Alert.alert("RoadLink", "Přepravní profil se nepodařilo aktivovat.");
      return;
    }

    await loadCarrierProfile();
  }

  async function loadVehicles() {
    if (!userId) return;

    setVehiclesLoading(true);
    const { data: carrier, error: carrierError } = await supabase
      .from("carrier_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (carrierError || !carrier) {
      console.error("Load carrier id:", carrierError?.message || "Carrier profile not found");
      setVehiclesLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("carrier_vehicles")
      .select("*")
      .eq("carrier_id", carrier.id)
      .order("name", { ascending: true });

    if (error) {
      console.error("Load carrier vehicles:", error.message);
      setVehiclesLoading(false);
      return;
    }

    setVehicles((data || []) as CarrierVehicle[]);
    setVehiclesLoading(false);
  }

  function resetVehicleForm() {
    setEditingVehicleId(null);
    setVehicleName("");
    setVehicleType("");
    setVehicleMake("");
    setVehicleModel("");
    setVehicleYear("");
    setVehicleRegistrationNumber("");
    setVehicleMaxWeight("");
    setVehicleMaxLength("");
    setVehicleMaxWidth("");
    setVehicleMaxHeight("");
    setVehicleCapacity("");
    setVehicleDescription("");
    setVehicleHasWinch(false);
    setVehicleHasHydraulicPlatform(false);
    setVehicleHasRamps(false);
    setVehicleHasStraps(false);
    setVehicleHasJumpStarter(false);
    setVehicleHasCompressor(false);
    setVehicleIsActive(true);
  }

  function editVehicle(vehicle: CarrierVehicle) {
    setEditingVehicleId(vehicle.id);
    setVehicleName(vehicle.name || "");
    setVehicleType(vehicle.vehicle_type || "");
    setVehicleMake(vehicle.make || "");
    setVehicleModel(vehicle.model || "");
    setVehicleYear(vehicle.year?.toString() || "");
    setVehicleRegistrationNumber(vehicle.registration_number || "");
    setVehicleMaxWeight(vehicle.max_weight_kg?.toString() || "");
    setVehicleMaxLength(vehicle.max_vehicle_length_cm?.toString() || "");
    setVehicleMaxWidth(vehicle.max_vehicle_width_cm?.toString() || "");
    setVehicleMaxHeight(vehicle.max_vehicle_height_cm?.toString() || "");
    setVehicleCapacity(vehicle.capacity?.toString() || "");
    setVehicleDescription(vehicle.description || "");
    setVehicleHasWinch(vehicle.has_winch);
    setVehicleHasHydraulicPlatform(vehicle.has_hydraulic_platform);
    setVehicleHasRamps(vehicle.has_ramps);
    setVehicleHasStraps(vehicle.has_straps);
    setVehicleHasJumpStarter(vehicle.has_jump_starter);
    setVehicleHasCompressor(vehicle.has_compressor);
    setVehicleIsActive(vehicle.is_active);
    setVehicleEditing(true);
  }

  async function saveVehicle() {
    if (!userId || !vehicleName.trim() || !vehicleType.trim()) {
      Alert.alert("Chybí údaje", "Vyplňte prosím název a typ vozidla.");
      return;
    }

    const numbers = parseVehicleNumericFields({
      year: vehicleYear,
      maxWeight: vehicleMaxWeight,
      maxLength: vehicleMaxLength,
      maxWidth: vehicleMaxWidth,
      maxHeight: vehicleMaxHeight,
      capacity: vehicleCapacity,
    });
    if (!numbers.allValid) {
      Alert.alert("Chyba", "Rok a rozměry vozidla musí být čísla.");
      return;
    }

    const { data: carrier, error: carrierError } = await supabase
      .from("carrier_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();
    if (carrierError || !carrier) {
      Alert.alert("Chyba", "Profil přepravce se nepodařilo načíst.");
      return;
    }

    const vehicleData = buildVehiclePayload({
      name: vehicleName,
      type: vehicleType,
      make: vehicleMake,
      model: vehicleModel,
      year: vehicleYear,
      registrationNumber: vehicleRegistrationNumber,
      maxWeight: vehicleMaxWeight,
      maxLength: vehicleMaxLength,
      maxWidth: vehicleMaxWidth,
      maxHeight: vehicleMaxHeight,
      capacity: vehicleCapacity,
      description: vehicleDescription,
      hasWinch: vehicleHasWinch,
      hasHydraulicPlatform: vehicleHasHydraulicPlatform,
      hasRamps: vehicleHasRamps,
      hasStraps: vehicleHasStraps,
      hasJumpStarter: vehicleHasJumpStarter,
      hasCompressor: vehicleHasCompressor,
      isActive: vehicleIsActive,
    });

    const query = editingVehicleId
      ? supabase.from("carrier_vehicles").update(vehicleData).eq("id", editingVehicleId).eq("carrier_id", carrier.id).select("*").single()
      : supabase.from("carrier_vehicles").insert({ carrier_id: carrier.id, ...vehicleData }).select("*").single();
    const { data, error } = await query;

    if (error) {
      console.error("Save carrier vehicle:", error.message);
      Alert.alert("Chyba", "Vozidlo se nepodařilo uložit.");
      return;
    }

    setVehicles((current) => editingVehicleId
      ? current.map((vehicle) => vehicle.id === editingVehicleId ? data as CarrierVehicle : vehicle)
      : [...current, data as CarrierVehicle]
    );
    resetVehicleForm();
    setVehicleEditing(false);
    Alert.alert("Vozidlo uloženo", "Údaje vozidla byly uloženy.");
  }

  function deleteVehicle(vehicle: CarrierVehicle) {
    Alert.alert("Smazat vozidlo?", `Opravdu chcete smazat vozidlo ${vehicle.name || "bez názvu"}?`, [
      { text: "Zrušit", style: "cancel" },
      {
        text: "Smazat",
        style: "destructive",
        onPress: async () => {
          if (!userId) return;
          const { data: carrier, error: carrierError } = await supabase
            .from("carrier_profiles")
            .select("id")
            .eq("user_id", userId)
            .single();
          if (carrierError || !carrier) {
            Alert.alert("Chyba", "Profil přepravce se nepodařilo načíst.");
            return;
          }
          const { error } = await supabase
            .from("carrier_vehicles")
            .delete()
            .eq("id", vehicle.id)
            .eq("carrier_id", carrier.id);
          if (error) {
            console.error("Delete carrier vehicle:", error.message);
            Alert.alert("Chyba", "Vozidlo se nepodařilo smazat.");
            return;
          }
          setVehicles((current) => current.filter((currentVehicle) => currentVehicle.id !== vehicle.id));
          Alert.alert("Vozidlo smazáno", "Vozidlo bylo odstraněno.");
        },
      },
    ]);
  }

  async function saveCarrierProfile() {
    if (!userId || !carrierProfile) return;

    const parsed = parseCarrierProfilePublicContact(carrierMaxRadius, carrierYearsExperience, carrierPublicPhone, carrierPublicEmail);
    if (!parsed.numbersValid) {
      Alert.alert("Chyba", "Maximální vzdálenost a roky zkušeností musí být čísla.");
      return;
    }

    setCarrierProfileLoading(true);
    if (!parsed.emailValid) {
      Alert.alert("Chyba", "Zadejte platnou e-mailovou adresu.");
      setCarrierProfileLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("carrier_profiles")
      .update({
        display_name: carrierDisplayName.trim() || null,
        business_type: carrierBusinessType,
        company_name: carrierCompanyName.trim() || null,
        ico: carrierIco.trim() || null,
        description: carrierDescription.trim() || null,
        service_area: carrierServiceArea.trim() || null,
        max_radius_km: parsed.maxRadius,
        years_experience: parsed.yearsExperience,
        available_24_7: carrierAvailable247,
        phone_public: carrierPhonePublic,
        email_public: carrierEmailPublic,
        public_phone: parsed.publicPhone,
        public_email: parsed.publicEmail,
      })
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      console.error("Update carrier profile:", error.message);
      Alert.alert("Chyba", "Profil přepravce se nepodařilo uložit.");
      setCarrierProfileLoading(false);
      return;
    }

    setCarrierProfile(data as CarrierProfile);
    setCarrierProfileEditing(false);
    setCarrierProfileLoading(false);
    Alert.alert("Profil uložen", "Profil přepravce byl aktualizován.");
  }

  async function saveProfile() {
    if (!userId) return;

    const firstName = profileFirstName.trim();
    const lastName = profileLastName.trim();
    const phone = profilePhone.trim();
    if (!firstName || !lastName || !phone) {
      Alert.alert("Chybí údaje", "Jméno, příjmení a telefon jsou povinné.");
      return;
    }

    setProfileLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName, phone })
      .eq("id", userId)
      .select("id, first_name, last_name, phone, role")
      .single();

    if (error) {
      console.error("Update profile:", error.message);
      Alert.alert("Chyba", "Profil se nepodařilo uložit.");
      setProfileLoading(false);
      return;
    }

    setProfile((current) => current ? {
      ...current,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
    } : current);
    setProfileEditing(false);
    setProfileLoading(false);
    Alert.alert("Profil uložen", "Vaše údaje byly aktualizovány.");
  }

  /** Logout / přepnutí účtu — přesná podmnožina clearLocalUserState pro profilovou doménu. */
  function resetProfileData() {
    setProfile(null);
    setCarrierProfile(null);
    setVehicles([]);
    setProfileEditing(false);
    setCarrierProfileEditing(false);
    setVehicleEditing(false);
    setEditingVehicleId(null);
  }

  useEffect(() => {
    if (screen === "profile" && userId) {
      loadProfile();
    }
  }, [screen, userId]);

  useEffect(() => {
    if (screen === "vehicles" && userId) {
      loadVehicles();
    }
  }, [screen, userId]);

  return {
    profile,
    profileLoading,
    profileEditing,
    setProfileEditing,
    profileFirstName,
    setProfileFirstName,
    profileLastName,
    setProfileLastName,
    profilePhone,
    setProfilePhone,
    carrierProfile,
    carrierProfileLoading,
    carrierProfileEditing,
    setCarrierProfileEditing,
    carrierDisplayName,
    setCarrierDisplayName,
    carrierBusinessType,
    setCarrierBusinessType,
    carrierCompanyName,
    setCarrierCompanyName,
    carrierIco,
    setCarrierIco,
    carrierDescription,
    setCarrierDescription,
    carrierServiceArea,
    setCarrierServiceArea,
    carrierMaxRadius,
    setCarrierMaxRadius,
    carrierYearsExperience,
    setCarrierYearsExperience,
    carrierAvailable247,
    setCarrierAvailable247,
    carrierPhonePublic,
    setCarrierPhonePublic,
    carrierEmailPublic,
    setCarrierEmailPublic,
    carrierPublicPhone,
    setCarrierPublicPhone,
    carrierPublicEmail,
    setCarrierPublicEmail,
    verificationStatus,
    insuranceStatus,
    vehicles,
    vehiclesLoading,
    vehicleEditing,
    setVehicleEditing,
    editingVehicleId,
    setEditingVehicleId,
    vehicleName,
    setVehicleName,
    vehicleType,
    setVehicleType,
    vehicleMake,
    setVehicleMake,
    vehicleModel,
    setVehicleModel,
    vehicleYear,
    setVehicleYear,
    vehicleRegistrationNumber,
    setVehicleRegistrationNumber,
    vehicleMaxWeight,
    setVehicleMaxWeight,
    vehicleMaxLength,
    setVehicleMaxLength,
    vehicleMaxWidth,
    setVehicleMaxWidth,
    vehicleMaxHeight,
    setVehicleMaxHeight,
    vehicleCapacity,
    setVehicleCapacity,
    vehicleDescription,
    setVehicleDescription,
    vehicleHasWinch,
    setVehicleHasWinch,
    vehicleHasHydraulicPlatform,
    setVehicleHasHydraulicPlatform,
    vehicleHasRamps,
    setVehicleHasRamps,
    vehicleHasStraps,
    setVehicleHasStraps,
    vehicleHasJumpStarter,
    setVehicleHasJumpStarter,
    vehicleHasCompressor,
    setVehicleHasCompressor,
    vehicleIsActive,
    setVehicleIsActive,
    ensureCarrierProfile,
    loadProfile,
    loadCarrierProfile,
    activateCarrierProfile,
    loadVehicles,
    resetVehicleForm,
    editVehicle,
    saveVehicle,
    deleteVehicle,
    saveCarrierProfile,
    saveProfile,
    resetProfileData,
  };
}
