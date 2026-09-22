import React, { useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { supabase } from "../../lib/supabase";
import { formatPostgresTime } from "../../lib/labels";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";

export default function OfferFormRoute() {
  const { userId, transportState, profileState, setTransportTab } = useAppContext();
  const { activeJob } = transportState;
  const { carrierProfile, ensureCarrierProfile } = profileState;
  const [offerPrice, setOfferPrice] = useState("");
  const [offerArrivalDate, setOfferArrivalDate] = useState<Date | null>(null);
  const [offerArrivalTime, setOfferArrivalTime] = useState<Date | null>(null);
  const [offerMessage, setOfferMessage] = useState("");
  const [showOfferDatePicker, setShowOfferDatePicker] = useState(false);
  const [showOfferTimePicker, setShowOfferTimePicker] = useState(false);
  const [submittingOffer, setSubmittingOffer] = useState(false);

  const goBack = () => navigateLegacy("job");

  async function submitOffer() {
    if (!userId) {
      navigateLegacy("login");
      return;
    }
    if (!activeJob || submittingOffer) return;

    if (activeJob.customerId && activeJob.customerId === userId) {
      Alert.alert("RoadLink", "Na vlastní poptávku nelze odeslat cenovou nabídku.");
      return;
    }

    const providerProfile = carrierProfile || await ensureCarrierProfile();
    if (!providerProfile) {
      Alert.alert("RoadLink", "Pro odeslání nabídky je potřeba aktivní přepravní profil.");
      return;
    }

    const price = Number(offerPrice);
    if (!Number.isFinite(price)) {
      Alert.alert("Chyba", "Zadejte platnou cenu.");
      return;
    }

    if (!offerArrivalDate || !offerArrivalTime) {
      Alert.alert("Chybí čas příjezdu", "Zadejte datum a čas předpokládaného příjezdu.");
      return;
    }

    const offerArrivalDateTime = new Date(offerArrivalDate);
    offerArrivalDateTime.setHours(offerArrivalTime.getHours(), offerArrivalTime.getMinutes(), 0, 0);

    if (offerArrivalDateTime < new Date()) {
      Alert.alert("Neplatný čas", "Předpokládaný příjezd nemůže být v minulosti.");
      return;
    }

    setSubmittingOffer(true);
    try {
      const { error } = await supabase.from("tow_offers").insert({
        tow_request_id: activeJob.id,
        driver_id: userId,
        price,
        estimated_arrival_at: offerArrivalDateTime.toISOString(),
        message: offerMessage,
        status: "pending",
      });

      if (error) {
        console.error("Create tow offer:", error.message);
        if ((error as { code?: string }).code === "23505") {
          Alert.alert("Nabídka již existuje", "Pro tuto poptávku už máte aktivní cenovou nabídku. Nejprve vyčkejte na její vyřízení.");
        } else {
          Alert.alert("Chyba", "Nabídku se nepodařilo odeslat. Zkuste to prosím znovu.");
        }
        return;
      }

      Alert.alert("Nabídka odeslána", "Zadavatel poptávky nyní může vaši nabídku vybrat.");
      setOfferPrice("");
      setOfferArrivalDate(null);
      setOfferArrivalTime(null);
      setOfferMessage("");
      setTransportTab("requests");
      navigateLegacy("transport");
    } finally {
      setSubmittingOffer(false);
    }
  }

  if (!activeJob) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Nabídka ceny" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.empty}>Poptávka není dostupná.</Text>
          <TouchableOpacity style={styles.secondary} onPress={() => navigateLegacy("transport")}>
            <Text style={styles.secondaryText}>Zpět na přepravu</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Nabídka ceny" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.bigTitle}>{activeJob.vehicle} • {activeJob.problem}</Text>
        <Text style={styles.muted}>→ {activeJob.destination}</Text>
        <Text style={styles.label}>Cena</Text>
        <TextInput style={styles.input} value={offerPrice} onChangeText={setOfferPrice} placeholder="Cena v Kč" keyboardType="numeric" />
        <Text style={styles.label}>Předpokládaný příjezd</Text>
        <TouchableOpacity style={styles.secondary} onPress={() => setShowOfferDatePicker(true)}>
          <Text style={styles.secondaryText}>{offerArrivalDate ? `📅 ${offerArrivalDate.toLocaleDateString("cs-CZ")}` : "📅 Vyberte datum"}</Text>
        </TouchableOpacity>
        {showOfferDatePicker ? (
          <DateTimePicker value={offerArrivalDate || new Date()} mode="date" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowOfferDatePicker(false); if (event.type === "set" && date) setOfferArrivalDate(date); }} />
        ) : null}
        <TouchableOpacity style={styles.secondary} onPress={() => setShowOfferTimePicker(true)}>
          <Text style={styles.secondaryText}>{offerArrivalTime ? `🕐 ${formatPostgresTime(offerArrivalTime).slice(0, 5)}` : "🕐 Vyberte čas"}</Text>
        </TouchableOpacity>
        {showOfferTimePicker ? (
          <DateTimePicker value={offerArrivalTime || new Date()} mode="time" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowOfferTimePicker(false); if (event.type === "set" && date) setOfferArrivalTime(date); }} />
        ) : null}
        <Text style={styles.label}>Zpráva</Text>
        <TextInput style={styles.input} value={offerMessage} onChangeText={setOfferMessage} placeholder="Doplňující informace" multiline />
        <TouchableOpacity style={styles.primary} onPress={submitOffer} disabled={submittingOffer}>
          <Text style={styles.primaryText}>{submittingOffer ? "ODESÍLÁM…" : "Odeslat nabídku"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={goBack}>
          <Text style={styles.secondaryText}>Zpět na poptávku</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
