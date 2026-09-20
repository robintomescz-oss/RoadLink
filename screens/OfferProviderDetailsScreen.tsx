import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  DetailInfoRow,
  DetailPrimaryAction,
  DetailSecondaryAction,
  DetailSection,
  DetailShell,
} from "../components/transport/DetailComponents";
import { colors, spacing } from "../lib/theme";

type OfferProviderDetailsProfile = {
  display_name: string | null;
  company_name: string | null;
  business_type: string | null;
  ico: string | null;
  description: string | null;
  service_area: string | null;
  max_radius_km: number | null;
  years_experience: number | null;
  available_24_7: boolean;
  public_phone: string | null;
  public_email: string | null;
};

type OfferProviderDetailsOffer = {
  status: "pending" | "accepted" | "rejected" | "withdrawn";
};

type OfferProviderDetailsScreenProps = {
  profile: OfferProviderDetailsProfile | null;
  offer: OfferProviderDetailsOffer | null;
  loading: boolean;
  error: boolean;
  canSelectProvider: boolean;
  selectingProvider: boolean;
  onBack: () => void;
  onCallProvider: (phone: string) => void;
  onEmailProvider: (email: string) => void;
  onSelectProvider: () => void;
};

function providerBusinessTypeLabel(businessType: string | null | undefined) {
  const normalizedBusinessType = businessType?.trim();
  if (normalizedBusinessType === "company") return "Firma";
  if (normalizedBusinessType === "individual") return "OSVČ";
  return "Neuvedeno";
}

export default function OfferProviderDetailsScreen({
  profile,
  offer,
  loading,
  error,
  canSelectProvider,
  selectingProvider,
  onBack,
  onCallProvider,
  onEmailProvider,
  onSelectProvider,
}: OfferProviderDetailsScreenProps) {
  const profileName = profile
    ? (profile.company_name?.trim() || profile.display_name?.trim() || "Přepravce")
    : "Přepravce";
  const publicPhone = profile?.public_phone?.trim() || "";
  const publicEmail = profile?.public_email?.trim() || "";
  const hasProviderContact = publicPhone || publicEmail;
  const profileBusinessType = providerBusinessTypeLabel(profile?.business_type);
  const showSelectProvider = Boolean(offer && canSelectProvider && offer.status === "pending");

  return (
    <DetailShell title="Profil přepravce" onBack={onBack}>
      {loading ? (
        <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Načítám profil přepravce…</Text></View>
      ) : error ? (
        <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Profil přepravce se nepodařilo načíst.</Text></View>
      ) : !profile ? (
        <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Profil přepravce zatím není k dispozici.</Text></View>
      ) : (
        <>
          <View style={styles.providerProfileHeroCard}>
            <Text style={styles.detailEyebrow}>Přepravce</Text>
            <Text style={styles.providerProfileName}>{profileName}</Text>
            <Text style={styles.providerProfileMeta}>{profileBusinessType}</Text>
          </View>
          <DetailSection title="Profil">
            <DetailInfoRow label="Typ přepravce" value={profileBusinessType} />
            <DetailInfoRow label="IČO" value={profile.ico?.trim() || null} />
            <DetailInfoRow label="Oblast působnosti" value={profile.service_area?.trim() || null} />
            <DetailInfoRow label="Maximální dojezd" value={profile.max_radius_km === null ? null : `${profile.max_radius_km} km`} />
            <DetailInfoRow label="Zkušenosti" value={profile.years_experience === null ? null : `${profile.years_experience} let`} />
            <DetailInfoRow label="Dostupnost" value={profile.available_24_7 ? "24/7" : "Neuvedeno"} />
          </DetailSection>
          <DetailSection title="O přepravci">
            {profile.description?.trim() ? (
              <Text style={styles.detailBodyText}>{profile.description.trim()}</Text>
            ) : (
              <Text style={styles.detailBodyMuted}>Popis zatím není zveřejněn.</Text>
            )}
          </DetailSection>
          <DetailSection title="Kontakt">
            {publicPhone ? <DetailInfoRow label="Telefon" value={publicPhone} /> : null}
            {publicEmail ? <DetailInfoRow label="E-mail" value={publicEmail} /> : null}
            {!hasProviderContact ? <Text style={styles.detailBodyMuted}>Kontaktní údaje nejsou zveřejněny.</Text> : null}
            {publicPhone ? <DetailSecondaryAction label="Zavolat" onPress={() => onCallProvider(publicPhone)} /> : null}
            {publicEmail ? <DetailSecondaryAction label="Napsat e-mail" onPress={() => onEmailProvider(publicEmail)} /> : null}
          </DetailSection>
        </>
      )}
      <DetailSecondaryAction label="Zpět k nabídce" onPress={onBack} />
      {showSelectProvider ? (
        <DetailPrimaryAction label="Vybrat přepravce" loadingLabel="Vybírám…" loading={selectingProvider} onPress={onSelectProvider} />
      ) : null}
    </DetailShell>
  );
}

const LOCAL_COLORS = {
  primaryShadow: "#061525",
} as const;

const styles = StyleSheet.create({
  providerProfileHeroCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surface, shadowColor: LOCAL_COLORS.primaryShadow, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  providerProfileName: { color: colors.primaryText, fontSize: 24, lineHeight: 30, fontWeight: "800", marginTop: spacing.xs },
  providerProfileMeta: { color: colors.secondaryText, fontSize: 13, lineHeight: 19, fontWeight: "700", marginTop: 4 },
  detailEyebrow: { color: colors.navy, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  detailBodyText: { color: colors.primaryText, fontSize: 14, lineHeight: 21 },
  detailBodyMuted: { color: colors.secondaryText, fontSize: 14, lineHeight: 21 },
  detailEmptyCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md, backgroundColor: colors.surface },
  detailEmptyTitle: { color: colors.primaryText, fontSize: 15, fontWeight: "800" },
});
