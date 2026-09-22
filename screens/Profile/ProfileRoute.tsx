import React from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav as BottomNav } from "../../components/AppBottomNav";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";

/**
 * screen === "profile" z App.tsx.
 *
 * Redesign do karet: výchozí stav je krátký read-only souhrn (osobní údaje,
 * přepravní profil, vozidla, ověření/pojištění, moje přeprava, účet). Dlouhé
 * editační formuláře se otevřou až akcí „Upravit“ — business logika (hooky,
 * payloady, Supabase) zůstává beze změny.
 */
export default function ProfileRoute() {
  const { profileState, authState, userId, setTransportTab } = useAppContext();
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
    vehicles, vehiclesLoading,
    saveProfile, saveCarrierProfile, activateCarrierProfile, setProfileEditing,
  } = profileState;
  const { signOutLoading, signOutUser } = authState;
  const goBack = () => navigateLegacy("home");

  // Hardwarové Zpět: stejná cesta jako horní „← Přehled“ (jinak by Back ukončil aplikaci).
  useHardwareBackTo("home");

  const openMyTransport = () => {
    setTransportTab("mine");
    navigateLegacy("transport");
  };

  const handleSignOut = () => {
    if (signOutLoading) return; // ochrana proti dvojitému stisku
    signOutUser();
  };

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

  // Nepřihlášený uživatel na Profil nikdy nesmí vidět privátní obrazovku.
  if (!userId) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Profil" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.empty}>Pro zobrazení profilu se přihlaste.</Text>
        </ScrollView>
        <BottomNav />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Profil" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {profile ? (
          <>
            {/* A. Osobní údaje */}
            {profileEditing ? (
              <View style={styles.profileCard}>
                <Text style={styles.profileCardHeading}>Osobní údaje</Text>
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
                <Text style={styles.profileCardHeading}>Osobní údaje</Text>
                <Text style={styles.profileName}>{profile.first_name || "Uživatel"} {profile.last_name || ""}</Text>
                <Text style={styles.profileRole}>RoadLink účet</Text>
                <View style={[styles.profileSummaryRow, { marginTop: 10 }]}>
                  <Text style={styles.profileSummaryLabel}>Telefon</Text>
                  <Text style={styles.profileSummaryValue}>{profile.phone || "Neuvedeno"}</Text>
                </View>
                <View style={styles.profileSummaryRow}>
                  <Text style={styles.profileSummaryLabel}>E-mail</Text>
                  <Text style={styles.profileSummaryValue}>{profile.email}</Text>
                </View>
                <TouchableOpacity style={styles.primary} onPress={() => setProfileEditing(true)}>
                  <Text style={styles.primaryText}>Upravit</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* B. Přepravní profil */}
            {carrierProfileLoading && !carrierProfile ? (
              <View style={styles.profileCard}>
                <Text style={styles.profileCardHeading}>Přepravní profil</Text>
                <Text style={styles.empty}>Načítám přepravní profil…</Text>
              </View>
            ) : carrierProfile ? (
              carrierProfileEditing ? (
                <View style={styles.profileCard}>
                  <Text style={styles.profileCardHeading}>Přepravní profil</Text>
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
                  <Text style={styles.profileCardHeading}>Přepravní profil</Text>
                  <View style={styles.profileSummaryRow}>
                    <Text style={styles.profileSummaryLabel}>Název / jméno</Text>
                    <Text style={styles.profileSummaryValue}>{carrierProfile.display_name || "Neuvedeno"}</Text>
                  </View>
                  <View style={styles.profileSummaryRow}>
                    <Text style={styles.profileSummaryLabel}>Typ podnikání</Text>
                    <Text style={styles.profileSummaryValue}>{carrierProfile.business_type === "company" ? "Firma" : "OSVČ"}</Text>
                  </View>
                  <View style={styles.profileSummaryRow}>
                    <Text style={styles.profileSummaryLabel}>Oblast působení</Text>
                    <Text style={styles.profileSummaryValue}>{carrierProfile.service_area || "Neuvedeno"}</Text>
                  </View>
                  <View style={styles.profileSummaryRow}>
                    <Text style={styles.profileSummaryLabel}>Stav profilu</Text>
                    <Text style={styles.profileSummaryValue}>{carrierProfile.status || "Neuvedeno"}</Text>
                  </View>
                  <TouchableOpacity style={styles.primary} onPress={() => setCarrierProfileEditing(true)}>
                    <Text style={styles.primaryText}>Upravit přepravní profil</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : (
              <View style={styles.profileCard}>
                <Text style={styles.profileCardHeading}>Přepravní profil</Text>
                <Text style={styles.profileSummaryValue}>Zatím není aktivovaný.</Text>
                <TouchableOpacity style={styles.primary} onPress={activateCarrierProfile} disabled={carrierProfileLoading}>
                  <Text style={styles.primaryText}>{carrierProfileLoading ? "Aktivuji..." : "Aktivovat přepravní profil"}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* C. Vozidla */}
            <View style={styles.profileCard}>
              <Text style={styles.profileCardHeading}>Vozidla</Text>
              <Text style={styles.profileSummaryValue}>
                {vehiclesLoading ? "Načítám vozidla…" : vehicles.length === 0 ? "Žádná vozidla" : vehicles.length === 1 ? "1 vozidlo" : `${vehicles.length} vozidel`}
              </Text>
              <TouchableOpacity style={styles.primary} onPress={() => navigateLegacy("vehicles")}>
                <Text style={styles.primaryText}>Spravovat vozidla</Text>
              </TouchableOpacity>
            </View>

            {/* D. Ověření a pojištění */}
            <View style={styles.profileCard}>
              <Text style={styles.profileCardHeading}>Ověření a pojištění</Text>
              <View style={styles.profileSummaryRow}>
                <Text style={styles.profileSummaryLabel}>Ověření</Text>
                <Text style={styles.profileSummaryValue}>{verificationStatus === "verified" ? "Ověřeno" : verificationStatus === "rejected" ? "Zamítnuto" : verificationStatus === "pending" ? "Čeká na ověření" : "Zatím bez stavu"}</Text>
              </View>
              <View style={styles.profileSummaryRow}>
                <Text style={styles.profileSummaryLabel}>Pojištění</Text>
                <Text style={styles.profileSummaryValue}>{insuranceStatus || "Zatím bez stavu"}</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.empty}>Profil se nepodařilo načíst.</Text>
        )}

        {/* E. Moje přeprava */}
        <View style={styles.profileCard}>
          <Text style={styles.profileCardHeading}>Moje přeprava</Text>
          <TouchableOpacity style={styles.customerActionRow} onPress={openMyTransport} accessibilityLabel="Otevřít moje přepravní poptávky">
            <Text style={styles.customerActionIcon}>▤</Text>
            <Text style={styles.customerActionText}>Moje poptávky</Text>
            <Text style={styles.customerActionArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customerActionRow} onPress={openMyTransport} accessibilityLabel="Otevřít moji aktivitu v přepravě">
            <Text style={styles.customerActionIcon}>▤</Text>
            <Text style={styles.customerActionText}>Moje aktivita</Text>
            <Text style={styles.customerActionArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* F. Účet */}
        <TouchableOpacity
          style={styles.profileLogoutRow}
          onPress={handleSignOut}
          disabled={signOutLoading}
          accessibilityLabel="Odhlásit se"
          accessibilityState={{ busy: signOutLoading }}
        >
          <Text style={styles.profileLogoutText}>{signOutLoading ? "Odhlašuji…" : "Odhlásit se"}</Text>
        </TouchableOpacity>
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}
