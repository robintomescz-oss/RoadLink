// ---------------------------------------------------------------------------
// ZMRAZENÝ LEGACY SOUBOR — není součástí běžící aplikace.
//
// Vstupní bod aplikace je index.js -> navigation/AppNavigator. Tento soubor je
// původní monolitický App.tsx z doby před rozdělením a slouží už jen jako
// referenční záloha původního chování. Adresář legacy/ je vyloučený z typechecku
// (viz tsconfig.json) a nic ho neimportuje.
//
// Neopravujte v něm chyby a nehledejte v něm aktuální pravdu: kopie handlerů
// tu už jsou zastaralé. Živá spodní lišta používá klíč "overview", který
// naviguje na route "home".
// Živá logika je v components/, hooks/, lib/, navigation/ a screens/.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  FlatList,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import GlobalHome from "../lib/GlobalHome";
import TransportCard from "../lib/TransportCard";
import OfferProviderDetailsScreen from "../screens/OfferProviderDetailsScreen";
import {
  DetailInfoRow,
  DetailPrimaryAction,
  DetailSecondaryAction,
  DetailSection,
  DetailShell,
  DetailStatusHeader,
} from "../components/transport/DetailComponents";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type Job,
  type JobStatus,
  type OfferProviderProfile,
  type RequestViewMode,
  type Role,
  type TimeFilter,
  type TimePreference,
  type TowOffer,
  type VehicleMobility,
} from "../lib/types";
import {
  canonicalVehicleType,
  carrierRouteDepartureLabel,
  carrierRoutePriceLabel,
  formatOfferArrivalDateTime,
  formatPostgresDate,
  formatPostgresTime,
  offerCountLabel,
  offerStatusLabel,
  pickupDisplayLabel,
  requestTimingLabel,
  routeDisplayLabel,
  statusLabel,
  timePreferenceLabel,
  transportLifecycleStatusLabel,
  transportStatusLabel,
  triStateLabel,
  vehicleMobilityLabel,
} from "../lib/labels";
import { coordinatesFromValues, geocodeAddress } from "../lib/geocode";
import {
  capacitySnapshot,
  fieldsToLoadingOption,
  LOADING_STATE_OPTIONS,
  loadingOptionToFields,
  requestSnapshot,
  validateCapacityForm,
  validateRequestForm,
  type CapacityErrorKey,
  type LoadingStateOption,
  type RequestErrorKey,
} from "../lib/createFormLogic";
import { DEFAULT_REGION } from "../lib/design";
import { styles } from "../lib/appStyles";
import { useLocation } from "../hooks/useLocation";
import { useJobFilters } from "./useJobFilters";
import { useTransportData } from "../hooks/useTransportData";
import { useAuth } from "./useAuth";
import { useProfile } from "../hooks/useProfile";
import { AppHeader as Header } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
import { SafeAreaView } from "../components/SafeAreaViewCompat";
import { CreateScreen, RequestSuccessScreen, RoleScreen, SosScreen } from "../screens/LeafScreens";






function App() {
  const [screen, setScreen] = useState("home");
  const [role, setRole] = useState<Role>("customer");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const {
    userId,
    setUserId,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginLoading,
    signOutLoading,
    registrationFirstName,
    setRegistrationFirstName,
    registrationLastName,
    setRegistrationLastName,
    registrationPhone,
    setRegistrationPhone,
    registrationEmail,
    setRegistrationEmail,
    registrationPassword,
    setRegistrationPassword,
    registrationPasswordConfirmation,
    setRegistrationPasswordConfirmation,
    registrationLoading,
    loginUser,
    registerUser,
    signOutUser,
  } = useAuth({ setScreen, onUnauthenticated: () => clearLocalUserState() });
  const { location, locationError, requestLocation } = useLocation();
  const [pickupText, setPickupText] = useState("");
  const [destination, setDestination] = useState("");
  const [vehicle, setVehicle] = useState("Osobní automobil");
  const [problem, setProblem] = useState("Porucha");
  const [timePreference, setTimePreference] = useState<TimePreference>("asap");
  const [requestedDate, setRequestedDate] = useState<Date | null>(null);
  const [requestedEndDate, setRequestedEndDate] = useState<Date | null>(null);
  const [dateMode, setDateMode] = useState<"concrete" | "window">("concrete");
  const [vehicleMobility, setVehicleMobility] = useState<VehicleMobility>("drivable");
  const [requestVehicleModel, setRequestVehicleModel] = useState("");
  const [canTrailer, setCanTrailer] = useState<boolean | null>(null);
  const [loadingStateOption, setLoadingStateOption] = useState<LoadingStateOption | null>("drive");
  const [requestErrors, setRequestErrors] = useState<Partial<Record<RequestErrorKey, string>>>({});
  const [requestInitialSnapshot, setRequestInitialSnapshot] = useState<string | null>(null);
  const requestScrollRef = useRef<ScrollView | null>(null);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const {
    jobs,
    setJobs,
    jobsLoading,
    acceptedJobs,
    setAcceptedJobs,
    acceptedJobsLoading,
    customerRequests,
    setCustomerRequests,
    offerCounts,
    routes,
    routesLoading,
    routesError,
    activeRouteId,
    setActiveRouteId,
    routeInterestedRequests,
    routeInterestsLoading,
    routeInterestsError,
    offers,
    providerIdentities,
    offersLoading,
    activeJob,
    activeAcceptedJob,
    activeRoute,
    loadJobs,
    loadAcceptedJobs,
    loadCustomerRequests,
    loadRoutes,
    loadRouteInterestedRequests,
    loadOffers,
    providerNameForOffer,
    selectedOfferForActiveJob,
    resetTransportData,
  } = useTransportData({ userId, screen, activeJobId });

  const {
    timeFilter,
    setTimeFilter,
    vehicleFilter,
    setVehicleFilter,
    mobilityFilter,
    setMobilityFilter,
    sortOption,
    setSortOption,
    showAdvancedFilters,
    setShowAdvancedFilters,
    filteredJobs,
  } = useJobFilters(jobs);
  const {
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
  } = useProfile({ userId, screen });
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [selectedProviderProfile, setSelectedProviderProfile] = useState<OfferProviderProfile | null>(null);
  const [providerProfileLoading, setProviderProfileLoading] = useState(false);
  const [providerProfileError, setProviderProfileError] = useState(false);
  const [transportStatusLoading, setTransportStatusLoading] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [interestSelectionVisible, setInterestSelectionVisible] = useState(false);
  const [interestSubmitting, setInterestSubmitting] = useState(false);
 const [requestViewMode, setRequestViewMode] = useState<RequestViewMode>("owner");
  const [offerPrice, setOfferPrice] = useState("");
  const [offerArrivalDate, setOfferArrivalDate] = useState<Date | null>(null);
  const [offerArrivalTime, setOfferArrivalTime] = useState<Date | null>(null);
  const [showOfferDatePicker, setShowOfferDatePicker] = useState(false);
  const [showOfferTimePicker, setShowOfferTimePicker] = useState(false);
  const [offerMessage, setOfferMessage] = useState("");
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [routeDepartureDate, setRouteDepartureDate] = useState<Date | null>(null);
  const [routeDepartureTime, setRouteDepartureTime] = useState<Date | null>(null);
  const [showRouteDatePicker, setShowRouteDatePicker] = useState(false);
  const [showRouteTimePicker, setShowRouteTimePicker] = useState(false);
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [routeSpaces, setRouteSpaces] = useState("1");
  const [routeMaxDeviationKm, setRouteMaxDeviationKm] = useState("");
  const [routeVehicleTypes, setRouteVehicleTypes] = useState("Osobní automobil");
  const [routePrice, setRoutePrice] = useState("");
  const [routePriceMode, setRoutePriceMode] = useState<"fixed" | "negotiable">("fixed");
  const [routeDescription, setRouteDescription] = useState("");
  const [routeErrors, setRouteErrors] = useState<Partial<Record<CapacityErrorKey, string>>>({});
  const [routeInitialSnapshot, setRouteInitialSnapshot] = useState<string | null>(null);
  const routeScrollRef = useRef<ScrollView | null>(null);
  const [transportTab, setTransportTab] = useState<"all" | "requests" | "capacity" | "mine">("all");
  const [transportFromFilter, setTransportFromFilter] = useState("");
  const [transportToFilter, setTransportToFilter] = useState("");
  const [transportVehicleFilter, setTransportVehicleFilter] = useState("all");
  // Filtry jsou defaultně složené; panel se otevře, když uživatel chce měnit filtry.
  const [transportFiltersExpanded, setTransportFiltersExpanded] = useState(false);

  function clearLocalUserState() {
    setUserId(null);
    resetProfileData();
    resetTransportData();
    setActiveJobId(null);
    setInterestSelectionVisible(false);
    setInterestSubmitting(false);
  }

  const transportStatusSubmissionRef = useRef(false);
  const transportStatusConfirmationIdRef = useRef(0);
  const transportStatusConfirmationRef = useRef<{
    id: number;
    requestId: string;
    userId: string;
    screen: "tracking" | "job";
    status: JobStatus;
    nextStatus: "in_progress" | "completed";
    driverId: string;
    used: boolean;
  } | null>(null);
  const transportStatusCurrentContextRef = useRef<{
    requestId: string;
    userId: string;
    screen: "tracking" | "job";
    status: JobStatus;
    driverId: string;
  } | null>(null);
  const currentTransportStatusOffer = selectedOfferForActiveJob();

  function currentRequestSnapshot() {
    return requestSnapshot({
      pickupText,
      destination,
      vehicle,
      problem,
      requestedDate,
      requestedEndDate,
      dateMode,
      loadingState: loadingStateOption,
      requestVehicleModel,
    });
  }

  function currentRouteSnapshot() {
    return capacitySnapshot({
      routeFrom,
      routeTo,
      routeDepartureDate,
      routeDepartureTime,
      routeSpaces,
      routeMaxDeviationKm,
      routeVehicleTypes,
      routePrice,
      routePriceMode,
      routeDescription,
    });
  }

  function applyLoadingState(option: LoadingStateOption) {
    const mapping = loadingOptionToFields(option);
    setLoadingStateOption(option);
    setVehicleMobility(mapping.vehicle_mobility);
    setCanTrailer(mapping.can_drive_onto_trailer);
    setRequestErrors((current) => ({ ...current, loading: undefined }));
  }

  function showDiscardDraftConfirmation(onDiscard: () => void) {
    Alert.alert(
      "Zahodit rozepsané údaje?",
      "Máte rozepsané údaje. Pokud odejdete, změny se neuloží.",
      [
        { text: "Pokračovat v úpravách", style: "cancel" },
        { text: "Zahodit", style: "destructive", onPress: onDiscard },
      ]
    );
  }

  function leaveRequestForm() {
    const dirty = requestInitialSnapshot !== null && currentRequestSnapshot() !== requestInitialSnapshot;
    const leave = () => {
      setRequestErrors({});
      setScreen("create");
    };
    if (!dirty || creatingRequest) leave();
    else showDiscardDraftConfirmation(leave);
  }

  function leaveRouteForm() {
    const dirty = routeInitialSnapshot !== null && currentRouteSnapshot() !== routeInitialSnapshot;
    const leave = () => {
      setRouteErrors({});
      setScreen("create");
    };
    if (!dirty || creatingRoute) leave();
    else showDiscardDraftConfirmation(leave);
  }

  function FormBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
    const insets = useSafeAreaInsets();
    return (
      <View style={[styles.formBackHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.formBackButton} onPress={onBack} accessibilityLabel="Zpět">
          <Text style={styles.formBackText}>‹ Zpět</Text>
        </TouchableOpacity>
        <Text style={styles.formBackTitle}>{title}</Text>
      </View>
    );
  }

  function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <View style={styles.formSectionCard}>
        <Text style={styles.formSectionTitle}>{title}</Text>
        {children}
      </View>
    );
  }

  function FieldError({ message }: { message?: string }) {
    return message ? <Text style={styles.fieldError}>{message}</Text> : null;
  }

  function ReviewRow({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{value}</Text>
      </View>
    );
  }

  const currentTransportStatusScreen = screen === "tracking" || screen === "job" ? screen : null;
  transportStatusCurrentContextRef.current =
    activeJobId && activeJob && userId && currentTransportStatusScreen && currentTransportStatusOffer
      ? {
          requestId: activeJobId,
          userId,
          screen: currentTransportStatusScreen,
          status: activeJob.status,
          driverId: currentTransportStatusOffer.driver_id,
        }
      : null;

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

  async function openProviderProfile(offer: TowOffer) {
    if (providerProfileLoading) return;

    setSelectedOfferId(offer.id);
    setSelectedProviderProfile(null);
    setProviderProfileError(false);
    setProviderProfileLoading(true);

    const { data, error } = await supabase.rpc("get_offer_provider_profile", {
      p_offer_id: offer.id,
    });

    setProviderProfileLoading(false);

    if (error) {
      console.error("Load provider profile:", error.message);
      setProviderProfileError(true);
      setScreen("providerProfile");
      return;
    }

    const rows = (data || []) as OfferProviderProfile[];
    if (rows.length === 0) {
      setSelectedProviderProfile(null);
    } else {
      setSelectedProviderProfile(rows[0]);
    }
    setScreen("providerProfile");
  }

  async function selectOffer(offerId: string) {
    if (!activeJobId || selectingOfferId) return;

    setSelectingOfferId(offerId);
    const { error } = await supabase.rpc("select_tow_offer", {
      p_offer_id: offerId,
    });

    if (error) {
      console.error("Select offer:", error.message);
      Alert.alert("Chyba", "Nabídku se nepodařilo vybrat.");
      setSelectingOfferId(null);
      return;
    }

    const refreshedRequests = await loadCustomerRequests();
    const refreshedJob = refreshedRequests?.find((job) => job.id === activeJobId);
    if (refreshedJob) {
      setJobs((current) =>
        current.some((job) => job.id === activeJobId)
          ? current.map((job) => job.id === activeJobId ? refreshedJob : job)
          : [...current, refreshedJob]
      );
    }

    await loadOffers();
    setSelectingOfferId(null);
    Alert.alert(
      "✓ PŘEPRAVCE VYBRÁN",
      "Poptávka má nyní stav:\nVybrán přepravce"
    );
  }

  function confirmSelectOffer(offer: TowOffer) {
    const price = offer.price === null
      ? "cenu dohodou"
      : `${offer.price.toLocaleString("cs-CZ")} Kč`;

    Alert.alert(
      "Vybrat přepravce?",
      `Chcete vybrat tuto nabídku za ${price}? Po potvrzení bude tento přepravce vybrán pro vaši poptávku.`,
      [
        { text: "Zrušit", style: "cancel" },
        { text: "Vybrat přepravce", onPress: () => selectOffer(offer.id) },
      ]
    );
  }

  async function cancelRequest() {
    if (!activeJobId || !activeJob || cancellingRequest) return;
    if (activeJob.status !== "open") return;

    setCancellingRequest(true);
    const { error } = await supabase.rpc("cancel_tow_request", {
      p_tow_request_id: activeJobId,
    });

    if (error) {
      console.error("Cancel request:", error.message);
      Alert.alert("Chyba", "Poptávku se nepodařilo zrušit. Zkuste to prosím znovu.");
      setCancellingRequest(false);
      return;
    }

    const refreshedRequests = await loadCustomerRequests();
    const refreshedJob = refreshedRequests?.find((job) => job.id === activeJobId);
    if (refreshedJob) {
      setJobs((current) =>
        current.map((job) => job.id === activeJobId ? refreshedJob : job)
      );
      setCustomerRequests((current) =>
        current.map((job) => job.id === activeJobId ? refreshedJob : job)
      );
    }
    await loadOffers();
    setCancellingRequest(false);
    Alert.alert("Poptávka zrušena", "Poptávka byla zrušena.");
  }

  function confirmCancelRequest() {
    Alert.alert(
      "Zrušit poptávku?",
      "Opravdu chcete tuto poptávku zrušit? Přepravci už na ni nebudou moci odesílat nabídky.",
      [
        { text: "ZPĚT", style: "cancel" },
        { text: "ZRUŠIT POPTÁVKU", style: "destructive", onPress: () => cancelRequest() },
      ]
    );
  }

  async function updateTransportStatus(confirmationContext: {
    id: number;
    requestId: string;
    userId: string;
    screen: "tracking" | "job";
    status: JobStatus;
    nextStatus: "in_progress" | "completed";
    driverId: string;
    used: boolean;
  }) {
    const currentContext = transportStatusCurrentContextRef.current;
    if (
      transportStatusSubmissionRef.current ||
      !currentContext ||
      confirmationContext.id !== transportStatusConfirmationIdRef.current ||
      currentContext.requestId !== confirmationContext.requestId ||
      currentContext.userId !== confirmationContext.userId ||
      currentContext.screen !== confirmationContext.screen ||
      currentContext.status !== confirmationContext.status ||
      currentContext.driverId !== confirmationContext.driverId
    ) return;

    if (confirmationContext.nextStatus === "in_progress" && currentContext.status !== "offer_selected") return;
    if (confirmationContext.nextStatus === "completed" && currentContext.status !== "in_progress") return;

    transportStatusSubmissionRef.current = true;
    setTransportStatusLoading(true);
    try {
      const { error } = await supabase.rpc("advance_tow_request_status", {
        p_tow_request_id: currentContext.requestId,
        p_expected_status: currentContext.status,
        p_next_status: confirmationContext.nextStatus,
      });

      if (error) {
        console.error("Update transport status:", error.message);
        Alert.alert("Chyba", "Stav přepravy se nepodařilo změnit. Zkuste to prosím znovu.");
        return;
      }

      setJobs((current) =>
        current.map((job) => job.id === currentContext.requestId ? { ...job, status: confirmationContext.nextStatus } : job)
      );
      setCustomerRequests((current) =>
        current.map((job) => job.id === currentContext.requestId ? { ...job, status: confirmationContext.nextStatus } : job)
      );
      setAcceptedJobs((current) =>
        current.map((job) => job.id === currentContext.requestId ? { ...job, status: confirmationContext.nextStatus } : job)
      );

      await loadJobs();
      await loadAcceptedJobs();
      await loadCustomerRequests();
      await loadOffers();
    } catch (error) {
      console.error("Update transport status:", error);
      Alert.alert("Chyba", "Stav přepravy se nepodařilo změnit. Zkuste to prosím znovu.");
    } finally {
      transportStatusSubmissionRef.current = false;
      setTransportStatusLoading(false);
    }
  }

  function confirmTransportStatusUpdate(nextStatus: "in_progress" | "completed") {
    const currentContext = transportStatusCurrentContextRef.current;
    if (!currentContext || transportStatusLoading || transportStatusSubmissionRef.current || transportStatusConfirmationRef.current) return;
    if (currentContext.driverId !== currentContext.userId) {
      Alert.alert("RoadLink", "Stav přepravy může měnit pouze vybraný přepravce.");
      return;
    }
    if (nextStatus === "in_progress" && currentContext.status !== "offer_selected") return;
    if (nextStatus === "completed" && currentContext.status !== "in_progress") return;

    const confirmationContext = {
      id: transportStatusConfirmationIdRef.current,
      requestId: currentContext.requestId,
      userId: currentContext.userId,
      screen: currentContext.screen,
      status: currentContext.status,
      nextStatus,
      driverId: currentContext.driverId,
      used: false,
    };
    transportStatusConfirmationRef.current = confirmationContext;

    const clearConfirmation = () => {
      if (!confirmationContext.used) confirmationContext.used = true;
      if (transportStatusConfirmationRef.current === confirmationContext) {
        transportStatusConfirmationRef.current = null;
      }
    };

    const submitConfirmation = () => {
      if (confirmationContext.used || transportStatusConfirmationRef.current !== confirmationContext) return;
      confirmationContext.used = true;
      transportStatusConfirmationRef.current = null;
      updateTransportStatus(confirmationContext);
    };

    Alert.alert(
      nextStatus === "in_progress" ? "Zahájit přepravu?" : "Dokončit přepravu?",
      nextStatus === "in_progress"
        ? "Potvrďte, že nyní zahajujete tuto přepravu."
        : "Potvrďte, že vozidlo bylo doručeno a přeprava je dokončená.",
      [
        { text: "Zpět", style: "cancel", onPress: clearConfirmation },
        {
          text: nextStatus === "in_progress" ? "Zahájit přepravu" : "Potvrdit doručení",
          onPress: submitConfirmation,
        },
      ],
      { cancelable: true, onDismiss: clearConfirmation }
    );
  }

  function transportLifecycleMessage(status?: JobStatus) {
    switch (status) {
      case "offer_selected": return "Přepravce byl vybrán. Čeká se na zahájení přepravy.";
      case "in_progress": return "Přeprava probíhá.";
      case "completed": return "Přeprava byla dokončena.";
      case "cancelled": return "Přeprava byla zrušena.";
      default: return "Stav přepravy zatím není dostupný.";
    }
  }

  async function submitOffer() {
    if (!userId || !activeJob || submittingOffer) return;

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
      Alert.alert(
        "Chybí čas příjezdu",
        "Zadejte datum a čas předpokládaného příjezdu."
      );
      return;
    }

    const offerArrivalDateTime = new Date(offerArrivalDate);
    offerArrivalDateTime.setHours(
      offerArrivalTime.getHours(),
      offerArrivalTime.getMinutes(),
      0,
      0
    );

    if (offerArrivalDateTime < new Date()) {
      Alert.alert(
        "Neplatný čas",
        "Předpokládaný příjezd nemůže být v minulosti."
      );
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
          Alert.alert(
            "Nabídka již existuje",
            "Pro tuto poptávku už máte aktivní cenovou nabídku. Nejprve vyčkejte na její vyřízení."
          );
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
      setScreen("transport");
    } finally {
      setSubmittingOffer(false);
    }
  }

  async function createRoute() {
    if (!userId) return;

    const validation = validateCapacityForm({
      routeFrom,
      routeTo,
      routeDepartureDate,
      routeDepartureTime,
      routeSpaces,
      routeMaxDeviationKm,
      routeVehicleTypes,
      routePriceMode,
      routePrice,
    });
    setRouteErrors(validation.errors);
    if (!validation.valid) {
      routeScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    const deviationText = routeMaxDeviationKm.trim();
    const maxDeviationKm = deviationText === "" ? null : Number(deviationText);
    const availableSpaces = Number(routeSpaces);
    const price = routePrice.trim() === "" ? null : Number(routePrice);

    if (creatingRoute) return;
    setCreatingRoute(true);
    try {
      const fromAddress = routeFrom.trim();
      const toAddress = routeTo.trim();
    const vehicleType = canonicalVehicleType(routeVehicleTypes);
    const [fromCoordinates, toCoordinates] = await Promise.all([
      geocodeAddress(fromAddress),
      geocodeAddress(toAddress),
    ]);

      const departureAt = new Date(routeDepartureDate!);
      departureAt.setHours(routeDepartureTime!.getHours(), routeDepartureTime!.getMinutes(), 0, 0);
      const { error } = await supabase.from("carrier_routes").insert({
      driver_id: userId,
      from_address: fromAddress,
      from_lat: fromCoordinates?.latitude ?? null,
      from_lng: fromCoordinates?.longitude ?? null,
      to_address: toAddress,
      to_lat: toCoordinates?.latitude ?? null,
      to_lng: toCoordinates?.longitude ?? null,
      departure_at: departureAt.toISOString(),
      available_spaces: availableSpaces,
      max_deviation_km: maxDeviationKm,
      vehicle_types: [vehicleType],
      price: routePriceMode === "negotiable" ? null : price,
      description: routeDescription,
      status: "open",
    });

    if (error) {
      console.error("Create carrier route:", error.message);
      Alert.alert("Chyba", "Trasu se nepodařilo uložit.");
      return;
    }

      await loadRoutes();
      setRouteDepartureDate(null);
      setRouteDepartureTime(null);
      setRouteMaxDeviationKm("");
      Alert.alert("Trasa vytvořena", "Vaše nabídka volné trasy byla uložena.");
      setRouteErrors({});
      setRouteInitialSnapshot(null);
      setScreen("transport");
    } finally {
      setCreatingRoute(false);
    }
  }

  async function handleInterestPress() {
    if (!userId) {
      setScreen("login");
      return;
    }
    const requests = await loadCustomerRequests();
    if (!requests) {
      Alert.alert("Chyba", "Nepodařilo se načíst vaše poptávky. Zkuste to prosím znovu.");
      return;
    }
    const openRequests = requests.filter((req) => req.status === "open");
    if (openRequests.length === 0) {
      Alert.alert(
        "Žádná poptávka",
        "Nejdřív vytvořte poptávku přepravy.",
        [
          { text: "Zrušit", style: "cancel" },
          { text: "Vytvořit poptávku", onPress: () => openRequestFlow() },
        ]
      );
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
      if (error.code === "23505") {
        Alert.alert("RoadLink", "Zájem o tuto volnou kapacitu už byl odeslán.");
      } else {
        console.error("Submit interest error:", error.message);
        Alert.alert("Chyba", "Zájem se nepodařilo odeslat.");
      }
      return;
    }

    Alert.alert("RoadLink", "Zájem byl odeslán.");
    setInterestSelectionVisible(false);
  }

  function openInterestedRequest(request: Job) {
    setJobs((current) =>
      current.some((job) => job.id === request.id)
        ? current.map((job) => job.id === request.id ? request : job)
        : [...current, request]
    );
    setActiveJobId(request.id);
    setRequestViewMode("provider");
    setScreen("job");
  }

  useEffect(() => {
    if (role === "driver" && screen === "driverHome" && userId) {
      loadJobs();
      loadRoutes();
      loadAcceptedJobs();
    }
  }, [role, screen, userId]);

  useEffect(() => {
    if ((screen === "overview" || screen === "transport") && userId) {
      loadCustomerRequests();
    }

    if (screen === "transport" && userId) {
      loadJobs();
      loadRoutes();
      loadAcceptedJobs();
    }
  }, [screen, userId]);

  useEffect(() => {
    transportStatusConfirmationIdRef.current += 1;
    if (transportStatusConfirmationRef.current) {
      transportStatusConfirmationRef.current.used = true;
      transportStatusConfirmationRef.current = null;
    }
  }, [screen, activeJobId, userId, activeJob?.status, currentTransportStatusOffer?.driver_id]);

  useEffect(() => {
    if (screen === "customerRequests" && userId) {
      loadCustomerRequests();
    }
  }, [screen, userId]);

  useEffect(() => {
    if (screen === "customerHome" || screen === "driverHome" || screen === "request" || screen === "tracking" || screen === "job") {
      requestLocation();
    }
  }, [screen]);

  useEffect(() => {
    if (screen !== "request" && screen !== "routeForm") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen === "request") leaveRequestForm();
      if (screen === "routeForm") leaveRouteForm();
      return true;
    });
    return () => subscription.remove();
  }, [screen, requestInitialSnapshot, routeInitialSnapshot, pickupText, destination, vehicle, problem, requestedDate, requestedEndDate, dateMode, loadingStateOption, requestVehicleModel, routeFrom, routeTo, routeDepartureDate, routeDepartureTime, routeSpaces, routeMaxDeviationKm, routeVehicleTypes, routePrice, routePriceMode, routeDescription, creatingRequest, creatingRoute]);

  function goHome(nextRole = role) {
    setRole(nextRole);
    if (nextRole === "driver") {
      // Multi-role: pokud se uživatel přepne na driver roli, musí mít
      // záznam v carrier_profiles. Pokud ho nemá, vytvoříme ho.
      // Tím se vyhneme pádům loadCarrierProfile / loadVehicles
      // u uživatelů, kteří se registrovali jen jako customer.
      void ensureCarrierProfile();
    }
    setScreen(nextRole === "customer" ? "customerHome" : "driverHome");
  }

  function goToVehicles() {
    setEditingVehicleId(null);
    setVehicleEditing(false);
    setScreen("vehicles");
  }

 async function createJob() {
   if (!userId) {
     Alert.alert(
       "RoadLink",
       "Probíhá připojování k účtu. Zkuste to za chvíli."
     );
     return;
   }

   if (creatingRequest) return;

   const validation = validateRequestForm({
     pickupText,
     destination,
     requestedDate,
     requestedEndDate,
     dateMode,
     vehicle,
     loadingState: loadingStateOption,
   });
   setRequestErrors(validation.errors);
   if (!validation.valid) {
     requestScrollRef.current?.scrollTo({ y: 0, animated: true });
     return;
   }

   const loadingMapping = loadingOptionToFields(loadingStateOption || "unknown");
   let endDate: Date = requestedDate!;
   if (dateMode === "window" && requestedEndDate) {
     endDate = requestedEndDate;
   }

   setCreatingRequest(true);
   try {
     const trimmedPickupAddress = pickupText.trim();
     const trimmedDestination = destination.trim();
     const [pickupCoordinates, destinationCoordinates] = await Promise.all([
       geocodeAddress(trimmedPickupAddress),
       geocodeAddress(trimmedDestination),
     ]);

     const { data, error } = await supabase
       .from("tow_requests")
       .insert({
         customer_id: userId,
         pickup_address: trimmedPickupAddress,
         pickup_lat: pickupCoordinates?.latitude ?? null,
         pickup_lng: pickupCoordinates?.longitude ?? null,
         destination_address: trimmedDestination || "Servis dle domluvy",
         destination_lat: destinationCoordinates?.latitude ?? null,
         destination_lng: destinationCoordinates?.longitude ?? null,
         vehicle_type: canonicalVehicleType(vehicle),
         vehicle_model: requestVehicleModel.trim() || null,
         problem_description: problem.trim() || null,
         requested_date: formatPostgresDate(requestedDate!),
         date_to: formatPostgresDate(endDate),
         requested_time: null,
         time_preference: "specific",
         vehicle_mobility: loadingMapping.vehicle_mobility,
         can_drive_onto_trailer: loadingMapping.can_drive_onto_trailer,
         status: "open",
       })
       .select()
       .single();

     if (error || !data) {
       console.error("Create tow request:", error?.message);
       Alert.alert(
         "Chyba",
         "Zakázku se nepodařilo uložit do RoadLinku."
       );
       return;
     }

     const job: Job = {
       id: data.id,
       customerName: "Uživatel RoadLink",
       customerId: data.customer_id || userId,
       vehicle: canonicalVehicleType(data.vehicle_type || vehicle),
       problem: data.problem_description || "",
       pickup: coordinatesFromValues(data.pickup_lat, data.pickup_lng) ?? pickupCoordinates,
       pickupAddress: data.pickup_address || trimmedPickupAddress,
       destination:
         data.destination_address || "Servis dle domluvy",
       destinationCoordinates:
         coordinatesFromValues(data.destination_lat, data.destination_lng) ?? destinationCoordinates,
       status: data.status,
       timePreference: data.time_preference || "specific",
       requestedDate: data.requested_date || null,
       requestedEndDate: data.date_to || null,
       requestedTime: data.requested_time || null,
       vehicleMobility: data.vehicle_mobility || loadingMapping.vehicle_mobility,
       vehicleModel: data.vehicle_model || null,
       canTrailer: data.can_drive_onto_trailer ?? loadingMapping.can_drive_onto_trailer,
       createdAt: data.created_at || "",
     };

     setJobs((current) => [job, ...current]);
     setCustomerRequests((current) => [job, ...current]);
     setActiveJobId(job.id);
     setTransportTab("mine");
     await loadJobs();
     await loadCustomerRequests();

     setPickupText(trimmedPickupAddress);
     setRequestInitialSnapshot(null);
     setRequestErrors({});
     setScreen("requestSuccess");
   } finally {
     setCreatingRequest(false);
   }
 }

  const transportFilterText = (value: string | null | undefined) => (value || "").trim().toLocaleLowerCase("cs-CZ");
  const filteredTransportRequests = useMemo(() => {
    const from = transportFilterText(transportFromFilter);
    const to = transportFilterText(transportToFilter);
    return jobs.filter((job) => job.status === "open")
      .filter((job) => !from || transportFilterText(job.pickupAddress).includes(from))
      .filter((job) => !to || transportFilterText(job.destination).includes(to))
      .filter((job) => transportVehicleFilter === "all" || canonicalVehicleType(job.vehicle) === transportVehicleFilter);
  }, [jobs, transportFromFilter, transportToFilter, transportVehicleFilter]);

  const filteredTransportRoutes = useMemo(() => {
    const from = transportFilterText(transportFromFilter);
    const to = transportFilterText(transportToFilter);
    return routes.filter((route) => !from || transportFilterText(route.fromAddress).includes(from))
      .filter((route) => !to || transportFilterText(route.toAddress).includes(to))
      .filter((route) => transportVehicleFilter === "all" || route.vehicleTypes.split(", ").map(canonicalVehicleType).includes(transportVehicleFilter));
  }, [routes, transportFromFilter, transportToFilter, transportVehicleFilter]);

  const transportVehicleOptions = useMemo(() => Array.from(new Set([
    ...jobs.map((job) => canonicalVehicleType(job.vehicle)).filter(Boolean),
    ...routes.flatMap((route) => route.vehicleTypes.split(", ").map(canonicalVehicleType).filter(Boolean)),
  ])), [jobs, routes]);

  const transportFiltersActive = Boolean(transportFromFilter.trim() || transportToFilter.trim() || transportVehicleFilter !== "all");
  const transportActiveFilterCount = (transportFromFilter.trim() ? 1 : 0) + (transportToFilter.trim() ? 1 : 0) + (transportVehicleFilter !== "all" ? 1 : 0);
  const clearTransportFilters = () => {
    setTransportFromFilter("");
    setTransportToFilter("");
    setTransportVehicleFilter("all");
  };


  const mapRegion: Region = useMemo(() => {
    if (activeJob?.pickup) {
      return {
        latitude: activeJob.pickup.latitude,
        longitude: activeJob.pickup.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      };
    }
    if (location) {
      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      };
    }
    return DEFAULT_REGION;
  }, [location, activeJob]);

  function openRequestFlow() {
    if (!userId) {
      setScreen("login");
      return;
    }
    const initialLoadingState: LoadingStateOption = "drive";
    const mapping = loadingOptionToFields(initialLoadingState);
    setRequestViewMode("owner");
    setDateMode("concrete");
    setRequestedDate(null);
    setRequestedEndDate(null);
    setRequestVehicleModel("");
    setLoadingStateOption(initialLoadingState);
    setVehicleMobility(mapping.vehicle_mobility);
    setCanTrailer(mapping.can_drive_onto_trailer);
    setRequestErrors({});
    setRequestInitialSnapshot(requestSnapshot({
      pickupText,
      destination,
      vehicle,
      problem,
      requestedDate: null,
      requestedEndDate: null,
      dateMode: "concrete",
      loadingState: initialLoadingState,
      requestVehicleModel: "",
    }));
    setCreatingRequest(false);
    setScreen("request");
  }

  async function openCapacityFlow() {
    if (!userId) {
      setScreen("login");
      return;
    }
    const providerProfile = carrierProfile || await ensureCarrierProfile();
    if (!providerProfile) return;
    await loadCarrierProfile();
    setRouteErrors({});
    setRouteInitialSnapshot(currentRouteSnapshot());
    setScreen("routeForm");
  }

  function openMyRequestsAfterSuccess() {
    setTransportTab("mine");
    setScreen("transport");
  }

  function MapCard({ showRoute = false, compact = false }: { showRoute?: boolean; compact?: boolean }) {
    const pickup = activeJob?.pickup ?? null;
    const user = location?.coords;
    return (
      <View style={[styles.mapWrap, compact && styles.customerMapWrap]}>
        <MapView style={styles.map} initialRegion={mapRegion} region={mapRegion}>
          {user && (
            <Marker
              coordinate={{ latitude: user.latitude, longitude: user.longitude }}
              title="Moje poloha"
              description="Aktuální poloha"
            />
          )}
          {pickup && (
            <Marker
              coordinate={pickup}
              title="Místo vyzvednutí"
              pinColor="#111827"
            />
          )}
          {showRoute && user && pickup && (
            <Polyline
              coordinates={[
                { latitude: user.latitude, longitude: user.longitude },
                pickup,
              ]}
              strokeWidth={5}
            />
          )}
        </MapView>
        <TouchableOpacity style={[styles.locationButton, compact && styles.customerLocationButton]} onPress={requestLocation}>
          <Text style={styles.locationButtonText}>⌖ Aktualizovat polohu</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleBottomNavItemPress(key: string) {
    if (key === "overview") {
      setScreen("home");
      return;
    }
    if (key === "mine") {
      if (!userId) {
        setScreen("login");
        return;
      }
      setTransportTab("mine");
      setScreen("transport");
      return;
    }
    if (key === "profile" && !userId) {
      setScreen("login");
      return;
    }
    setScreen(key);
  }

  function BottomNavigation() {
    const activeKey = screen === "home" || screen === "welcome" || screen === "overview"
      ? "overview"
      : screen === "transport" && transportTab === "mine"
      ? "mine"
      : screen === "create"
      ? "create"
      : screen === "profile"
      ? "profile"
      : undefined;
    return <BottomNav screen={screen} activeKey={activeKey} onItemPress={handleBottomNavItemPress} />;
  }

  if (screen === "login" || screen === "signup") {
    return (
      <SafeAreaView style={styles.container}>
        {screen === "signup" ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.registrationContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.logo}>RoadLink</Text>
            <Text style={styles.bigTitle}>Vytvořit účet</Text>
            <TextInput style={styles.input} value={registrationFirstName} onChangeText={setRegistrationFirstName} placeholder="Jméno" autoCapitalize="words" />
            <TextInput style={styles.input} value={registrationLastName} onChangeText={setRegistrationLastName} placeholder="Příjmení" autoCapitalize="words" />
            <TextInput style={styles.input} value={registrationPhone} onChangeText={setRegistrationPhone} placeholder="Telefon" keyboardType="phone-pad" />
            <TextInput style={styles.input} value={registrationEmail} onChangeText={setRegistrationEmail} placeholder="E-mail" keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={styles.input} value={registrationPassword} onChangeText={setRegistrationPassword} placeholder="Heslo" secureTextEntry />
            <TextInput style={styles.input} value={registrationPasswordConfirmation} onChangeText={setRegistrationPasswordConfirmation} placeholder="Potvrzení hesla" secureTextEntry />
            <TouchableOpacity style={styles.primary} onPress={registerUser} disabled={registrationLoading}>
              <Text style={styles.primaryText}>{registrationLoading ? "Vytvářím účet…" : "Vytvořit účet"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setScreen("login")} disabled={registrationLoading}>
              <Text style={styles.link}>Už účet mám – Přihlásit se</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setScreen("home")} disabled={registrationLoading}>
              <Text style={styles.link}>Zpět na úvod</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
        <View style={styles.form}>
          <Text style={styles.logo}>RoadLink</Text>
          <Text style={styles.bigTitle}>Přihlášení</Text>
          <TextInput
            style={styles.input}
            value={loginEmail}
            onChangeText={setLoginEmail}
            placeholder="E-mail"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={loginPassword}
            onChangeText={setLoginPassword}
            placeholder="Heslo"
            secureTextEntry
          />
          <TouchableOpacity style={styles.primary} onPress={loginUser} disabled={loginLoading}>
            <Text style={styles.primaryText}>{loginLoading ? "Přihlašuji…" : "Přihlásit"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setLoginPassword(""); setScreen("signup"); }} disabled={loginLoading}>
            <Text style={styles.link}>Nemám účet</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setLoginPassword(""); setScreen("home"); }} disabled={loginLoading}>
            <Text style={styles.link}>Zpět na úvod</Text>
          </TouchableOpacity>
        </View>
        )}
      </SafeAreaView>
    );
  }

  if (screen === "home" || screen === "welcome") {
    return <GlobalHome onTransport={() => { setTransportTab("all"); setScreen("transport"); }} bottomNav={<BottomNavigation />} />;
  }

  if (screen === "overview") {
    const activeTransports = customerRequests.filter((item) => item.status === "offer_selected" || item.status === "in_progress");
    const pendingOfferRequests = customerRequests.filter((item) => item.status === "open" && (offerCounts[item.id] || 0) > 0);
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.appContent} keyboardShouldPersistTaps="handled">
          <View style={styles.dashboardHeaderRow}>
            <View style={styles.dashboardHeader}>
              <Text style={styles.dashboardTitle}>Přehled</Text>
              <Text style={styles.dashboardSubtitle}>Aktivní přepravy, nabídky i rychlé akce na jednom místě.</Text>
            </View>
            {userId ? <Text style={styles.roleChip}>{role === "driver" ? "Režim přepravce" : "Režim zákazník"}</Text> : null}
          </View>

          <View style={styles.dashboardPanel}>
            <TouchableOpacity style={styles.actionRowPrimary} onPress={openRequestFlow} accessibilityRole="button" accessibilityLabel="Poptat přepravu">
              <Text style={styles.actionIconPrimary}>↗</Text>
              <View style={styles.actionBody}>
                <Text style={styles.actionTitlePrimary}>Poptat přepravu</Text>
                <Text style={styles.actionSubtitlePrimary}>Potřebuji přepravit vozidlo</Text>
              </View>
              <Text style={styles.actionChevronPrimary}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={openCapacityFlow} accessibilityRole="button" accessibilityLabel="Nabídnout volnou kapacitu">
              <Text style={styles.actionIcon}>⇄</Text>
              <View style={styles.actionBody}>
                <Text style={styles.actionTitle}>Nabídnout volnou kapacitu</Text>
                <Text style={styles.actionSubtitle}>Mám volné místo na trase</Text>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
          </View>

          {!userId ? (
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyTitle}>Přihlaste se pro svůj přehled</Text>
              <Text style={styles.emptyCopy}>Po přihlášení zde uvidíte své aktivní přepravy, vlastní poptávky a nabídky čekající na vyřízení.</Text>
              <TouchableOpacity style={styles.secondary} onPress={() => setScreen("login")} accessibilityRole="button" accessibilityLabel="Přihlásit se">
                <Text style={styles.secondaryText}>Přihlásit se</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <>
          <View style={styles.dashboardSection}>
            <Text style={styles.sectionLabel}>AKTIVNÍ PŘEPRAVY</Text>
            {activeTransports.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text style={styles.emptyTitle}>Žádná aktivní přeprava</Text>
                <Text style={styles.emptyCopy}>Vybrané a probíhající přepravy se zobrazí zde.</Text>
              </View>
            ) : activeTransports.map((item) => (
              <TouchableOpacity key={item.id} style={styles.dispatchRow} onPress={() => { setActiveJobId(item.id); setRequestViewMode("owner"); setJobs((current) => current.some((job) => job.id === item.id) ? current : [...current, item]); setScreen("tracking"); }}>
                <View style={styles.dispatchMain}>
                  <Text style={styles.dispatchRoute}>{routeDisplayLabel(item)}</Text>
                  <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                </View>
                <Text style={styles.statusPill}>{transportLifecycleStatusLabel(item.status)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.dashboardSection}>
            <Text style={styles.sectionLabel}>ČEKÁ NA VAŠI AKCI</Text>
            {pendingOfferRequests.length === 0 ? (
              <View style={styles.emptyPanelCompact}>
                <Text style={styles.emptyTitle}>Bez aktuální akce</Text>
                <Text style={styles.emptyCopy}>Poptávky s novými nabídkami přepravců se zobrazí zde.</Text>
              </View>
            ) : pendingOfferRequests.map((item) => {
              const count = offerCounts[item.id] || 0;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.dispatchRow}
                  onPress={() => {
                    setActiveJobId(item.id);
                    setRequestViewMode("owner");
                    setJobs((current) => current.some((job) => job.id === item.id) ? current : [...current, item]);
                    setScreen("job");
                  }}
                >
                  <View style={styles.dispatchMain}>
                    <Text style={styles.dispatchRoute}>{routeDisplayLabel(item)}</Text>
                    <Text style={styles.dispatchMeta}>{offerCountLabel(count)} čeká na rozhodnutí</Text>
                    <Text style={styles.dispatchMeta}>{item.vehicle}</Text>
                  </View>
                  <Text style={styles.dispatchArrow}>→</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {acceptedJobs.length > 0 ? (
            <View style={styles.dashboardSection}>
              <Text style={styles.sectionLabel}>PŘIJATÉ ZAKÁZKY</Text>
              {acceptedJobs.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.dispatchRow}
                  onPress={() => {
                    setActiveJobId(item.id);
                    setRequestViewMode("provider");
                    setJobs((current) =>
                      current.some((job) => job.id === item.id)
                        ? current.map((job) => job.id === item.id ? item : job)
                        : [...current, item]
                    );
                    setScreen("tracking");
                  }}
                >
                  <View style={styles.dispatchMain}>
                    <Text style={styles.dispatchRoute}>{routeDisplayLabel(item)}</Text>
                    <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                  </View>
                  <Text style={styles.statusPill}>{transportStatusLabel(item.status)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          </>
          )}
        </ScrollView>
        <BottomNavigation />
      </SafeAreaView>
    );
  }

  if (screen === "transport") {
    const openRequestCards = filteredTransportRequests;
    const openCapacityCards = filteredTransportRoutes;
    const myAcceptedTransportCards = acceptedJobs;
    const myRequestCards = customerRequests;

    return (
      <View style={styles.container}>
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.appContent} keyboardShouldPersistTaps="handled">
          <View style={styles.transportPageHeader}>
            <Text style={styles.transportPageTitle}>Přeprava</Text>
            <Text style={styles.transportPageSubtitle}>Trh přepravy — poptávky, volné kapacity i vaše přepravy.</Text>
          </View>
          <View style={styles.segmentedBar}>
            {[
              ["Vše", "all"],
              ["Poptávky", "requests"],
              ["Volná kapacita", "capacity"],
              ["Moje", "mine"],
            ].map(([label, value]) => (
              <TouchableOpacity key={value} style={styles.segmentedItem} onPress={() => setTransportTab(value as typeof transportTab)}>
                <Text style={[styles.segmentedText, transportTab === value && styles.segmentedTextActive]}>{label}</Text>
                {transportTab === value ? <View style={styles.segmentedUnderline} /> : null}
              </TouchableOpacity>
            ))}
          </View>
          {transportTab !== "mine" ? (
            <View style={styles.filterPanel}>
              <View style={styles.transportFilterHeader}>
                <TouchableOpacity
                  style={styles.filterToggleButton}
                  onPress={() => setTransportFiltersExpanded(!transportFiltersExpanded)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: transportFiltersExpanded }}
                  accessibilityLabel={transportFiltersActive ? `Filtry, ${transportActiveFilterCount} aktivních` : "Filtry"}
                >
                  <Text style={styles.sectionLabel}>FILTRY{transportFiltersActive ? ` (${transportActiveFilterCount})` : ""}</Text>
                  <Text style={styles.filterToggleChevron}>{transportFiltersExpanded ? "▲" : "▼"}</Text>
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
                    <View style={styles.activeFilterChip}><Text style={styles.activeFilterChipText}>Odkud: {transportFromFilter.trim()}</Text></View>
                  ) : null}
                  {transportToFilter.trim() ? (
                    <View style={styles.activeFilterChip}><Text style={styles.activeFilterChipText}>Kam: {transportToFilter.trim()}</Text></View>
                  ) : null}
                  {transportVehicleFilter !== "all" ? (
                    <View style={styles.activeFilterChip}><Text style={styles.activeFilterChipText}>Vozidlo: {transportVehicleFilter}</Text></View>
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
                      <TouchableOpacity key={value} style={[styles.chip, transportVehicleFilter === value && styles.chipActive]} onPress={() => setTransportVehicleFilter(value)}>
                        <Text>{value === "all" ? "Vše" : value}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          ) : null}

          {(transportTab === "all" || transportTab === "requests") ? (
            <View>
              <View style={styles.transportSectionHeader}>
                <Text style={styles.sectionLabel}>POPTÁVKY</Text>
                <Text style={styles.transportCount}>{openRequestCards.length}</Text>
              </View>
              {jobsLoading ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Načítám poptávky…</Text></View>
              ) : openRequestCards.length === 0 ? (
                <View style={styles.emptyPanel}>
                  <Text style={styles.emptyTitle}>{transportFiltersActive ? "Žádné poptávky neodpovídají filtrům" : "Žádné otevřené poptávky"}</Text>
                  <Text style={styles.emptyCopy}>{transportFiltersActive ? "Upravte nebo vymažte filtry a zkuste to znovu." : "Nové poptávky zákazníků se zobrazí zde."}</Text>
                </View>
              ) : openRequestCards.map((item) => (
                <TransportCard
                  key={item.id}
                  kind="request"
                  badge="POPTÁVKA"
                  route={routeDisplayLabel(item)}
                  vehicle={item.vehicle}
                  meta={[requestTimingLabel(item), vehicleMobilityLabel(item.vehicleMobility)]}
                  status={transportStatusLabel(item.status)}
                  actionLabel="Otevřít"
                  accessibilityLabel={`Poptávka ${routeDisplayLabel(item)}`}
                  onPress={() => { setActiveJobId(item.id); setRequestViewMode("provider"); setScreen("job"); }}
                />
              ))}
            </View>
          ) : null}

          {transportTab === "capacity" ? (
            <View>
              <View style={styles.transportSectionHeader}>
                <Text style={styles.sectionLabel}>VOLNÁ KAPACITA</Text>
                <Text style={styles.transportCount}>{routes.length}</Text>
              </View>
              {routesLoading ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Načítám volné kapacity…</Text></View>
              ) : routesError ? (
                <View style={styles.emptyPanel}>
                  <Text style={styles.emptyTitle}>Volné kapacity se nepodařilo načíst</Text>
                  <TouchableOpacity style={styles.secondary} onPress={() => loadRoutes()}>
                    <Text style={styles.secondaryText}>Zkusit znovu</Text>
                  </TouchableOpacity>
                </View>
              ) : openCapacityCards.length === 0 ? (
                <View style={styles.emptyPanel}>
                  <Text style={styles.emptyTitle}>{transportFiltersActive ? "Žádné trasy neodpovídají filtrům" : "Žádné otevřené volné trasy"}</Text>
                  <Text style={styles.emptyCopy}>{transportFiltersActive ? "Upravte nebo vymažte filtry a zkuste to znovu." : "Aktivní nabídky volné kapacity se zobrazí zde."}</Text>
                </View>
              ) : openCapacityCards.map((route) => (
                <TransportCard
                  key={route.id}
                  kind="capacity"
                  badge="VOLNÁ KAPACITA"
                  route={`${route.fromAddress} → ${route.toAddress}`}
                  vehicle={route.vehicleTypes}
                  meta={[
                    `Odjezd: ${carrierRouteDepartureLabel(route.departureAt)}`,
                    route.maxDeviationKm !== null ? `Max. odchylka ${route.maxDeviationKm} km` : null,
                    `${route.availableSpaces} ${route.availableSpaces === 1 ? "volné místo" : route.availableSpaces >= 2 && route.availableSpaces <= 4 ? "volná místa" : "volných míst"}${route.price !== null ? ` · ${carrierRoutePriceLabel(route.price)}` : ""}`,
                  ]}
                  accessibilityLabel={`Volná kapacita ${route.fromAddress} ${route.toAddress}`}
                  actionLabel="Detail trasy"
                  onPress={() => {
                    setActiveRouteId(route.id);
                    setScreen("routeDetail");
                  }}
                />
              ))}
            </View>
          ) : null}

          {transportTab === "mine" ? (
            <View>
              <View style={styles.transportSectionHeader}>
                <Text style={styles.sectionLabel}>MOJE PŘEPRAVY</Text>
                <Text style={styles.transportCount}>{myAcceptedTransportCards.length}</Text>
              </View>
              {acceptedJobsLoading ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Načítám přijaté zakázky…</Text></View>
              ) : myAcceptedTransportCards.length === 0 ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Zatím nemáte žádnou přijatou přepravu</Text></View>
              ) : myAcceptedTransportCards.map((item) => (
                <TransportCard
                  key={item.id}
                  kind="capacity"
                  badge="PŘEPRAVA"
                  route={routeDisplayLabel(item)}
                  vehicle={`${item.vehicle} · ${vehicleMobilityLabel(item.vehicleMobility)}`}
                  meta={[
                    requestTimingLabel(item),
                    item.acceptedOffer.price === null ? "Cena dohodou" : `${item.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`,
                  ]}
                  status={transportStatusLabel(item.status)}
                  actionLabel="Spravovat"
                  accessibilityLabel={`Přeprava ${routeDisplayLabel(item)}`}
                  onPress={() => {
                    setActiveJobId(item.id);
                    setRequestViewMode("provider");
                    setJobs((current) =>
                      current.some((job) => job.id === item.id)
                        ? current.map((job) => job.id === item.id ? item : job)
                        : [...current, item]
                    );
                    setScreen("tracking");
                  }}
                />
              ))}

              <View style={styles.transportSectionHeader}>
                <Text style={styles.sectionLabel}>MOJE POPTÁVKY</Text>
                <Text style={styles.transportCount}>{myRequestCards.length}</Text>
              </View>
              {myRequestCards.length === 0 ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Zatím nemáte žádnou vlastní poptávku</Text></View>
              ) : myRequestCards.map((item) => (
                <TransportCard
                  key={item.id}
                  kind="request"
                  badge="MOJE POPTÁVKA"
                  route={routeDisplayLabel(item)}
                  vehicle={item.vehicle}
                  meta={[
                    requestTimingLabel(item),
                    offerCounts[item.id] ? `${offerCounts[item.id]} ${offerCounts[item.id] === 1 ? "nabídka" : "nabídky"}` : "Bez nabídek",
                  ]}
                  status={transportStatusLabel(item.status)}
                  actionLabel="Detail"
                  accessibilityLabel={`Moje poptávka ${routeDisplayLabel(item)}`}
                  onPress={() => { setActiveJobId(item.id); setRequestViewMode("owner"); setJobs((current) => current.some((job) => job.id === item.id) ? current : [...current, item]); setScreen("job"); }}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
        <BottomNavigation />
      </View>
    );
  }

  if (screen === "routeDetail") {
    if (!activeRoute) {
      return (
        <SafeAreaView style={styles.container}>
          <Header title="Volná kapacita" />
          <View style={styles.appContent}>
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyTitle}>Trasa není dostupná</Text>
              <Text style={styles.emptyCopy}>Zkuste se vrátit na přehled volných kapacit.</Text>
            </View>
            <TouchableOpacity style={styles.secondary} onPress={() => { setTransportTab("capacity"); setScreen("transport"); }}>
              <Text style={styles.secondaryText}>Zpět na volné kapacity</Text>
            </TouchableOpacity>
          </View>
          <BottomNavigation />
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
                <TouchableOpacity
                  key={item.id}
                  style={styles.dispatchCard}
                  onPress={() => submitInterest(item.id)}
                  disabled={interestSubmitting}
                >
                  <View style={styles.dispatchHeader}>
                    <Text style={styles.dispatchLabel}>MOJE POPTÁVKA</Text>
                  </View>
                  <Text style={styles.dispatchVehicle}>{item.vehicle}</Text>
                  <Text style={styles.routeLine}>{routeDisplayLabel(item)}</Text>
                  <View style={styles.dispatchFooter}>
                    <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                    <Text style={styles.dispatchArrow}>→</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.secondary}
                onPress={() => setInterestSelectionVisible(false)}
                disabled={interestSubmitting}
              >
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
                <View style={styles.detailMiniSection}>
                  <Text style={styles.sectionLabel}>ODJEZD</Text>
                  <Text style={styles.detailValueStrong}>{carrierRouteDepartureLabel(activeRoute.departureAt)}</Text>
                </View>
                <View style={styles.detailMiniSection}>
                  <Text style={styles.sectionLabel}>KAPACITA</Text>
                  <Text style={styles.detailValueStrong}>{activeRoute.availableSpaces} {activeRoute.availableSpaces === 1 ? "volné místo" : activeRoute.availableSpaces >= 2 && activeRoute.availableSpaces <= 4 ? "volná místa" : "volných míst"}</Text>
                </View>
              </View>

              <View style={styles.detailTwoColumnRow}>
                <View style={styles.detailMiniSection}>
                  <Text style={styles.sectionLabel}>VOZIDLO</Text>
                  <Text style={styles.detailValueStrong}>{activeRoute.vehicleTypes}</Text>
                </View>
                {activeRoute.price !== null ? (
                  <View style={styles.detailMiniSection}>
                    <Text style={styles.sectionLabel}>CENA</Text>
                    <Text style={styles.detailValueStrong}>{carrierRoutePriceLabel(activeRoute.price)}</Text>
                  </View>
                ) : null}
              </View>

              {activeRoute.maxDeviationKm !== null ? (
                <View style={styles.detailSectionFlat}>
                  <Text style={styles.detailValueStrong}>Max. odchylka {activeRoute.maxDeviationKm} km</Text>
                </View>
              ) : null}

              {activeRoute.description ? (
                <View style={styles.detailSectionFlat}>
                  <Text style={styles.sectionLabel}>POZNÁMKA</Text>
                  <Text style={styles.detailMuted}>{activeRoute.description}</Text>
                </View>
              ) : null}

              {activeRoute.driverId === userId ? (
                <View style={styles.detailSectionFlat}>
                  <Text style={styles.sectionLabel}>PROJEVENÝ ZÁJEM</Text>
                  {routeInterestsLoading ? (
                    <Text style={styles.detailMuted}>Načítám projevený zájem…</Text>
                  ) : routeInterestsError ? (
                    <Text style={styles.detailMuted}>Projevený zájem se nepodařilo načíst. Zkuste to prosím znovu.</Text>
                  ) : routeInterestedRequests.length === 0 ? (
                    <Text style={styles.detailMuted}>Zatím žádná poptávka neprojevila zájem o tuto kapacitu.</Text>
                  ) : routeInterestedRequests.map((item) => (
                    <TouchableOpacity key={item.id} style={styles.dispatchCard} onPress={() => openInterestedRequest(item)}>
                      <View style={styles.dispatchHeader}>
                        <Text style={styles.dispatchLabel}>POPTÁVKA</Text>
                        <Text style={styles.statusPill}>{transportStatusLabel(item.status)}</Text>
                      </View>
                      <Text style={styles.dispatchVehicle}>{item.vehicle}</Text>
                      <Text style={styles.routeLine}>{routeDisplayLabel(item)}</Text>
                      <View style={styles.dispatchFooter}>
                        <View>
                          <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                          <Text style={styles.dispatchMeta}>{vehicleMobilityLabel(item.vehicleMobility)}</Text>
                        </View>
                        <Text style={styles.dispatchArrow}>→</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {activeRoute.driverId !== userId && (
                <TouchableOpacity style={styles.primary} onPress={handleInterestPress}>
                  <Text style={styles.primaryText}>MÁM ZÁJEM O PŘEPRAVU</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.secondary} onPress={() => { setTransportTab("capacity"); setScreen("transport"); }}>
                <Text style={styles.secondaryText}>Zpět na volné kapacity</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
        <BottomNavigation />
      </SafeAreaView>
    );
  }

  if (screen === "create") {
    return (
      <CreateScreen
        screen={screen}
        onItemPress={handleBottomNavItemPress}
        onRequestFlow={openRequestFlow}
        onCapacityFlow={openCapacityFlow}
        onBackOverview={() => setScreen("home")}
      />
    );
  }

  if (screen === "sos") {
    return <SosScreen screen={screen} onItemPress={handleBottomNavItemPress} />;
  }

  if (screen === "role") {
    return <RoleScreen onSelectRole={goHome} />;
  }

  if (screen === "customerHome") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="● Zákazník" />
        <MapCard compact />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.customerContent} keyboardShouldPersistTaps="handled">
          {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
          <Text style={styles.bigTitle}>Potřebujete odtah?</Text>
          <Text style={styles.customerDescription}>Vytvořte poptávku a přepravci vám mohou poslat své nabídky.</Text>
          <TouchableOpacity style={styles.customerPrimary} onPress={() => setScreen("request")}>
            <Text style={styles.primaryText}>Vytvořit poptávku</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customerActionRow} onPress={() => setScreen("customerRequests")}>
            <Text style={styles.customerActionIcon}>▤</Text>
            <Text style={styles.customerActionText}>Moje poptávky</Text>
            <Text style={styles.customerActionArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customerActionRowSubtle} onPress={() => setScreen("transport")}>
            <Text style={styles.customerActionIcon}>◌</Text>
            <Text style={styles.customerActionTextSubtle}>Přeprava</Text>
            <Text style={styles.customerActionArrow}>›</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "customerRequests") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Moje poptávky" />
        {customerRequests.length === 0 ? (
          <Text style={styles.empty}>Zatím nemáte žádnou poptávku.</Text>
        ) : (
          <FlatList
            data={customerRequests}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.jobCard}
                onPress={() => {
                  setActiveJobId(item.id);
                  setJobs((current) =>
                    current.some((job) => job.id === item.id)
                      ? current
                      : [...current, item]
                  );
                      setScreen("job");
                }}
              >
                <Text style={styles.sectionTitle}>Poptávka</Text>
                <Text style={styles.jobTitle}>{item.vehicle} • {item.problem}</Text>
                <Text style={styles.muted}>→ {item.destination}</Text>
                <Text style={styles.muted}>📅 {requestTimingLabel(item)}</Text>
                <Text style={styles.muted}>🚗 {vehicleMobilityLabel(item.vehicleMobility)}</Text>
                <Text style={styles.muted}>
                  {item.status === "offer_selected"
                    ? "Přepravce vybrán"
                    : offerCounts[item.id]
                    ? `${offerCounts[item.id]} ${offerCounts[item.id] === 1 ? "nabídka" : "nabídky"}`
                    : "Čeká se na nabídky"}
                </Text>
                <Text style={styles.muted}>Stav: {statusLabel(item.status)}</Text>
              </TouchableOpacity>
            )}
          />
        )}
        <View style={styles.bottomAction}>
          <TouchableOpacity style={styles.secondary} onPress={() => setScreen("overview")}>
            <Text style={styles.secondaryText}>Zpět na přehled</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === "driverHome") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Řidič" />
        <View style={styles.driverTop}>
          <Text style={styles.bigTitle}>Jste online</Text>
          <Text style={styles.muted}>{filteredJobs.length} dostupných poptávek</Text>
        </View>
        <FlatList
          data={filteredJobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <Text style={styles.sectionTitle}>Moje přijaté zakázky</Text>
              {acceptedJobsLoading ? (
                <Text style={styles.empty}>Načítám přijaté zakázky...</Text>
              ) : acceptedJobs.length === 0 ? (
                <Text style={styles.empty}>Zatím nemáte žádnou přijatou zakázku.</Text>
              ) : (
                acceptedJobs.map((acceptedJob) => (
                  <TouchableOpacity
                    key={acceptedJob.id}
                    style={styles.acceptedCard}
                    onPress={() => {
                      setActiveJobId(acceptedJob.id);
                      setJobs((current) =>
                        current.some((job) => job.id === acceptedJob.id)
                          ? current.map((job) => job.id === acceptedJob.id ? acceptedJob : job)
                          : [...current, acceptedJob]
                      );
                      setScreen("job");
                    }}
                  >
                    <Text style={styles.acceptedTitle}>✓ ZAKÁZKA PŘIJATA</Text>
                    <Text style={styles.jobTitle}>{acceptedJob.vehicle} • {acceptedJob.problem}</Text>
                    <Text style={styles.muted}>📍 {pickupDisplayLabel(acceptedJob)}</Text>
                    <Text style={styles.muted}>→ {acceptedJob.destination}</Text>
                    <Text style={styles.muted}>📅 {requestTimingLabel(acceptedJob)}</Text>
                    <Text style={styles.acceptedPrice}>
                      {acceptedJob.acceptedOffer.price === null
                        ? "Cena dohodou"
                        : `${acceptedJob.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`}
                    </Text>
                    <Text style={styles.detailLink}>Zobrazit zakázku</Text>
                  </TouchableOpacity>
                ))
              )}
              <Text style={styles.sectionTitle}>Poptávky zákazníků</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {[
                  ["Vše", "all"],
                  ["Co nejdříve", "asap"],
                  ["Do 24 h", "within_24h"],
                  ["Do 3 dnů", "within_3_days"],
                  ["Do týdne", "within_week"],
                ].map(([label, value]) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.chip, timeFilter === value && styles.chipActive]}
                    onPress={() => setTimeFilter(value as TimeFilter)}
                  >
                    <Text>{label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.secondary} onPress={() => setShowAdvancedFilters((current) => !current)}>
                <Text style={styles.secondaryText}>{showAdvancedFilters ? "Skrýt filtry" : "Filtry"}</Text>
              </TouchableOpacity>
              {showAdvancedFilters ? (
                <View style={styles.filterPanel}>
                  <Text style={styles.label}>Typ vozidla</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {[
                      ["Všechna vozidla", "all"],
                      ["Osobní automobil", "Osobní automobil"],
                      ["SUV", "SUV"],
                      ["Dodávka", "Dodávka"],
                      ["Motocykl", "Motocykl"],
                    ].map(([label, value]) => (
                      <TouchableOpacity key={value} style={[styles.chip, vehicleFilter === value && styles.chipActive]} onPress={() => setVehicleFilter(value)}>
                        <Text>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={styles.label}>Pojízdnost</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {[
                      ["Vše", "all"],
                      ["Pojízdné", "drivable"],
                      ["Částečně pojízdné", "partially_drivable"],
                      ["Nepojízdné", "not_drivable"],
                      ["Nejsem si jistý", "unknown"],
                    ].map(([label, value]) => (
                      <TouchableOpacity key={value} style={[styles.chip, mobilityFilter === value && styles.chipActive]} onPress={() => setMobilityFilter(value as VehicleMobility | "all")}>
                        <Text>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={styles.label}>Řadit podle</Text>
                  <View style={styles.chips}>
                    <TouchableOpacity style={[styles.chip, sortOption === "urgent" && styles.chipActive]} onPress={() => setSortOption("urgent")}>
                      <Text>Nejdříve nejurgentnější</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.chip, sortOption === "newest" && styles.chipActive]} onPress={() => setSortOption("newest")}>
                      <Text>Nejnovější</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.secondary}
                    onPress={() => {
                      setTimeFilter("all");
                      setVehicleFilter("all");
                      setMobilityFilter("all");
                      setSortOption("urgent");
                    }}
                  >
                    <Text style={styles.secondaryText}>Vymazat filtry</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <Text style={styles.resultCount}>
                {filteredJobs.length === 1 ? "1 poptávka" : `${filteredJobs.length} poptávek`} odpovídá filtrům
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View>
              <Text style={styles.empty}>Žádná poptávka neodpovídá vybraným filtrům.</Text>
              <TouchableOpacity
                style={styles.secondary}
                onPress={() => {
                  setTimeFilter("all");
                  setVehicleFilter("all");
                  setMobilityFilter("all");
                  setSortOption("urgent");
                }}
              >
                <Text style={styles.secondaryText}>Vymazat filtry</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.marketCard} onPress={() => { setActiveJobId(item.id); setScreen("job"); }}>
              <View style={styles.rowBetween}>
                <Text style={styles.marketEyebrow}>NOVÁ POPTÁVKA</Text>
                <Text style={styles.urgentBadge}>{requestTimingLabel(item).toUpperCase()}</Text>
              </View>
              <Text style={styles.jobTitle}>{item.vehicle} • {item.problem}</Text>
              <Text style={styles.cardLabel}>📍 Vyzvednutí</Text>
              <Text style={styles.muted}>{pickupDisplayLabel(item)}</Text>
              <Text style={styles.cardLabel}>→ Cíl</Text>
              <Text style={styles.muted}>{item.destination}</Text>
              <Text style={styles.cardLabel}>🕐 Termín</Text>
              <Text style={styles.muted}>{requestTimingLabel(item)}</Text>
              <Text style={styles.cardLabel}>🔧 Stav vozidla</Text>
              <Text style={styles.muted}>{vehicleMobilityLabel(item.vehicleMobility)}</Text>
              <Text style={styles.detailLink}>Zobrazit detail</Text>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <View style={styles.routesSection}>
              <Text style={styles.sectionTitle}>Moje volné trasy</Text>
              {routes.length === 0 ? (
                <Text style={styles.empty}>Zatím nemáte žádnou aktivní trasu.</Text>
              ) : (
                routes.map((route) => (
                  <View key={route.id} style={styles.jobCard}>
                    <Text style={styles.jobTitle}>{route.fromAddress} → {route.toAddress}</Text>
                    <Text style={styles.muted}>{route.availableSpaces} volné místo</Text>
                    <Text style={styles.muted}>Odjezd: {route.departureAt}</Text>
                    <Text style={styles.muted}>Vozidlo: {route.vehicleTypes}</Text>
                    <Text style={styles.muted}>
                      {route.price === null
                        ? "Cena: dohodou"
                        : `Cena: ${route.price.toLocaleString("cs-CZ")} Kč`}
                    </Text>
                    {route.description ? <Text style={styles.muted}>{route.description}</Text> : null}
                  </View>
                ))
              )}
            </View>
          }
        />
        <View style={styles.bottomAction}>
          <TouchableOpacity style={styles.primary} onPress={() => setScreen("routeForm")}>
            <Text style={styles.primaryText}>Vytvořit nabídku trasy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => setScreen("overview")}>
            <Text style={styles.secondaryText}>Zpět na přehled</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === "profile") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.profileHeader}>
          <TouchableOpacity onPress={() => setScreen("home")}>
            <Text style={styles.profileBack}>← Přehled</Text>
          </TouchableOpacity>
          <Text style={styles.profileHeaderIcon}>♙</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.registrationContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.bigTitle}>Můj profil</Text>
          {profileLoading && !profile ? (
            <Text style={styles.empty}>Načítám profil...</Text>
          ) : profile ? (
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
            </>
          ) : (
            <Text style={styles.empty}>Profil se nepodařilo načíst.</Text>
          )}
          {profile ? (
            <View>
              <Text style={styles.sectionTitle}>Přepravní profil</Text>
              {carrierProfileLoading && !carrierProfile ? (
                <Text style={styles.empty}>Načítám přepravní profil...</Text>
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
                    <Text style={styles.detailMuted}>Tyto údaje se zobrazí zákazníkům, kterým odešlete cenovou nabídku.</Text>
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
                    <Text style={styles.profileFieldValue}>{carrierProfile.display_name || carrierProfile.company_name || "Neuvedeno"}</Text>
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
              {carrierProfile ? (
                <>
                  <TouchableOpacity style={styles.customerActionRow} onPress={() => setScreen("vehicles")}>
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
            </View>
          ) : null}
          <TouchableOpacity style={styles.profileLinkCard} onPress={() => { setTransportTab("mine"); setScreen("transport"); }}>
            <Text style={styles.profileLinkTitle}>Moje poptávky</Text>
            <Text style={styles.profileLinkText}>Otevřít moje přepravní poptávky</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileLinkCard} onPress={() => setScreen("overview")}>
            <Text style={styles.profileLinkTitle}>Moje aktivita</Text>
            <Text style={styles.profileLinkText}>Otevřít osobní přehled přeprav a nabídek</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileLogoutRow} onPress={signOutUser} disabled={signOutLoading}>
            <Text style={styles.profileLogoutText}>{signOutLoading ? "Odhlašuji…" : "Odhlásit se"}</Text>
          </TouchableOpacity>
        </ScrollView>
        <BottomNavigation />
      </SafeAreaView>
    );
  }

  if (screen === "request") {
    const loadingLabel = loadingStateOption ? loadingOptionToFields(loadingStateOption).label : "Vyberte stav nakládky";
    return (
      <SafeAreaView style={styles.container}>
        <FormBackHeader title="Poptávka přepravy" onBack={leaveRequestForm} />
        <ScrollView ref={requestScrollRef} style={styles.scroll} contentContainerStyle={styles.requestContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.formIntroTitle}>Nová poptávka</Text>
          <Text style={styles.formIntroText}>Zadejte trasu, termín a stav vozidla. Odeslání vytvoří poptávku v Trhu přepravy.</Text>

          <FormSection title="Trasa">
            <Text style={styles.label}>Odkud</Text>
            <TextInput style={styles.compactInput} value={pickupText} onChangeText={(value) => { setPickupText(value); setRequestErrors((current) => ({ ...current, route: undefined })); }} placeholder="Např. Praha" returnKeyType="next" />
            <Text style={styles.label}>Kam</Text>
            <TextInput style={styles.compactInput} value={destination} onChangeText={(value) => { setDestination(value); setRequestErrors((current) => ({ ...current, route: undefined })); }} placeholder="Např. Brno" returnKeyType="next" />
            <FieldError message={requestErrors.route} />
            <TouchableOpacity style={styles.inlineSecondary} onPress={requestLocation} accessibilityLabel="Použít aktuální polohu">
              <Text style={styles.secondaryText}>⌖ Použít aktuální polohu</Text>
            </TouchableOpacity>
          </FormSection>

          <FormSection title="Termín">
            <View style={styles.chipGrid}>
              <TouchableOpacity style={[styles.selectChip, dateMode === "concrete" && styles.selectChipActive]} onPress={() => { setDateMode("concrete"); setRequestErrors((current) => ({ ...current, date: undefined })); }}>
                <Text style={[styles.selectChipText, dateMode === "concrete" && styles.selectChipTextActive]}>Konkrétní datum</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.selectChip, dateMode === "window" && styles.selectChipActive]} onPress={() => { setDateMode("window"); setRequestErrors((current) => ({ ...current, date: undefined })); }}>
                <Text style={[styles.selectChipText, dateMode === "window" && styles.selectChipTextActive]}>Časové okno</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>{dateMode === "window" ? "Od" : "Datum přepravy"}</Text>
            <TouchableOpacity style={[styles.inlineSecondary, styles.inlinePicker]} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.secondaryText}>{requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text>
            </TouchableOpacity>
            {showDatePicker ? (
              <DateTimePicker value={requestedDate || new Date()} mode="date" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowDatePicker(false); if (event.type === "set" && date) { setRequestedDate(date); setRequestErrors((current) => ({ ...current, date: undefined })); } }} />
            ) : null}
            {dateMode === "window" ? (
              <>
                <Text style={styles.label}>Do</Text>
                <TouchableOpacity style={[styles.inlineSecondary, styles.inlinePicker]} onPress={() => setShowEndDatePicker(true)}>
                  <Text style={styles.secondaryText}>{requestedEndDate ? requestedEndDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text>
                </TouchableOpacity>
                {showEndDatePicker ? (
                  <DateTimePicker value={requestedEndDate || requestedDate || new Date()} mode="date" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowEndDatePicker(false); if (event.type === "set" && date) { setRequestedEndDate(date); setRequestErrors((current) => ({ ...current, date: undefined })); } }} />
                ) : null}
              </>
            ) : null}
            <FieldError message={requestErrors.date} />
          </FormSection>

          <FormSection title="Vozidlo">
            <View style={styles.chipGrid}>
              {["Osobní automobil", "SUV / 4x4", "Motocykl", "Dodávka", "Užitkové", "Ostatní"].map((value) => (
                <TouchableOpacity key={value} style={[styles.selectChip, vehicle === value && styles.selectChipActive]} onPress={() => { setVehicle(value); setRequestErrors((current) => ({ ...current, vehicle: undefined })); }}>
                  <Text style={[styles.selectChipText, vehicle === value && styles.selectChipTextActive]}>{value}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FieldError message={requestErrors.vehicle} />
            <Text style={styles.label}>Značka a model · volitelné</Text>
            <TextInput style={styles.compactInput} value={requestVehicleModel} onChangeText={setRequestVehicleModel} placeholder="Škoda Octavia" />
          </FormSection>

          <FormSection title="Stav vozidla pro nakládku">
            {LOADING_STATE_OPTIONS.map((item) => (
              <TouchableOpacity key={item.option} style={[styles.optionCard, loadingStateOption === item.option && styles.optionCardActive]} onPress={() => applyLoadingState(item.option)} accessibilityRole="button">
                <Text style={[styles.optionTitle, loadingStateOption === item.option && styles.optionTitleActive]}>{item.label}</Text>
                <Text style={[styles.optionDescription, loadingStateOption === item.option && styles.optionDescriptionActive]}>{item.description}</Text>
              </TouchableOpacity>
            ))}
            <FieldError message={requestErrors.loading} />
          </FormSection>

          <FormSection title="Poznámka">
            <TextInput style={[styles.compactInput, styles.multilineInput]} value={problem} onChangeText={setProblem} placeholder="Např. vozidlo má zablokované kolo, přístup je z úzké ulice…" multiline />
          </FormSection>

          <FormSection title="Kontrola a odeslání">
            <ReviewRow label="Trasa" value={`${pickupText.trim() || "Odkud neuvedeno"} → ${destination.trim() || "Kam neuvedeno"}`} />
            <ReviewRow label="Termín" value={dateMode === "window" ? `${requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Od neuvedeno"} – ${requestedEndDate ? requestedEndDate.toLocaleDateString("cs-CZ") : "Do neuvedeno"}` : requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Datum neuvedeno"} />
            <ReviewRow label="Vozidlo" value={`${vehicle}${requestVehicleModel.trim() ? ` · ${requestVehicleModel.trim()}` : ""}`} />
            <ReviewRow label="Nakládka" value={loadingLabel} />
            <TouchableOpacity style={styles.primary} disabled={creatingRequest} onPress={createJob} accessibilityLabel="Odeslat poptávku">
              <Text style={styles.primaryText}>{creatingRequest ? "Odesílám…" : "Odeslat poptávku"}</Text>
            </TouchableOpacity>
          </FormSection>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "requestSuccess") {
    return <RequestSuccessScreen onShowRequests={openMyRequestsAfterSuccess} />;
  }

  if (screen === "offerForm") {
    if (!activeJob) return null;
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
            <Text style={styles.secondaryText}>
              {offerArrivalDate
                ? `📅 ${offerArrivalDate.toLocaleDateString("cs-CZ")}`
                : "📅 Vyberte datum"}
            </Text>
          </TouchableOpacity>
          {showOfferDatePicker ? (
            <DateTimePicker
              value={offerArrivalDate || new Date()}
              mode="date"
              display="default"
              onChange={(event: DateTimePickerEvent, date?: Date) => {
                setShowOfferDatePicker(false);
                if (event.type === "set" && date) setOfferArrivalDate(date);
              }}
            />
          ) : null}
          <TouchableOpacity style={styles.secondary} onPress={() => setShowOfferTimePicker(true)}>
            <Text style={styles.secondaryText}>
              {offerArrivalTime
                ? `🕐 ${formatPostgresTime(offerArrivalTime).slice(0, 5)}`
                : "🕐 Vyberte čas"}
            </Text>
          </TouchableOpacity>
          {showOfferTimePicker ? (
            <DateTimePicker
              value={offerArrivalTime || new Date()}
              mode="time"
              display="default"
              onChange={(event: DateTimePickerEvent, date?: Date) => {
                setShowOfferTimePicker(false);
                if (event.type === "set" && date) setOfferArrivalTime(date);
              }}
            />
          ) : null}
          <Text style={styles.label}>Zpráva</Text>
          <TextInput style={styles.input} value={offerMessage} onChangeText={setOfferMessage} placeholder="Doplňující informace" multiline />
          <TouchableOpacity style={styles.primary} onPress={submitOffer} disabled={submittingOffer}>
            <Text style={styles.primaryText}>{submittingOffer ? "ODESÍLÁM…" : "Odeslat nabídku"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => setScreen("job")}>
            <Text style={styles.secondaryText}>Zpět na poptávku</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "routeForm") {
    return (
      <SafeAreaView style={styles.container}>
        <FormBackHeader title="Volná kapacita" onBack={leaveRouteForm} />
        <ScrollView ref={routeScrollRef} style={styles.scroll} contentContainerStyle={styles.requestContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.formIntroTitle}>Nová volná kapacita</Text>
          <Text style={styles.formIntroText}>Nabídněte volné místo na trase, kterou už plánujete jet.</Text>

          <FormSection title="Trasa">
            <Text style={styles.label}>Odkud</Text>
            <TextInput style={styles.compactInput} value={routeFrom} onChangeText={(value) => { setRouteFrom(value); setRouteErrors((current) => ({ ...current, route: undefined })); }} placeholder="Místo odjezdu" />
            <Text style={styles.label}>Kam</Text>
            <TextInput style={styles.compactInput} value={routeTo} onChangeText={(value) => { setRouteTo(value); setRouteErrors((current) => ({ ...current, route: undefined })); }} placeholder="Cíl trasy" />
            <FieldError message={routeErrors.route} />
          </FormSection>

          <FormSection title="Odjezd">
            <Text style={styles.label}>Datum odjezdu</Text>
            <TouchableOpacity style={styles.inlineSecondary} onPress={() => setShowRouteDatePicker(true)}>
              <Text style={styles.secondaryText}>{routeDepartureDate ? routeDepartureDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text>
            </TouchableOpacity>
            {showRouteDatePicker ? (
              <DateTimePicker value={routeDepartureDate || new Date()} mode="date" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowRouteDatePicker(false); if (event.type === "set" && date) { setRouteDepartureDate(date); setRouteErrors((current) => ({ ...current, departure: undefined })); } }} />
            ) : null}
            <Text style={styles.label}>Přibližný čas odjezdu</Text>
            <TouchableOpacity style={styles.inlineSecondary} onPress={() => setShowRouteTimePicker(true)}>
              <Text style={styles.secondaryText}>{routeDepartureTime ? `${String(routeDepartureTime.getHours()).padStart(2, "0")}:${String(routeDepartureTime.getMinutes()).padStart(2, "0")}` : "Vybrat čas"}</Text>
            </TouchableOpacity>
            {showRouteTimePicker ? (
              <DateTimePicker value={routeDepartureTime || new Date()} mode="time" display="default" onChange={(event: DateTimePickerEvent, date?: Date) => { setShowRouteTimePicker(false); if (event.type === "set" && date) { setRouteDepartureTime(date); setRouteErrors((current) => ({ ...current, departure: undefined })); } }} />
            ) : null}
            <FieldError message={routeErrors.departure} />
          </FormSection>

          <FormSection title="Kapacita">
            <Text style={styles.label}>Počet volných míst</Text>
            <TextInput style={styles.compactInput} value={routeSpaces} onChangeText={(value) => { setRouteSpaces(value); setRouteErrors((current) => ({ ...current, capacity: undefined })); }} placeholder="Počet míst" keyboardType="numeric" />
            <Text style={styles.label}>Maximální odchylka od trasy · volitelné km</Text>
            <TextInput style={styles.compactInput} value={routeMaxDeviationKm} onChangeText={(value) => { setRouteMaxDeviationKm(value); setRouteErrors((current) => ({ ...current, capacity: undefined })); }} placeholder="Odchylka v km" keyboardType="numeric" accessibilityLabel="Maximální odchylka od trasy v km" />
            <FieldError message={routeErrors.capacity} />
          </FormSection>

          <FormSection title="Přijímaná vozidla">
            <Text style={styles.label}>Typ vozidla</Text>
            <TextInput style={styles.compactInput} value={routeVehicleTypes} onChangeText={(value) => { setRouteVehicleTypes(value); setRouteErrors((current) => ({ ...current, vehicle: undefined })); }} placeholder="Typ vozidla" />
            <FieldError message={routeErrors.vehicle} />
          </FormSection>

          <FormSection title="Cena a poznámka">
            <View style={styles.chipGrid}>
              <TouchableOpacity style={[styles.selectChip, routePriceMode === "fixed" && styles.selectChipActive]} onPress={() => { setRoutePriceMode("fixed"); setRouteErrors((current) => ({ ...current, price: undefined })); }}>
                <Text style={[styles.selectChipText, routePriceMode === "fixed" && styles.selectChipTextActive]}>Pevná cena</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.selectChip, routePriceMode === "negotiable" && styles.selectChipActive]} onPress={() => { setRoutePriceMode("negotiable"); setRouteErrors((current) => ({ ...current, price: undefined })); }}>
                <Text style={[styles.selectChipText, routePriceMode === "negotiable" && styles.selectChipTextActive]}>Cena dohodou</Text>
              </TouchableOpacity>
            </View>
            {routePriceMode === "fixed" ? (
              <TextInput style={styles.compactInput} value={routePrice} onChangeText={(value) => { setRoutePrice(value); setRouteErrors((current) => ({ ...current, price: undefined })); }} placeholder="Cena v Kč" keyboardType="numeric" />
            ) : null}
            <FieldError message={routeErrors.price} />
            <Text style={styles.label}>Poznámka</Text>
            <TextInput style={[styles.compactInput, styles.multilineInput]} value={routeDescription} onChangeText={setRouteDescription} placeholder="Doplňující informace" multiline />
          </FormSection>

          <FormSection title="Kontrola a odeslání">
            <ReviewRow label="Trasa" value={`${routeFrom.trim() || "Odkud neuvedeno"} → ${routeTo.trim() || "Kam neuvedeno"}`} />
            <ReviewRow label="Odjezd" value={`${routeDepartureDate ? routeDepartureDate.toLocaleDateString("cs-CZ") : "Datum neuvedeno"}${routeDepartureTime ? ` · ${String(routeDepartureTime.getHours()).padStart(2, "0")}:${String(routeDepartureTime.getMinutes()).padStart(2, "0")}` : ""}`} />
            <ReviewRow label="Kapacita" value={`${routeSpaces || "0"} míst${routeMaxDeviationKm.trim() ? ` · odchylka ${routeMaxDeviationKm.trim()} km` : ""}`} />
            <ReviewRow label="Vozidla" value={routeVehicleTypes.trim() || "Neuvedeno"} />
            <ReviewRow label="Cena" value={routePriceMode === "negotiable" ? "Cena dohodou" : routePrice.trim() ? `${routePrice.trim()} Kč` : "Neuvedeno"} />
            <TouchableOpacity style={styles.primary} onPress={createRoute} disabled={creatingRoute} accessibilityLabel="Vytvořit nabídku volné kapacity">
              <Text style={styles.primaryText}>{creatingRoute ? "Ukládám…" : "Vytvořit nabídku trasy"}</Text>
            </TouchableOpacity>
          </FormSection>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "tracking") {
    if (!activeJob) return null;
    const selectedOffer = selectedOfferForActiveJob();
    const canDriverUpdateTransport = Boolean(selectedOffer && selectedOffer.driver_id === userId);

    return (
      <DetailShell
        title="Detail přepravy"
        onBack={() => { setTransportTab(requestViewMode === "owner" ? "mine" : "requests"); setScreen("transport"); }}
      >
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
          <DetailPrimaryAction label="Zahájit přepravu" loadingLabel="Ukládám…" loading={transportStatusLoading} onPress={() => confirmTransportStatusUpdate("in_progress")} />
        ) : null}
        {canDriverUpdateTransport && activeJob.status === "in_progress" ? (
          <DetailPrimaryAction label="Označit jako doručené" loadingLabel="Ukládám…" loading={transportStatusLoading} onPress={() => confirmTransportStatusUpdate("completed")} />
        ) : null}
        <DetailSecondaryAction label="Zpět na přepravu" onPress={() => { setTransportTab(requestViewMode === "owner" ? "mine" : "requests"); setScreen("transport"); }} />
      </DetailShell>
    );
  }

  if (screen === "job" && requestViewMode === "owner") {
    if (!activeJob) return null;
    return (
      <DetailShell title="Detail poptávky" onBack={() => { setTransportTab("mine"); setScreen("transport"); }}>
        <DetailStatusHeader
          label="Moje poptávka"
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
        <View style={styles.detailSectionHeaderRow}>
          <Text style={styles.detailSectionTitleV2}>Cenové nabídky</Text>
          <TouchableOpacity style={styles.detailRefreshButton} onPress={loadOffers}>
            <Text style={styles.detailRefreshText}>Obnovit</Text>
          </TouchableOpacity>
        </View>
        {offersLoading ? (
          <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Načítám cenové nabídky…</Text></View>
        ) : offers.length === 0 ? (
          <View style={styles.detailEmptyCard}><Text style={styles.detailEmptyTitle}>Zatím bez cenových nabídek.</Text><Text style={styles.detailEmptyText}>Jakmile přepravce odešle cenu, zobrazí se tady.</Text></View>
        ) : (
          offers.map((offer) => (
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
              {activeJob.status === "open" && offer.status === "pending" ? (
                <DetailPrimaryAction label="Vybrat přepravce" loadingLabel="Vybírám…" loading={selectingOfferId === offer.id} onPress={() => confirmSelectOffer(offer)} />
              ) : null}
              <DetailSecondaryAction label="Zobrazit profil" loadingLabel="Načítám…" loading={providerProfileLoading && selectedOfferId === offer.id} onPress={() => openProviderProfile(offer)} />
            </View>
          ))
        )}
        {(activeJob.status === "offer_selected" || activeJob.status === "in_progress" || activeJob.status === "completed") ? (
          <DetailSection title="Přeprava">
            <Text style={styles.detailBodyText}>{transportLifecycleMessage(activeJob.status)}</Text>
            <DetailPrimaryAction label="Přejít k přepravě" onPress={() => setScreen("tracking")} />
          </DetailSection>
        ) : null}
        {activeJob.status === "open" ? (
          <View style={styles.detailDangerZone}>
            <Text style={styles.detailDangerTitle}>Zrušení poptávky</Text>
            <Text style={styles.detailDangerCopy}>Sekundární akce. Po potvrzení už přepravci nebudou moci posílat nabídky.</Text>
            <DetailSecondaryAction label="Zrušit poptávku" loadingLabel="Ruším…" loading={cancellingRequest} destructive onPress={confirmCancelRequest} />
          </View>
        ) : null}
        <DetailSecondaryAction label="Zpět na moje poptávky" onPress={() => { setTransportTab("mine"); setScreen("transport"); }} />
      </DetailShell>
    );
  }

  if (screen === "providerProfile") {
    const profileOffer = offers.find((offer) => offer.id === selectedOfferId) || null;
    return (
      <OfferProviderDetailsScreen
        profile={selectedProviderProfile}
        offer={profileOffer}
        loading={providerProfileLoading}
        error={providerProfileError}
        canSelectProvider={Boolean(activeJob && activeJob.status === "open")}
        selectingProvider={selectingOfferId !== null}
        onBack={() => setScreen("job")}
        onCallProvider={(phone) => openContactUrl(`tel:${phone}`, "Telefon se nepodařilo otevřít.")}
        onEmailProvider={(email) => openContactUrl(`mailto:${email}`, "E-mailovou aplikaci se nepodařilo otevřít.")}
        onSelectProvider={() => {
          if (profileOffer) confirmSelectOffer(profileOffer);
        }}
      />
    );
  }

  if (screen === "job") {
    if (!activeJob) return null;
    return (
      <DetailShell title="Detail poptávky" onBack={() => { setTransportTab("requests"); setScreen("transport"); }}>
        <DetailStatusHeader
          label="Poptávka"
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
        {activeJob.status === "offer_selected" &&
        activeAcceptedJob?.id === activeJob.id &&
        activeAcceptedJob.acceptedOffer.driver_id === userId &&
        activeAcceptedJob.acceptedOffer.tow_request_id === activeJob.id ? (
          <DetailSection title="Vaše přijatá nabídka">
            <Text style={styles.detailPriceText}>
              {activeAcceptedJob.acceptedOffer.price === null
                ? "Cena dohodou"
                : `${activeAcceptedJob.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`}
            </Text>
          </DetailSection>
        ) : null}
        <DetailSection title="Akce">
          {activeJob.status === "open" ? (
            activeJob.customerId && activeJob.customerId === userId ? (
              <Text style={styles.detailBodyMuted}>Na vlastní poptávku nelze odeslat cenovou nabídku.</Text>
            ) : (
              <>
                <Text style={styles.detailBodyMuted}>Pošlete zákazníkovi svou cenu a dostupné informace k příjezdu.</Text>
                <DetailPrimaryAction label="Nabídnout cenu" onPress={() => setScreen("offerForm")} />
              </>
            )
          ) : (
            <>
              <DetailInfoRow label="Stav" value={transportLifecycleStatusLabel(activeJob.status)} />
              {(activeJob.status === "offer_selected" || activeJob.status === "in_progress" || activeJob.status === "completed") ? (
                <DetailPrimaryAction label="Přejít k přepravě" onPress={() => setScreen("tracking")} />
              ) : null}
            </>
          )}
        </DetailSection>
        <DetailSecondaryAction label="Zpět na přepravu" onPress={() => { setTransportTab("requests"); setScreen("transport"); }} />
      </DetailShell>
    );
  }

  if (screen === "vehicleForm") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title={editingVehicleId ? "Upravit vozidlo" : "Přidat vozidlo"} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Základní informace</Text>
          <Text style={styles.label}>Název vozidla</Text>
          <TextInput style={styles.input} value={vehicleName} onChangeText={setVehicleName} placeholder="Např. Osobní auto 1" />

          <Text style={styles.label}>Typ vozidla</Text>
          <TextInput style={styles.input} value={vehicleType} onChangeText={setVehicleType} placeholder="Např. Osobní auto, SUV, Dodávka" />

          <Text style={styles.label}>Značka (volitelné)</Text>
          <TextInput style={styles.input} value={vehicleMake} onChangeText={setVehicleMake} placeholder="Např. Škoda, Mercedes" />

          <Text style={styles.label}>Model (volitelné)</Text>
          <TextInput style={styles.input} value={vehicleModel} onChangeText={setVehicleModel} placeholder="Např. Octavia, Vito" />

          <Text style={styles.label}>Rok výroby (volitelné)</Text>
          <TextInput style={styles.input} value={vehicleYear} onChangeText={setVehicleYear} placeholder="Např. 2020" keyboardType="numeric" />

          <Text style={styles.label}>Registrace (volitelné)</Text>
          <TextInput style={styles.input} value={vehicleRegistrationNumber} onChangeText={setVehicleRegistrationNumber} placeholder="Např. 1A2 3456" />

          <Text style={styles.sectionTitle}>Rozměry a nosnost</Text>
          <Text style={styles.label}>Max. nosnost (kg)</Text>
          <TextInput style={styles.input} value={vehicleMaxWeight} onChangeText={setVehicleMaxWeight} placeholder="Např. 3500" keyboardType="numeric" />

          <Text style={styles.label}>Max. délka (cm)</Text>
          <TextInput style={styles.input} value={vehicleMaxLength} onChangeText={setVehicleMaxLength} placeholder="Např. 500" keyboardType="numeric" />

          <Text style={styles.label}>Max. šířka (cm)</Text>
          <TextInput style={styles.input} value={vehicleMaxWidth} onChangeText={setVehicleMaxWidth} placeholder="Např. 200" keyboardType="numeric" />

          <Text style={styles.label}>Max. výška (cm)</Text>
          <TextInput style={styles.input} value={vehicleMaxHeight} onChangeText={setVehicleMaxHeight} placeholder="Např. 250" keyboardType="numeric" />

          <Text style={styles.label}>Kapacita (volitelné)</Text>
          <TextInput style={styles.input} value={vehicleCapacity} onChangeText={setVehicleCapacity} placeholder="Např. 4" keyboardType="numeric" />

          <Text style={styles.label}>Popis (volitelné)</Text>
          <TextInput style={[styles.input, styles.multilineInput]} value={vehicleDescription} onChangeText={setVehicleDescription} placeholder="Doplňující informace o vozidle" multiline />

          <Text style={styles.sectionTitle}>Stav a vybavení</Text>
          <Text style={styles.label}>Je vozidlo aktivní?</Text>
          <View style={styles.chips}>
            <TouchableOpacity style={[styles.chip, vehicleIsActive && styles.chipActive]} onPress={() => setVehicleIsActive(true)}>
              <Text>Aktivní</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, !vehicleIsActive && styles.chipActive]} onPress={() => setVehicleIsActive(false)}>
              <Text>Neaktivní</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Vybavení (stačí označit)</Text>
          <View style={styles.chips}>
            <TouchableOpacity style={[styles.chip, vehicleHasWinch && styles.chipActive]} onPress={() => setVehicleHasWinch(!vehicleHasWinch)}>
              <Text>Naviják</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, vehicleHasHydraulicPlatform && styles.chipActive]} onPress={() => setVehicleHasHydraulicPlatform(!vehicleHasHydraulicPlatform)}>
              <Text>Hydraulická nástavba</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, vehicleHasRamps && styles.chipActive]} onPress={() => setVehicleHasRamps(!vehicleHasRamps)}>
              <Text>Rampy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, vehicleHasStraps && styles.chipActive]} onPress={() => setVehicleHasStraps(!vehicleHasStraps)}>
              <Text>Pásy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, vehicleHasJumpStarter && styles.chipActive]} onPress={() => setVehicleHasJumpStarter(!vehicleHasJumpStarter)}>
              <Text>Startér</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, vehicleHasCompressor && styles.chipActive]} onPress={() => setVehicleHasCompressor(!vehicleHasCompressor)}>
              <Text>Kompresor</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.primary} onPress={saveVehicle}>
            <Text style={styles.primaryText}>Uložit vozidlo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => goToVehicles()}>
            <Text style={styles.secondaryText}>Zpět na vozidla</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "vehicles") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Moje vozidla" />
        {vehiclesLoading ? (
          <View style={styles.scroll}>
            <Text style={styles.empty}>Načítám vozidla...</Text>
          </View>
        ) : vehicles.length === 0 ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.empty}>Žádná vozidla.</Text>
            <TouchableOpacity style={styles.primary} onPress={() => setScreen("vehicleForm")}>
              <Text style={styles.primaryText}>Přidat vozidlo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setScreen("profile")}>
              <Text style={styles.secondaryText}>Zpět na profil</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <FlatList
            data={vehicles}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <TouchableOpacity style={styles.primary} onPress={() => setScreen("vehicleForm")}>
                <Text style={styles.primaryText}>Přidat vozidlo</Text>
              </TouchableOpacity>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.vehicleCard}
                onPress={() => {
                  editVehicle(item);
                  setScreen("vehicleForm");
                }}
              >
                <View style={styles.vehicleHeader}>
                  <View>
                    <Text style={styles.vehicleName}>{item.name || "Bez názvu"}</Text>
                    <Text style={styles.vehicleInfo}>
                      {item.vehicle_type || "Typ nebyl uveden"}
                      {item.make ? ` • ${item.make}` : ""}
                      {item.model ? ` ${item.model}` : ""}
                      {item.year ? ` (${item.year})` : ""}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, item.is_active ? styles.activeBadge : styles.inactiveBadge]}>
                    <Text style={styles.statusBadgeText}>{item.is_active ? "Aktivní" : "Neaktivní"}</Text>
                  </View>
                </View>

                <View style={styles.vehicleDetails}>
                  <View style={styles.vehicleDetailRow}>
                    <Text style={styles.vehicleDetailLabel}>Registrace</Text>
                    <Text style={styles.vehicleDetailValue}>{item.registration_number || "—"}</Text>
                  </View>
                  <View style={styles.vehicleDetailRow}>
                    <Text style={styles.vehicleDetailLabel}>Nosnost</Text>
                    <Text style={styles.vehicleDetailValue}>{item.max_weight_kg ? `${item.max_weight_kg} kg` : "—"}</Text>
                  </View>
                  <View style={styles.vehicleDetailRow}>
                    <Text style={styles.vehicleDetailLabel}>Délka</Text>
                    <Text style={styles.vehicleDetailValue}>{item.max_vehicle_length_cm ? `${item.max_vehicle_length_cm} cm` : "—"}</Text>
                  </View>
                  <View style={styles.vehicleDetailRow}>
                    <Text style={styles.vehicleDetailLabel}>Šířka</Text>
                    <Text style={styles.vehicleDetailValue}>{item.max_vehicle_width_cm ? `${item.max_vehicle_width_cm} cm` : "—"}</Text>
                  </View>
                  <View style={styles.vehicleDetailRow}>
                    <Text style={styles.vehicleDetailLabel}>Výška</Text>
                    <Text style={styles.vehicleDetailValue}>{item.max_vehicle_height_cm ? `${item.max_vehicle_height_cm} cm` : "—"}</Text>
                  </View>
                  <View style={styles.vehicleDetailRow}>
                    <Text style={styles.vehicleDetailLabel}>Kapacita</Text>
                    <Text style={styles.vehicleDetailValue}>{item.capacity ? `${item.capacity}` : "—"}</Text>
                  </View>
                </View>

                <View style={styles.vehicleEquipment}>
                  <Text style={styles.equipmentLabel}>Vybavení:</Text>
                  <View style={styles.equipmentRow}>
                    <Text style={[styles.equipmentItem, item.has_winch && styles.equipmentChecked]}>Naviják</Text>
                    <Text style={[styles.equipmentItem, item.has_hydraulic_platform && styles.equipmentChecked]}>Hydraul. nástavba</Text>
                    <Text style={[styles.equipmentItem, item.has_ramps && styles.equipmentChecked]}>Rampy</Text>
                    <Text style={[styles.equipmentItem, item.has_straps && styles.equipmentChecked]}>Pásy</Text>
                    <Text style={[styles.equipmentItem, item.has_jump_starter && styles.equipmentChecked]}>Startér</Text>
                    <Text style={[styles.equipmentItem, item.has_compressor && styles.equipmentChecked]}>Kompresor</Text>
                  </View>
                </View>

                <View style={styles.vehicleActions}>
                  <TouchableOpacity style={styles.secondary} onPress={() => editVehicle(item)}>
                    <Text style={styles.secondaryText}>Upravit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerButton} onPress={() => deleteVehicle(item)}>
                    <Text style={styles.dangerButtonText}>Smazat</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
        <View style={styles.bottomAction}>
          <TouchableOpacity style={styles.secondary} onPress={() => setScreen("profile")}>
            <Text style={styles.secondaryText}>Zpět na profil</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customerActionRowSubtle} onPress={() => setScreen("profile")}>
            <Text style={styles.customerActionTextSubtle}>← Zpět na profil</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customerActionRowSubtle} onPress={() => setScreen("overview")}>
            <Text style={styles.customerActionTextSubtle}>Zpět na přehled</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }


  return null;
}





export default function RoadLinkApp() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}
