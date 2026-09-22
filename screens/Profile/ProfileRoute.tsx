import React from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav as BottomNav } from "../../components/AppBottomNav";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { mapCarrierProfileToFormFields } from "../../hooks/useProfile";

export default function ProfileRoute() {
  const { profileState } = useAppContext();
  const {
    profile, profileLoading, profileEditing,
    profileFirstName, setProfileFirstName,
    profileLastName, setProfileLastName,
    profilePhone, setProfilePhone,
    carrierProfile, carrierProfileLoading, carrierProfileEditing,
    setCarrierProfileEditing,
    carrierDisplayName, setCarrierDisplayName,
    carrierBusinessType, setCarrierBusinessType,
    carrierCompanyName, setCarrierCompanyName,
    carrierIco, setCarrierIco,
    carrierDescription, setCarrierDescription,
    carrierServiceArea, setCarrierServiceArea,
    carrierMaxRadius, setCarrierMaxRadius,
    carrierYearsExperience, setCarrierYearsExperience,
    carrierAvailable247, setCarrierAvailable247,
    carrierPhonePublic, setCarrierPhonePublic,
    carrierEmailPublic, setCarrierEmailPublic,
    carrierPublicPhone, setCarrierPublicPhone,
    carrierPublicEmail, setCarrierPublicEmail,
    verificationStatus, insuranceStatus,
    saveProfile, saveCarrierProfile, activateCarrierProfile, setProfileEditing,
  } = profileState;
  const goBack = () => navigateLegacy("home");
  if (profileLoading && !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Profil" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.empty}>Načítám profil…</Text>
        </ScrollView>
        <BottomNav />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.profileHeader}>
        <TouchableOpacity onPress={goBack} accessibilityLabel="Zpět na přehled">
          <Text style={styles.profileBack}>← Přehled</Text>
        </TouchableOpacity>
        <Text style={styles.profileHeaderIcon}>♙</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.bigTitle}>Můj profil</Text>

        {profile ? (
          <>
            <View style={styles.profileCard}>
              <Text style={styles.profileName}>{profile.first_name || "Uživatel"} {profile.last_name || ""}</Text>
              <Text style={styles.profileRole}>RoadLink účet</Text>
            </View>

            {profileEditing ? (
              <View style={styles.profileCard}>
                <Text style={styles.label}>Jméno</Text>
                <TextInput style={styles.input} value={profileFirstName} onChangeText={setProfileFirstName} placeholder="Jméno" />
                <Text style={styles.label}>Příjmení</Text>
                <TextInput style={styles.input} value={profileLastName} onChangeText={setProfileLastName} placeholder="Příjmení" />
                <Text style={styles.label}>Telefon</Text>
                <TextInput style={styles.input} value={profilePhone} onChangeText={setProfilePhone} placeholder="Telefon" keyboardType="phone-pad" />
                <TouchableOpacity style={styles.primary} onPress={saveProfile} disabled={profileLoading}>
                  <Text style={styles.primaryText}>{profileLoading ? "Ukládám..." : "Uložit profil"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => setProfileEditing(false)} disabled={profileLoading}>
                  <Text style={styles.secondaryText}>Zrušit</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.profileCard}>
                <Text style={styles.profileFieldLabel}>Jméno</Text>
                <Text style={styles.profileFieldValue}>{profile.first_name || "Neuvedeno"}</Text>
                <Text style={styles.profileFieldLabel}>Příjmení</Text>
                <Text style={styles.profileFieldValue}>{profile.last_name || "Neuvedeno"}</Text>
                <Text style={styles.profileFieldLabel}>Telefon</Text>
                <Text style={styles.profileFieldValue}>{profile.phone || "Neuvedeno"}</Text>
                <Text style={styles.profileFieldLabel}>E-mail</Text>
                <Text style={styles.profileFieldValue}>{profile.email}</Text>
                <TouchableOpacity style={styles.primary} onPress={() => setProfileEditing(true)}>
                  <Text style={styles.primaryText}>Upravit profil</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Přepravní profil */}
            <Text style={styles.sectionTitle}>Přepravní profil</Text>
            {carrierProfileLoading && !carrierProfile ? (
              <Text style={styles.empty}>Načítám přepravní profil…</Text>
            ) : carrierProfile ? (
              carrierProfileEditing ? (
                <View style={styles.profileCard}>
                  <Text style={styles.label}>Název / jméno</Text>
                  <TextInput style={styles.input} value={carrierDisplayName} onChangeText={setCarrierDisplayName} placeholder="Název / jméno" />
                  <Text style={styles.label}>Typ podnikání</Text>
                  <View style={styles.chips}>
                    <TouchableOpacity style={[styles.chip, carrierBusinessType === "individual" && styles.chipActive]} onPress={() => setCarrierBusinessType("individual")}>
                      <Text>OSVČ</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.chip, carrierBusinessType === "company" && styles.chipActive]} onPress={() => setCarrierBusinessType("company")}>
                      <Text>Firma</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.label}>Název firmy</Text>
                  <TextInput style={styles.input} value={carrierCompanyName} onChangeText={setCarrierCompanyName} placeholder="Název firmy" />
                  <Text style={styles.label}>IČO</Text>
                  <TextInput style={styles.input} value={carrierIco} onChangeText={setCarrierIco} placeholder="IČO" keyboardType="number-pad" />
                  <Text style={styles.label}>Popis</Text>
                  <TextInput style={styles.input} value={carrierDescription} onChangeText={setCarrierDescription} placeholder="Popis" multiline />
                  <Text style={styles.label}>Oblast působení</Text>
                  <TextInput style={styles.input} value={carrierServiceArea} onChangeText={setCarrierServiceArea} placeholder="Oblast působení" />
                  <Text style={styles.label}>Maximální vzdálenost (km)</Text>
                  <TextInput style={styles.input} value={carrierMaxRadius} onChangeText={setCarrierMaxRadius} placeholder="Např. 100" keyboardType="numeric" />
                  <Text style={styles.label}>Roky zkušeností</Text>
                  <TextInput style={styles.input} value={carrierYearsExperience} onChangeText={setCarrierYearsExperience} placeholder="Např. 5" keyboardType="numeric" />
                  <Text style={styles.label}>Dostupnost 24/7</Text>
                  <View style={styles.chips}>
                    <TouchableOpacity style={[styles.chip, carrierAvailable247 && styles.chipActive]} onPress={() => setCarrierAvailable247(true)}>
                      <Text>Ano</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.chip, !carrierAvailable247 && styles.chipActive]} onPress={() => setCarrierAvailable247(false)}>
                      <Text>Ne</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.label}>Veřejný telefon</Text>
                  <View style={styles.chips}>
                    <TouchableOpacity style={[styles.chip, carrierPhonePublic && styles.chipActive]} onPress={() => setCarrierPhonePublic(true)}>
                      <Text>Ano</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.chip, !carrierPhonePublic && styles.chipActive]} onPress={() => setCarrierPhonePublic(false)}>
                      <Text>Ne</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.label}>Veřejný e-mail</Text>
                  <View style={styles.chips}>
                    <TouchableOpacity style={[styles.chip, carrierEmailPublic && styles.chipActive]} onPress={() => setCarrierEmailPublic(true)}>
                      <Text>Ano</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.chip, !carrierEmailPublic && styles.chipActive]} onPress={() => setCarrierEmailPublic(false)}>
                      <Text>Ne</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.label}>Kontakt pro zákazníky</Text>
                  <Text style={styles.muted}>Tyto údaje se zobrazí zákazníkům, kterým odešlete cenovou nabídku.</Text>
                  <Text style={styles.label}>Telefon</Text>
                  <TextInput style={styles.input} value={carrierPublicPhone} onChangeText={setCarrierPublicPhone} placeholder="+420 777 123 456" keyboardType="phone-pad" />
                  <Text style={styles.label}>E-mail</Text>
                  <TextInput style={styles.input} value={carrierPublicEmail} onChangeText={setCarrierPublicEmail} placeholder="napriklad@dopravce.cz" keyboardType="email-address" autoCapitalize="none" />
                  <TouchableOpacity style={styles.primary} onPress={saveCarrierProfile} disabled={carrierProfileLoading}>
                    <Text style={styles.primaryText}>{carrierProfileLoading ? "Ukládám..." : "Uložit přepravní profil"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={() => setCarrierProfileEditing(false)} disabled={carrierProfileLoading}>
                    <Text style={styles.secondaryText}>Zrušit</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.profileCard}>
                  <Text style={styles.profileFieldLabel}>Název / jméno</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.display_name || "Neuvedeno"}</Text>
                  <Text style={styles.profileFieldLabel}>Typ podnikání</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.business_type === "company" ? "Firma" : "OSVČ"}</Text>
                  <Text style={styles.profileFieldLabel}>IČO</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.ico || "Neuvedeno"}</Text>
                  <Text style={styles.profileFieldLabel}>Popis</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.description || "Neuvedeno"}</Text>
                  <Text style={styles.profileFieldLabel}>Oblast působení</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.service_area || "Neuvedeno"}</Text>
                  <Text style={styles.profileFieldLabel}>Maximální vzdálenost</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.max_radius_km == null ? "Neuvedeno" : `${carrierProfile.max_radius_km} km`}</Text>
                  <Text style={styles.profileFieldLabel}>Roky zkušeností</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.years_experience == null ? "Neuvedeno" : carrierProfile.years_experience}</Text>
                  <Text style={styles.profileFieldLabel}>Dostupnost 24/7</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.available_24_7 ? "Ano" : "Ne"}</Text>
                  <Text style={styles.profileFieldLabel}>Veřejný telefon</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.public_phone || "Neuvedeno"}</Text>
                  <Text style={styles.profileFieldLabel}>Veřejný e-mail</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.public_email || "Neuvedeno"}</Text>
                  <Text style={styles.profileFieldLabel}>Stav profilu</Text>
                  <Text style={styles.profileFieldValue}>{carrierProfile.status || "Neuvedeno"}</Text>
                  <TouchableOpacity style={styles.primary} onPress={() => setCarrierProfileEditing(true)}>
                    <Text style={styles.primaryText}>Upravit přepravní profil</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : (
              <View style={styles.profileCard}>
                <Text style={styles.profileFieldLabel}>Přepravní profil</Text>
                <Text style={styles.profileFieldValue}>Zatím není aktivovaný.</Text>
                <TouchableOpacity style={styles.primary} onPress={activateCarrierProfile} disabled={carrierProfileLoading}>
                  <Text style={styles.primaryText}>{carrierProfileLoading ? "Aktivuji..." : "Aktivovat přepravní profil"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.empty}>Profil se nepodařilo načíst.</Text>
        )}

        {/* Akce a odkazy */}
        {carrierProfile ? (
          <>
            <TouchableOpacity style={styles.customerActionRow} onPress={() => navigateLegacy("vehicles")}>
              <Text style={styles.customerActionIcon}>▤</Text>
              <Text style={styles.customerActionText}>Moje vozidla</Text>
              <Text style={styles.customerActionArrow}>›</Text>
            </TouchableOpacity>
            <View style={styles.profileLinkCard}>
              <Text style={styles.profileLinkTitle}>Ověření</Text>
              <Text style={styles.profileLinkText}>{verificationStatus === "verified" ? "Ověřeno" : verificationStatus === "rejected" ? "Zamítnuto" : verificationStatus === "pending" ? "Čeká na ověření" : "Zatím bez stavu"}</Text>
            </View>
            <View style={styles.profileLinkCard}>
              <Text style={styles.profileLinkTitle}>Pojištění</Text>
              <Text style={styles.profileLinkText}>{insuranceStatus || "Zatím bez stavu"}</Text>
            </View>
          </>
        ) : null}

        <TouchableOpacity style={styles.profileLinkCard} onPress={() => { navigateLegacy("transport"); }}>
          <Text style={styles.profileLinkTitle}>Moje poptávky</Text>
          <Text style={styles.profileLinkText}>Otevřít moje přepravní poptávky</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.profileLinkCard} onPress={() => navigateLegacy("home")}>
          <Text style={styles.profileLinkTitle}>Moje aktivita</Text>
          <Text style={styles.profileLinkText}>Otevřít osobní přehled přeprav a nabídek</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.profileLogoutRow} onPress={() => {}}>
          <Text style={styles.profileLogoutText}>Odhlásit se</Text>
        </TouchableOpacity>
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}
