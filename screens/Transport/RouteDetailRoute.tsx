import React, { useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav } from "../../components/AppBottomNav";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackAction } from "../../hooks/useBackHandlers";
import { styles } from "../../lib/appStyles";
import {
  carrierRouteDepartureLabel,
  carrierRoutePriceLabel,
  requestTimingLabel,
  routeDisplayLabel,
  transportStatusLabel,
  vehicleMobilityLabel,
} from "../../lib/labels";
import { supabase } from "../../lib/supabase";
import type { Job } from "../../lib/types";

export default function RouteDetailRoute() {
  const { userId, setActiveJobId, setRequestViewMode, setTransportTab, transportState } = useAppContext();
  const {
    activeRoute,
    activeRouteId,
    customerRequests,
    loadCustomerRequests,
    routeInterestedRequests,
    routeInterestsLoading,
    routeInterestsError,
    setJobs,
  } = transportState;
  const [interestSelectionVisible, setInterestSelectionVisible] = useState(false);
  const [interestSubmitting, setInterestSubmitting] = useState(false);

  const backToCapacity = () => {
    setTransportTab("capacity");
    navigateLegacy("transport");
  };

  // Hardwarové Zpět = stejná cesta jako horní ‹ Zpět (jinak by Back ukončil aplikaci).
  useHardwareBackAction(backToCapacity);

  async function handleInterestPress() {
    if (!userId) {
      navigateLegacy("login");
      return;
    }
    const requests = await loadCustomerRequests();
    if (!requests) {
      Alert.alert("Chyba", "Nepodařilo se načíst vaše poptávky. Zkuste to prosím znovu.");
      return;
    }
    const openRequests = requests.filter((req) => req.status === "open");
    if (openRequests.length === 0) {
      Alert.alert("Žádná poptávka", "Nejdřív vytvořte poptávku přepravy.", [
        { text: "Zrušit", style: "cancel" },
        { text: "Vytvořit poptávku", onPress: () => navigateLegacy("request") },
      ]);
    } else {
      setInterestSelectionVisible(true);
    }
  }

  async function submitInterest(requestId: string) {
    if (!activeRouteId || !userId || interestSubmitting) return;
    setInterestSubmitting(true);
    const { error } = await supabase.from("carrier_route_interests").insert({
      carrier_route_id: activeRouteId,
      tow_request_id: requestId,
    });
    setInterestSubmitting(false);
    if (error) {
      if (error.code === "23505") Alert.alert("RoadLink", "Zájem o tuto volnou kapacitu už byl odeslán.");
      else {
        console.error("Submit interest error:", error.message);
        Alert.alert("Chyba", "Zájem se nepodařilo odeslat.");
      }
      return;
    }
    Alert.alert("RoadLink", "Zájem byl odeslán.");
    setInterestSelectionVisible(false);
  }

  function openInterestedRequest(request: Job) {
    setJobs((current) => current.some((job) => job.id === request.id) ? current.map((job) => job.id === request.id ? request : job) : [...current, request]);
    setActiveJobId(request.id);
    setRequestViewMode("provider");
    navigateLegacy("job");
  }

  if (!activeRoute) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Volná kapacita" />
        <View style={styles.appContent}>
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Trasa není dostupná</Text>
            <Text style={styles.emptyCopy}>Zkuste se vrátit na přehled volných kapacit.</Text>
          </View>
          <TouchableOpacity style={styles.secondary} onPress={backToCapacity}>
            <Text style={styles.secondaryText}>Zpět na volné kapacity</Text>
          </TouchableOpacity>
        </View>
        <AppBottomNav />
      </SafeAreaView>
    );
  }

  const openRequestsForInterest = customerRequests.filter((r) => r.status === "open");

  return (
    <SafeAreaView style={styles.container}>
      <Header title={interestSelectionVisible ? "Vybrat poptávku" : "Volná kapacita"} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.requestDetailContent} keyboardShouldPersistTaps="handled">
        {interestSelectionVisible ? (
          <View>
            <Text style={styles.bigTitle}>Vyberte vaši poptávku</Text>
            <Text style={styles.customerDescription}>Kterou poptávku chcete k této trase připojit?</Text>
            {openRequestsForInterest.map((item) => (
              <TouchableOpacity key={item.id} style={styles.dispatchCard} onPress={() => submitInterest(item.id)} disabled={interestSubmitting}>
                <View style={styles.dispatchHeader}><Text style={styles.dispatchLabel}>MOJE POPTÁVKA</Text></View>
                <Text style={styles.dispatchVehicle}>{item.vehicle}</Text>
                <Text style={styles.routeLine}>{routeDisplayLabel(item)}</Text>
                <View style={styles.dispatchFooter}>
                  <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                  <Text style={styles.dispatchArrow}>→</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.secondary} onPress={() => setInterestSelectionVisible(false)} disabled={interestSubmitting}>
              <Text style={styles.secondaryText}>Zrušit</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.detailTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>VOLNÁ KAPACITA</Text>
                <Text style={styles.detailHeroTitle}>{activeRoute.fromAddress} → {activeRoute.toAddress}</Text>
              </View>
            </View>
            <View style={styles.detailSectionFlat}>
              <Text style={styles.sectionLabel}>TRASA</Text>
              <Text style={styles.routeEndpoint}>{activeRoute.fromAddress}</Text>
              <Text style={styles.routeArrowDown}>↓</Text>
              <Text style={styles.routeEndpoint}>{activeRoute.toAddress}</Text>
            </View>
            <View style={styles.detailTwoColumnRow}>
              <View style={styles.detailMiniSection}><Text style={styles.sectionLabel}>ODJEZD</Text><Text style={styles.detailValueStrong}>{carrierRouteDepartureLabel(activeRoute.departureAt)}</Text></View>
              <View style={styles.detailMiniSection}><Text style={styles.sectionLabel}>KAPACITA</Text><Text style={styles.detailValueStrong}>{activeRoute.availableSpaces} {activeRoute.availableSpaces === 1 ? "volné místo" : activeRoute.availableSpaces >= 2 && activeRoute.availableSpaces <= 4 ? "volná místa" : "volných míst"}</Text></View>
            </View>
            <View style={styles.detailTwoColumnRow}>
              <View style={styles.detailMiniSection}><Text style={styles.sectionLabel}>VOZIDLO</Text><Text style={styles.detailValueStrong}>{activeRoute.vehicleTypes}</Text></View>
              {activeRoute.price !== null ? <View style={styles.detailMiniSection}><Text style={styles.sectionLabel}>CENA</Text><Text style={styles.detailValueStrong}>{carrierRoutePriceLabel(activeRoute.price)}</Text></View> : null}
            </View>
            {activeRoute.maxDeviationKm !== null ? <View style={styles.detailSectionFlat}><Text style={styles.detailValueStrong}>Max. odchylka {activeRoute.maxDeviationKm} km</Text></View> : null}
            {activeRoute.description ? <View style={styles.detailSectionFlat}><Text style={styles.sectionLabel}>POZNÁMKA</Text><Text style={styles.detailMuted}>{activeRoute.description}</Text></View> : null}

            {activeRoute.driverId === userId ? (
              <View style={styles.detailSectionFlat}>
                <Text style={styles.sectionLabel}>PROJEVENÝ ZÁJEM</Text>
                {routeInterestsLoading ? <Text style={styles.detailMuted}>Načítám projevený zájem…</Text> : routeInterestsError ? <Text style={styles.detailMuted}>Projevený zájem se nepodařilo načíst. Zkuste to prosím znovu.</Text> : routeInterestedRequests.length === 0 ? <Text style={styles.detailMuted}>Zatím žádná poptávka neprojevila zájem o tuto kapacitu.</Text> : routeInterestedRequests.map((item) => (
                  <TouchableOpacity key={item.id} style={styles.dispatchCard} onPress={() => openInterestedRequest(item)}>
                    <View style={styles.dispatchHeader}><Text style={styles.dispatchLabel}>POPTÁVKA</Text><Text style={styles.statusPill}>{transportStatusLabel(item.status)}</Text></View>
                    <Text style={styles.dispatchVehicle}>{item.vehicle}</Text>
                    <Text style={styles.routeLine}>{routeDisplayLabel(item)}</Text>
                    <View style={styles.dispatchFooter}><View><Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text><Text style={styles.dispatchMeta}>{vehicleMobilityLabel(item.vehicleMobility)}</Text></View><Text style={styles.dispatchArrow}>→</Text></View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {activeRoute.driverId !== userId ? <TouchableOpacity style={styles.primary} onPress={handleInterestPress}><Text style={styles.primaryText}>MÁM ZÁJEM O PŘEPRAVU</Text></TouchableOpacity> : null}
            <TouchableOpacity style={styles.secondary} onPress={backToCapacity}><Text style={styles.secondaryText}>Zpět na volné kapacity</Text></TouchableOpacity>
          </>
        )}
      </ScrollView>
      <AppBottomNav />
    </SafeAreaView>
  );
}
