import React, { useState } from "react";
import { Alert, Linking } from "react-native";
import OfferProviderDetailsScreen from "../OfferProviderDetailsScreen";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { supabase } from "../../lib/supabase";

async function openContactUrl(url: string, failureMessage: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("Chyba", failureMessage);
      return;
    }
    await Linking.openURL(url);
  } catch (e) {
    console.error("Open contact URL:", e);
    Alert.alert("Chyba", failureMessage);
  }
}

export default function ProviderProfileRoute() {
  const {
    selectedOfferId,
    selectedProviderProfile,
    providerProfileLoading,
    providerProfileError,
    transportState,
  } = useAppContext();
  const { activeJob, offers, loadCustomerRequests, loadOffers, setJobs } = transportState;
  const profileOffer = offers.find((offer) => offer.id === selectedOfferId) || null;
  const [selectingProvider, setSelectingProvider] = useState(false);

  async function selectProvider() {
    if (!profileOffer || selectingProvider || !activeJob) return;
    setSelectingProvider(true);
    const { error } = await supabase.rpc("select_tow_offer", { p_offer_id: profileOffer.id });
    if (error) {
      console.error("Select offer:", error.message);
      Alert.alert("Chyba", "Nabídku se nepodařilo vybrat.");
      setSelectingProvider(false);
      return;
    }
    const refreshedRequests = await loadCustomerRequests();
    const refreshedJob = refreshedRequests?.find((job) => job.id === activeJob.id);
    if (refreshedJob) {
      setJobs((current) => current.some((job) => job.id === activeJob.id) ? current.map((job) => job.id === activeJob.id ? refreshedJob : job) : [...current, refreshedJob]);
    }
    await loadOffers();
    setSelectingProvider(false);
    Alert.alert("✓ PŘEPRAVCE VYBRÁN", "Poptávka má nyní stav:\nVybrán přepravce");
    navigateLegacy("job");
  }

  function confirmSelectProvider() {
    if (!profileOffer) return;
    const price = profileOffer.price === null ? "cenu dohodou" : `${profileOffer.price.toLocaleString("cs-CZ")} Kč`;
    Alert.alert("Vybrat přepravce?", `Chcete vybrat tuto nabídku za ${price}? Po potvrzení bude tento přepravce vybrán pro vaši poptávku.`, [
      { text: "Zrušit", style: "cancel" },
      { text: "Vybrat přepravce", onPress: selectProvider },
    ]);
  }

  return (
    <OfferProviderDetailsScreen
      profile={selectedProviderProfile}
      offer={profileOffer}
      loading={providerProfileLoading}
      error={providerProfileError}
      canSelectProvider={Boolean(activeJob && activeJob.status === "open")}
      selectingProvider={selectingProvider}
      onBack={() => navigateLegacy("job")}
      onCallProvider={(phone) => openContactUrl(`tel:${phone}`, "Telefon se nepodařilo otevřít.")}
      onEmailProvider={(email) => openContactUrl(`mailto:${email}`, "E-mailovou aplikaci se nepodařilo otevřít.")}
      onSelectProvider={confirmSelectProvider}
    />
  );
}
