import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import {
  formatOfferArrivalDateTime,
  offerStatusLabel,
  pickupDisplayLabel,
  requestTimingLabel,
  timePreferenceLabel,
  transportLifecycleStatusLabel,
  transportStatusLabel,
  triStateLabel,
  vehicleMobilityLabel,
} from "../../lib/labels";
import { styles } from "../../lib/appStyles";
import type { TowOffer } from "../../lib/types";
import {
  DetailInfoRow,
  DetailPrimaryAction,
  DetailSecondaryAction,
  DetailSection,
  DetailShell,
  DetailStatusHeader,
} from "../../components/transport/DetailComponents";

function transportLifecycleMessage(status?: string) {
  switch (status) {
    case "offer_selected": return "Přepravce byl vybrán. Čeká se na zahájení přepravy.";
    case "in_progress": return "Přeprava probíhá.";
    case "completed": return "Přeprava byla dokončena.";
    case "cancelled": return "Přeprava byla zrušena.";
    default: return "Stav přepravy zatím není dostupný.";
  }
}

export default function JobDetailRoute() {
  const { userId, requestViewMode, setTransportTab, transportState, openProviderProfile, providerProfileLoading, selectedOfferId } = useAppContext();
  const {
    activeJob,
    offers,
    offersLoading,
    loadOffers,
    loadJobs,
    loadCustomerRequests,
    providerNameForOffer,
    activeAcceptedJob,
    setJobs,
    setCustomerRequests,
  } = transportState;
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [cancellingRequest, setCancellingRequest] = useState(false);

  const goBack = () => {
    setTransportTab(requestViewMode === "owner" ? "mine" : "requests");
    navigateLegacy("transport");
  };

  if (!activeJob) {
    return (
      <DetailShell title="Detail poptávky" onBack={goBack}>
        <DetailSection title="Poptávka není dostupná">
          <Text style={styles.detailBodyText}>Vraťte se prosím zpět na trh přepravy.</Text>
        </DetailSection>
        <DetailSecondaryAction label="Zpět na přepravu" onPress={goBack} />
      </DetailShell>
    );
  }

  async function selectOffer(offerId: string) {
    if (!activeJob || selectingOfferId) return;
    setSelectingOfferId(offerId);
    const { error } = await supabase.rpc("select_tow_offer", { p_offer_id: offerId });
    if (error) {
      console.error("Select offer:", error.message);
      Alert.alert("Chyba", "Nabídku se nepodařilo vybrat.");
      setSelectingOfferId(null);
      return;
    }
    const refreshedRequests = await loadCustomerRequests();
    const refreshedJob = refreshedRequests?.find((job) => job.id === activeJob.id);
    if (refreshedJob) {
      setJobs((current) => current.some((job) => job.id === activeJob.id) ? current.map((job) => job.id === activeJob.id ? refreshedJob : job) : [...current, refreshedJob]);
    }
    await loadOffers();
    setSelectingOfferId(null);
    Alert.alert("✓ PŘEPRAVCE VYBRÁN", "Poptávka má nyní stav:\nVybrán přepravce");
  }

  function confirmSelectOffer(offer: TowOffer) {
    const price = offer.price === null ? "cenu dohodou" : `${offer.price.toLocaleString("cs-CZ")} Kč`;
    Alert.alert("Vybrat přepravce?", `Chcete vybrat tuto nabídku za ${price}? Po potvrzení bude tento přepravce vybrán pro vaši poptávku.`, [
      { text: "Zrušit", style: "cancel" },
      { text: "Vybrat přepravce", onPress: () => selectOffer(offer.id) },
    ]);
  }

  async function cancelRequest() {
    if (!activeJob || cancellingRequest || activeJob.status !== "open") return;
    setCancellingRequest(true);
    const { error } = await supabase.rpc("cancel_tow_request", { p_tow_request_id: activeJob.id });
    if (error) {
      console.error("Cancel request:", error.message);
      Alert.alert("Chyba", "Poptávku se nepodařilo zrušit. Zkuste to prosím znovu.");
      setCancellingRequest(false);
      return;
    }
    const refreshedRequests = await loadCustomerRequests();
    const refreshedJob = refreshedRequests?.find((job) => job.id === activeJob.id);
    if (refreshedJob) {
      setJobs((current) => current.map((job) => job.id === activeJob.id ? refreshedJob : job));
      setCustomerRequests((current) => current.map((job) => job.id === activeJob.id ? refreshedJob : job));
    }
    await loadOffers();
    setCancellingRequest(false);
    Alert.alert("Poptávka zrušena", "Poptávka byla zrušena.");
  }

  function confirmCancelRequest() {
    Alert.alert("Zrušit poptávku?", "Opravdu chcete tuto poptávku zrušit? Přepravci už na ni nebudou moci odesílat nabídky.", [
      { text: "ZPĚT", style: "cancel" },
      { text: "ZRUŠIT POPTÁVKU", style: "destructive", onPress: cancelRequest },
    ]);
  }

  const ownerMode = requestViewMode === "owner";

  return (
    <DetailShell title="Detail poptávky" onBack={goBack}>
      <DetailStatusHeader
        label={ownerMode ? "Moje poptávka" : "Poptávka"}
        statusLabel={transportStatusLabel(activeJob.status)}
        vehicle={activeJob.vehicle}
        vehicleModel={activeJob.vehicleModel}
        pickupLabel={pickupDisplayLabel(activeJob)}
        destination={activeJob.destination}
        timingLabel={requestTimingLabel(activeJob)}
        preferenceLabel={activeJob.timePreference && activeJob.timePreference !== "specific" ? timePreferenceLabel(activeJob.timePreference) : null}
      />

      <DetailSection title="Informace o přepravě">
        <DetailInfoRow label="Vozidlo" value={activeJob.vehicle} />
        {activeJob.vehicleModel?.trim() ? <DetailInfoRow label="Model" value={activeJob.vehicleModel} /> : null}
        <DetailInfoRow label="Pojízdnost" value={vehicleMobilityLabel(activeJob.vehicleMobility)} />
        {activeJob.canTrailer !== null && activeJob.canTrailer !== undefined ? <DetailInfoRow label="Najede na vlek" value={triStateLabel(activeJob.canTrailer)} /> : null}
        {activeJob.problem?.trim() ? <DetailInfoRow label="Popis" value={activeJob.problem} /> : null}
      </DetailSection>

      {ownerMode ? (
        <>
          <View style={styles.detailSectionHeaderRow}>
            <Text style={styles.detailSectionTitleV2}>Cenové nabídky</Text>
            <DetailSecondaryAction label="Obnovit" onPress={loadOffers} />
          </View>
          {offersLoading ? (
            <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Načítám cenové nabídky…</Text></View>
          ) : offers.length === 0 ? (
            <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Zatím bez cenových nabídek.</Text><Text style={styles.detailEmptyText}>Jakmile přepravce odešle cenu, zobrazí se tady.</Text></View>
          ) : offers.map((offer) => (
            <View key={offer.id} style={[styles.detailOfferCard, offer.status === "accepted" && styles.detailOfferAccepted, offer.status === "rejected" && styles.detailOfferRejected]}>
              <View style={styles.detailStatusTopRow}>
                <Text style={styles.detailEyebrow}>Přepravce</Text>
                <Text style={styles.detailStatusPill}>{offerStatusLabel(offer.status)}</Text>
              </View>
              <Text style={styles.detailProviderName}>{providerNameForOffer(offer)}</Text>
              <Text style={styles.detailPriceText}>{offer.price === null ? "Cena dohodou" : `${offer.price.toLocaleString("cs-CZ")} Kč`}</Text>
              {offer.estimated_arrival_minutes ? <DetailInfoRow label="Příjezd" value={`${offer.estimated_arrival_minutes} min`} /> : null}
              {offer.estimated_arrival_at ? <DetailInfoRow label="Příjezd" value={formatOfferArrivalDateTime(offer.estimated_arrival_at)} /> : null}
              {offer.message?.trim() ? <Text style={styles.detailOfferMessage}>{offer.message}</Text> : null}
              {activeJob.status === "open" && offer.status === "pending" ? <DetailPrimaryAction label="Vybrat přepravce" loadingLabel="Vybírám…" loading={selectingOfferId === offer.id} onPress={() => confirmSelectOffer(offer)} /> : null}
              <DetailSecondaryAction label="Zobrazit profil" loadingLabel="Načítám…" loading={providerProfileLoading && selectedOfferId === offer.id} onPress={() => openProviderProfile(offer)} />
            </View>
          ))}
          {(activeJob.status === "offer_selected" || activeJob.status === "in_progress" || activeJob.status === "completed") ? (
            <DetailSection title="Přeprava">
              <Text style={styles.detailBodyText}>{transportLifecycleMessage(activeJob.status)}</Text>
              <DetailPrimaryAction label="Přejít k přepravě" onPress={() => navigateLegacy("tracking")} />
            </DetailSection>
          ) : null}
          {activeJob.status === "open" ? (
            <View style={styles.detailDangerZone}>
              <Text style={styles.detailDangerTitle}>Zrušení poptávky</Text>
              <Text style={styles.detailDangerCopy}>Sekundární akce. Po potvrzení už přepravci nebudou moci posílat nabídky.</Text>
              <DetailSecondaryAction label="Zrušit poptávku" loadingLabel="Ruším…" loading={cancellingRequest} destructive onPress={confirmCancelRequest} />
            </View>
          ) : null}
          <DetailSecondaryAction label="Zpět na moje poptávky" onPress={goBack} />
        </>
      ) : (
        <DetailSection title="Akce">
          {activeJob.status === "open" ? (
            activeJob.customerId && activeJob.customerId === userId ? (
              <Text style={styles.detailBodyMuted}>Na vlastní poptávku nelze odeslat cenovou nabídku.</Text>
            ) : (
              <>
                <Text style={styles.detailBodyMuted}>Pošlete zákazníkovi svou cenu a dostupné informace k příjezdu.</Text>
                <DetailPrimaryAction label="Nabídnout cenu" onPress={() => userId ? navigateLegacy("offerForm") : navigateLegacy("login")} />
              </>
            )
          ) : (
            <>
              <DetailInfoRow label="Stav" value={transportLifecycleStatusLabel(activeJob.status)} />
              {(activeJob.status === "offer_selected" || activeJob.status === "in_progress" || activeJob.status === "completed") ? <DetailPrimaryAction label="Přejít k přepravě" onPress={() => navigateLegacy("tracking")} /> : null}
            </>
          )}
          {activeJob.status === "offer_selected" && activeAcceptedJob?.id === activeJob.id ? (
            <DetailInfoRow label="Vaše nabídka" value={activeAcceptedJob.acceptedOffer.price === null ? "Cena dohodou" : `${activeAcceptedJob.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`} />
          ) : null}
        </DetailSection>
      )}
    </DetailShell>
  );
}
