import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../../components/AppHeader";
import { AppBottomNav as BottomNav } from "../../components/AppBottomNav";
import TransportCard from "../../lib/TransportCard";
import { styles } from "../../lib/appStyles";
import {
  carrierRouteDepartureLabel,
  carrierRoutePriceLabel,
  canonicalVehicleType,
  offerCountLabel,
  requestTimingLabel,
  routeDisplayLabel,
  transportStatusLabel,
  vehicleMobilityLabel,
} from "../../lib/labels";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import type { Job, CarrierRoute, AcceptedJob } from "../../lib/types";
import type { PublicMarketplaceRequest, PublicMarketplaceRoute } from "../../lib/publicMarket";
import {
  filterPublicRequests,
  filterPublicRoutes,
  publicCardAuthTarget,
  publicLabelOrFallback,
} from "../../lib/publicMarket";

/** Strip + lowercase for transport filter matching (text + diacritics tolerant). */
function transportFilterText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function formatPublicDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("cs-CZ");
}

export default function TransportRoute() {
  const {
    userId,
    setRequestViewMode,
    transportTab,
    setTransportTab,
    setActiveJobId,
    transportState,
  } = useAppContext();

  useEffect(() => {
    if (transportTab === "mine" && !userId) {
      navigateLegacy("login");
    }
  }, [transportTab, userId]);

  const {
    jobs,
    offerCounts,
    acceptedJobs,
    customerRequests,
    jobsLoading,
    jobsError,
    publicRequests,
    publicRoutes,
    publicMarketLoading,
    publicMarketError,
    acceptedJobsLoading,
    routes,
    setJobs,
  } = transportState;

  const { setActiveRouteId } = transportState;

  useEffect(() => {
    if (transportTab === "mine") {
      if (userId) {
        transportState.loadAcceptedJobs();
        transportState.loadCustomerRequests();
        transportState.loadRoutes("mine");
      }
      return;
    }

    transportState.loadPublicMarketplace();
  }, [transportTab, userId]);

  // lokální filtrační stavy (původně lokální useState v App.tsx)
  const [transportFromFilter, setTransportFromFilter] = useState("");
  const [transportToFilter, setTransportToFilter] = useState("");
  const [transportVehicleFilter, setTransportVehicleFilter] = useState("all");
  const [transportFiltersExpanded, setTransportFiltersExpanded] = useState(false);

  const transportVehicleOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...publicRequests.map((job) => canonicalVehicleType(job.vehicle_type || "")).filter(Boolean),
          ...publicRoutes.flatMap((route) =>
            (route.vehicle_types || []).map(canonicalVehicleType).filter(Boolean)
          ),
        ])
      ),
    [publicRequests, publicRoutes]
  );

  // Veřejné taby (Vše/Poptávky/Volná kapacita) zobrazují VÝHRADNĚ sanitizovaná
  // data z RPC. Private state (jobs/routes/acceptedJobs/customerRequests) slouží
  // jen pro tab „Moje“ a autorizované detaily. Public data se nikdy nevkládají
  // do jobs/routes/activeJob/activeRoute/offers.
  const showPublicFeeds = transportTab !== "mine";
  const publicRequestCards = useMemo(
    () => filterPublicRequests(publicRequests, transportFromFilter, transportToFilter, transportVehicleFilter),
    [publicRequests, transportFromFilter, transportToFilter, transportVehicleFilter]
  );
  const publicRouteCards = useMemo(
    () => filterPublicRoutes(publicRoutes, transportFromFilter, transportToFilter, transportVehicleFilter),
    [publicRoutes, transportFromFilter, transportToFilter, transportVehicleFilter]
  );

  const transportFiltersActive = Boolean(
    transportFromFilter.trim() ||
      transportToFilter.trim() ||
      transportVehicleFilter !== "all"
  );
  const transportActiveFilterCount =
    (transportFromFilter.trim() ? 1 : 0) +
    (transportToFilter.trim() ? 1 : 0) +
    (transportVehicleFilter !== "all" ? 1 : 0);
  const clearTransportFilters = () => {
    setTransportFromFilter("");
    setTransportToFilter("");
    setTransportVehicleFilter("all");
  };

  const handleTransportTabPress = (value: typeof transportTab) => {
    if (value === "mine" && !userId) {
      navigateLegacy("login");
      return;
    }
    setTransportTab(value);
  };

  const myAcceptedTransportCards = acceptedJobs;
  const myRequestCards = customerRequests;

  // Veřejná poptávka: anonym → login (chráněná data se nenačítají dřív);
  // přihlášený → autorizovaný detail přes stávající RLS. Přesná data se
  // nepřenášejí v navigačních parametrech — jen id.
  const openPublicRequestDetail = async (item: PublicMarketplaceRequest) => {
    if (publicCardAuthTarget(userId) === "login") {
      navigateLegacy("login");
      return;
    }
    setActiveJobId(item.public_id);
    setRequestViewMode("provider");
    await transportState.loadAuthorizedJobDetail(item.public_id);
    navigateLegacy("job");
  };

  const openPublicRouteDetail = async (route: PublicMarketplaceRoute) => {
    if (publicCardAuthTarget(userId) === "login") {
      navigateLegacy("login");
      return;
    }
    setActiveRouteId(route.public_id);
    await transportState.loadAuthorizedRouteDetail(route.public_id);
    navigateLegacy("routeDetail");
  };

  const openAcceptedDetail = (item: AcceptedJob) => {
    setActiveJobId(item.id);
    setRequestViewMode("provider");
    setJobs((current: Job[]) =>
      current.some((job) => job.id === item.id)
        ? current.map((job) =>
            job.id === item.id ? (item as unknown as Job) : job
          )
        : [...current, item as unknown as Job]
    );
    navigateLegacy("tracking");
  };

  const openMyRequestDetail = (item: Job) => {
    setActiveJobId(item.id);
    setRequestViewMode("owner");
    setJobs((current: Job[]) =>
      current.some((job) => job.id === item.id) ? current : [...current, item]
    );
    navigateLegacy("job");
  };

  const publicRequestsSection = (
    <View>
      <View style={styles.transportSectionHeader}>
        <Text style={styles.sectionLabel}>POPTÁVKY</Text>
        <Text style={styles.transportCount}>{publicRequestCards.length}</Text>
      </View>
      {publicMarketLoading ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Načítám veřejné poptávky…</Text>
        </View>
      ) : publicMarketError ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Poptávky se nepodařilo načíst</Text>
          <Text style={styles.emptyCopy}>
            Trh není prázdný výsledek — načtení selhalo. Zkuste to znovu.
          </Text>
          <TouchableOpacity
            style={styles.secondary}
            onPress={() => transportState.loadPublicMarketplace()}
            accessibilityLabel="Zkusit znovu načíst veřejné poptávky"
          >
            <Text style={styles.secondaryText}>Zkusit znovu</Text>
          </TouchableOpacity>
        </View>
      ) : publicRequestCards.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>
            {transportFiltersActive
              ? "Žádné poptávky neodpovídají filtrům"
              : "Žádné otevřené poptávky"}
          </Text>
          <Text style={styles.emptyCopy}>
            {transportFiltersActive
              ? "Upravte nebo vymažte filtry a zkuste to znovu."
              : "Nové poptávky zákazníků se zobrazí zde."}
          </Text>
        </View>
      ) : (
        publicRequestCards.map((item) => (
          <TransportCard
            key={item.public_id}
            kind="request"
            badge="POPTÁVKA"
            route={`${publicLabelOrFallback(item.origin_label)} → ${publicLabelOrFallback(item.destination_label)}`}
            vehicle={item.vehicle_type ? canonicalVehicleType(item.vehicle_type) : null}
            meta={[
              item.requested_date ? formatPublicDate(item.requested_date) : null,
              item.vehicle_mobility ? vehicleMobilityLabel(item.vehicle_mobility as never) : null,
            ]}
            status={null}
            actionLabel={userId ? "Detail" : "Přihlásit se"}
            accessibilityLabel={`Veřejná poptávka ${publicLabelOrFallback(item.origin_label)} → ${publicLabelOrFallback(item.destination_label)}`}
            onPress={() => {
              void openPublicRequestDetail(item);
            }}
          />
        ))
      )}
    </View>
  );

  const publicRoutesSection = (
    <View>
      <View style={styles.transportSectionHeader}>
        <Text style={styles.sectionLabel}>VOLNÁ KAPACITA</Text>
        <Text style={styles.transportCount}>{publicRouteCards.length}</Text>
      </View>
      {publicMarketLoading ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Načítám volné kapacity…</Text>
        </View>
      ) : publicMarketError ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Volné kapacity se nepodařilo načíst</Text>
          <Text style={styles.emptyCopy}>
            Trh není prázdný výsledek — načtení selhalo. Zkuste to znovu.
          </Text>
          <TouchableOpacity
            style={styles.secondary}
            onPress={() => transportState.loadPublicMarketplace()}
            accessibilityLabel="Zkusit znovu načíst volné kapacity"
          >
            <Text style={styles.secondaryText}>Zkusit znovu</Text>
          </TouchableOpacity>
        </View>
      ) : publicRouteCards.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>
            {transportFiltersActive ? "Žádné trasy neodpovídají filtrům" : "Žádné otevřené volné trasy"}
          </Text>
          <Text style={styles.emptyCopy}>
            {transportFiltersActive
              ? "Upravte nebo vymažte filtry a zkuste to znovu."
              : "Aktivní nabídky volné kapacity se zobrazí zde."}
          </Text>
        </View>
      ) : (
        publicRouteCards.map((route) => (
          <TransportCard
            key={route.public_id}
            kind="capacity"
            badge="VOLNÁ KAPACITA"
            route={`${publicLabelOrFallback(route.origin_label)} → ${publicLabelOrFallback(route.destination_label)}`}
            vehicle={
              route.vehicle_types && route.vehicle_types.length > 0
                ? route.vehicle_types.map(canonicalVehicleType).join(", ")
                : null
            }
            meta={[
              route.departure_at ? `Odjezd: ${formatPublicDate(route.departure_at)}` : null,
              route.available_spaces !== null
                ? `${route.available_spaces} ${
                    route.available_spaces === 1
                      ? "volné místo"
                      : route.available_spaces >= 2 && route.available_spaces <= 4
                      ? "volná místa"
                      : "volných míst"
                  }`
                : null,
              route.price !== null ? carrierRoutePriceLabel(route.price) : null,
            ]}
            status={null}
            actionLabel={userId ? "Detail trasy" : "Přihlásit se"}
            accessibilityLabel={`Volná kapacita ${publicLabelOrFallback(route.origin_label)} → ${publicLabelOrFallback(route.destination_label)}`}
            onPress={() => {
              void openPublicRouteDetail(route);
            }}
          />
        ))
      )}
    </View>
  );

  const mineSection = (
    <View>
      <View style={styles.transportSectionHeader}>
        <Text style={styles.sectionLabel}>MOJE PŘEPRAVY</Text>
        <Text style={styles.transportCount}>{myAcceptedTransportCards.length}</Text>
      </View>
      {acceptedJobsLoading ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Načítám přijaté zakázky…</Text>
        </View>
      ) : myAcceptedTransportCards.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Zatím nemáte žádnou přijatou přepravu</Text>
        </View>
      ) : (
        myAcceptedTransportCards.map((item) => (
          <TransportCard
            key={item.id}
            kind="capacity"
            badge="PŘEPRAVA"
            route={routeDisplayLabel(item)}
            vehicle={`${item.vehicle} · ${vehicleMobilityLabel(item.vehicleMobility)}`}
            meta={[
              requestTimingLabel(item),
              item.acceptedOffer.price === null
                ? "Cena dohodou"
                : `${item.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`,
            ]}
            status={transportStatusLabel(item.status)}
            actionLabel="Spravovat"
            accessibilityLabel={`Přeprava ${routeDisplayLabel(item)}`}
            onPress={() => openAcceptedDetail(item)}
          />
        ))
      )}

      <View style={styles.transportSectionHeader}>
        <Text style={styles.sectionLabel}>MOJE POPTÁVKY</Text>
        <Text style={styles.transportCount}>{myRequestCards.length}</Text>
      </View>
      {myRequestCards.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Zatím nemáte žádnou vlastní poptávku</Text>
        </View>
      ) : (
        myRequestCards.map((item) => (
          <TransportCard
            key={item.id}
            kind="request"
            badge="MOJE POPTÁVKA"
            route={routeDisplayLabel(item)}
            vehicle={item.vehicle}
            meta={[
              requestTimingLabel(item),
              offerCounts[item.id]
                ? offerCountLabel(offerCounts[item.id])
                : "Bez nabídek",
            ]}
            status={transportStatusLabel(item.status)}
            actionLabel="Detail"
            accessibilityLabel={`Moje poptávka ${routeDisplayLabel(item)}`}
            onPress={() => openMyRequestDetail(item)}
          />
        ))
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.appContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.transportPageHeader}>
          <Text style={styles.transportPageTitle}>Přeprava</Text>
          <Text style={styles.transportPageSubtitle}>
            Trh přepravy — poptávky, volné kapacity i vaše přepravy.
          </Text>
        </View>

        <View style={styles.segmentedBar}>
          {["Vše", "Poptávky", "Volná kapacita", "Moje"].map((label, i) => {
            const value = ["all", "requests", "capacity", "mine"][i] as typeof transportTab;
            return (
              <TouchableOpacity
                key={value}
                style={styles.segmentedItem}
                onPress={() => handleTransportTabPress(value)}
              >
                <Text
                  style={[
                    styles.segmentedText,
                    transportTab === value && styles.segmentedTextActive,
                  ]}
                >
                  {label}
                </Text>
                {transportTab === value ? <View style={styles.segmentedUnderline} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {showPublicFeeds ? (
          <View style={styles.filterPanel}>
            <View style={styles.transportFilterHeader}>
              <TouchableOpacity
                style={styles.filterToggleButton}
                onPress={() => setTransportFiltersExpanded(!transportFiltersExpanded)}
                accessibilityRole="button"
                accessibilityState={{ expanded: transportFiltersExpanded }}
                accessibilityLabel={
                  transportFiltersActive
                    ? `Filtry, ${transportActiveFilterCount} aktivních`
                    : "Filtry"
                }
              >
                <Text style={styles.sectionLabel}>
                  FILTRY{transportFiltersActive ? ` (${transportActiveFilterCount})` : ""}
                </Text>
                <Text style={styles.filterToggleChevron}>
                  {transportFiltersExpanded ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>
              {transportFiltersActive ? (
                <TouchableOpacity onPress={clearTransportFilters} accessibilityLabel="Vymazat filtry">
                  <Text style={styles.detailLink}>Vymazat</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {transportFiltersActive ? (
              <View style={styles.activeFiltersRow}>
                {transportFromFilter.trim() ? (
                  <View style={styles.activeFilterChip}>
                    <Text style={styles.activeFilterChipText}>
                      Odkud: {transportFromFilter.trim()}
                    </Text>
                  </View>
                ) : null}
                {transportToFilter.trim() ? (
                  <View style={styles.activeFilterChip}>
                    <Text style={styles.activeFilterChipText}>
                      Kam: {transportToFilter.trim()}
                    </Text>
                  </View>
                ) : null}
                {transportVehicleFilter !== "all" ? (
                  <View style={styles.activeFilterChip}>
                    <Text style={styles.activeFilterChipText}>
                      Vozidlo: {transportVehicleFilter}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {transportFiltersExpanded ? (
              <View style={styles.filterFields}>
                <TextInput
                  style={styles.input}
                  value={transportFromFilter}
                  onChangeText={setTransportFromFilter}
                  placeholder="Odkud"
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  value={transportToFilter}
                  onChangeText={setTransportToFilter}
                  placeholder="Kam"
                  autoCapitalize="none"
                />
                <Text style={styles.label}>Typ vozidla</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {["all", ...transportVehicleOptions].map((value) => (
                    <TouchableOpacity
                      key={value}
                      style={[
                        styles.chip,
                        transportVehicleFilter === value && styles.chipActive,
                      ]}
                      onPress={() => setTransportVehicleFilter(value)}
                    >
                      <Text>{value === "all" ? "Vše" : value}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}

        {transportTab === "all" ? (
          <>
            {publicRequestsSection}
            {publicRoutesSection}
          </>
        ) : null}
        {transportTab === "requests" ? publicRequestsSection : null}
        {transportTab === "capacity" ? publicRoutesSection : null}
        {transportTab === "mine" ? mineSection : null}
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}
