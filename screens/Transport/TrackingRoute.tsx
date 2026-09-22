import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Text } from "react-native";
import { supabase } from "../../lib/supabase";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import {
  formatOfferArrivalDateTime,
  pickupDisplayLabel,
  requestTimingLabel,
  timePreferenceLabel,
  transportLifecycleStatusLabel,
  transportStatusLabel,
  vehicleMobilityLabel,
  triStateLabel,
} from "../../lib/labels";
import { styles } from "../../lib/appStyles";
import {
  buildTransportStatusContext,
  createTransportStatusController,
  type TransportConfirmationContext,
  type TransportNextStatus,
  type TransportStatusContext,
} from "../../lib/transportLifecycleLogic";
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

export default function TrackingRoute() {
  const { userId, activeJobId, requestViewMode, setTransportTab, currentScreen, transportState } = useAppContext();
  const {
    activeJob,
    selectedOfferForActiveJob,
    loadJobs,
    loadAcceptedJobs,
    loadCustomerRequests,
    loadOffers,
    setJobs,
    setAcceptedJobs,
    setCustomerRequests,
  } = transportState;
  const [transportStatusLoading, setTransportStatusLoading] = useState(false);
  const confirmationIdRef = useRef(0);
  const pendingConfirmationRef = useRef<TransportConfirmationContext | null>(null);
  const submissionRef = useRef(false);
  const currentContextRef = useRef<TransportStatusContext | null>(null);

  const selectedOffer = selectedOfferForActiveJob();
  const currentContext = useMemo(() => buildTransportStatusContext({
    activeJobId,
    activeJob,
    userId,
    screen: currentScreen,
    selectedOffer,
  }), [activeJobId, activeJob, userId, currentScreen, selectedOffer]);
  currentContextRef.current = currentContext;

  useEffect(() => {
    confirmationIdRef.current += 1;
    if (pendingConfirmationRef.current) {
      pendingConfirmationRef.current.used = true;
      pendingConfirmationRef.current = null;
    }
  }, [currentScreen, activeJobId, userId, activeJob?.status, selectedOffer?.driver_id]);

  const goBack = () => {
    setTransportTab(requestViewMode === "owner" ? "mine" : "requests");
    navigateLegacy("transport");
  };

  const controller = createTransportStatusController({
    getCurrentContext: () => currentContextRef.current,
    getCurrentConfirmationId: () => confirmationIdRef.current,
    getPendingConfirmation: () => pendingConfirmationRef.current,
    setPendingConfirmation: (context) => { pendingConfirmationRef.current = context; },
    getSubmissionLocked: () => submissionRef.current,
    setSubmissionLocked: (value) => { submissionRef.current = value; },
    getLoading: () => transportStatusLoading,
    setLoading: setTransportStatusLoading,
    advanceStatus: async (payload) => supabase.rpc("advance_tow_request_status", payload),
    applyOptimisticStatus: (requestId, nextStatus) => {
      setJobs((current) => current.map((job) => job.id === requestId ? { ...job, status: nextStatus } : job));
      setCustomerRequests((current) => current.map((job) => job.id === requestId ? { ...job, status: nextStatus } : job));
      setAcceptedJobs((current) => current.map((job) => job.id === requestId ? { ...job, status: nextStatus } : job));
    },
    refreshAfterStatusUpdate: async () => {
      await loadJobs();
      await loadAcceptedJobs();
      await loadCustomerRequests();
      await loadOffers();
    },
    onError: (error) => {
      console.error("Update transport status:", error && typeof error === "object" && "message" in error ? (error as { message?: string }).message : error);
      Alert.alert("Chyba", "Stav přepravy se nepodařilo změnit. Zkuste to prosím znovu.");
    },
    onNotDriver: () => {
      Alert.alert("RoadLink", "Stav přepravy může měnit pouze vybraný přepravce.");
    },
    showConfirmation: (nextStatus: TransportNextStatus, clearConfirmation, submitConfirmation) => {
      Alert.alert(
        nextStatus === "in_progress" ? "Zahájit přepravu?" : "Dokončit přepravu?",
        nextStatus === "in_progress"
          ? "Potvrďte, že nyní zahajujete tuto přepravu."
          : "Potvrďte, že vozidlo bylo doručeno a přeprava je dokončená.",
        [
          { text: "Zpět", style: "cancel", onPress: clearConfirmation },
          { text: nextStatus === "in_progress" ? "Zahájit přepravu" : "Potvrdit doručení", onPress: submitConfirmation },
        ],
        { cancelable: true, onDismiss: clearConfirmation }
      );
    },
  });

  if (!activeJob) {
    return (
      <DetailShell title="Detail přepravy" onBack={goBack}>
        <DetailSection title="Přeprava není dostupná">
          <Text style={styles.detailBodyText}>Vraťte se prosím zpět na trh přepravy.</Text>
        </DetailSection>
        <DetailSecondaryAction label="Zpět na přepravu" onPress={goBack} />
      </DetailShell>
    );
  }

  const canDriverUpdateTransport = Boolean(selectedOffer && selectedOffer.driver_id === userId);

  return (
    <DetailShell title="Detail přepravy" onBack={goBack}>
      <DetailStatusHeader
        label="Přeprava"
        statusLabel={transportStatusLabel(activeJob.status)}
        vehicle={activeJob.vehicle}
        vehicleModel={activeJob.vehicleModel}
        pickupLabel={pickupDisplayLabel(activeJob)}
        destination={activeJob.destination}
        timingLabel={requestTimingLabel(activeJob)}
        preferenceLabel={activeJob.timePreference && activeJob.timePreference !== "specific" ? timePreferenceLabel(activeJob.timePreference) : null}
      />
      <DetailSection title="Stav přepravy">
        <Text style={styles.detailBodyText}>{transportLifecycleMessage(activeJob.status)}</Text>
        <DetailInfoRow label="Aktuální stav" value={transportLifecycleStatusLabel(activeJob.status)} />
      </DetailSection>
      <DetailSection title="Informace o vozidle">
        <DetailInfoRow label="Typ vozidla" value={activeJob.vehicle} />
        {activeJob.vehicleModel?.trim() ? <DetailInfoRow label="Model" value={activeJob.vehicleModel} /> : null}
        <DetailInfoRow label="Pojízdnost" value={vehicleMobilityLabel(activeJob.vehicleMobility)} />
        {activeJob.canTrailer !== null && activeJob.canTrailer !== undefined ? <DetailInfoRow label="Najede na vlek" value={triStateLabel(activeJob.canTrailer)} /> : null}
        {activeJob.problem?.trim() ? <DetailInfoRow label="Popis" value={activeJob.problem} /> : null}
      </DetailSection>
      {selectedOffer ? (
        <DetailSection title="Vybraná nabídka">
          <Text style={styles.detailPriceText}>{selectedOffer.price === null ? "Cena dohodou" : `${selectedOffer.price.toLocaleString("cs-CZ")} Kč`}</Text>
          {selectedOffer.estimated_arrival_minutes ? <DetailInfoRow label="Příjezd" value={`${selectedOffer.estimated_arrival_minutes} min`} /> : null}
          {selectedOffer.estimated_arrival_at ? <DetailInfoRow label="Příjezd" value={formatOfferArrivalDateTime(selectedOffer.estimated_arrival_at)} /> : null}
          {selectedOffer.message?.trim() ? <DetailInfoRow label="Zpráva" value={selectedOffer.message} /> : null}
        </DetailSection>
      ) : null}
      {canDriverUpdateTransport && activeJob.status === "offer_selected" ? (
        <DetailPrimaryAction label="Zahájit přepravu" loadingLabel="Ukládám…" loading={transportStatusLoading} onPress={() => controller.confirmTransportStatusUpdate("in_progress")} />
      ) : null}
      {canDriverUpdateTransport && activeJob.status === "in_progress" ? (
        <DetailPrimaryAction label="Označit jako doručené" loadingLabel="Ukládám…" loading={transportStatusLoading} onPress={() => controller.confirmTransportStatusUpdate("completed")} />
      ) : null}
      <DetailSecondaryAction label="Zpět na přepravu" onPress={goBack} />
    </DetailShell>
  );
}
