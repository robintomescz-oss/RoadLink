import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "./lib/supabase";
import * as Location from "expo-location";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import { StatusBar } from "expo-status-bar";

type Role = "customer" | "driver";
type RequestViewMode = "owner" | "provider";
type TimePreference =
  | "asap"
  | "within_24h"
  | "within_3_days"
  | "within_week"
  | "specific";
type VehicleMobility =
  | "drivable"
  | "partially_drivable"
  | "not_drivable"
  | "unknown";
type TimeFilter = "all" | TimePreference;
type SortOption = "urgent" | "newest";
type JobStatus =
  | "open"
  | "offer_selected"
  | "in_progress"
  | "completed"
  | "cancelled";

type PickupCoordinates = { latitude: number; longitude: number };

function coordinatesFromValues(latitude: unknown, longitude: unknown): PickupCoordinates | null {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);

  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    return null;
  }

  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

const GEOCODING_TIMEOUT_MS = 6000;

async function geocodeAddress(address: string): Promise<PickupCoordinates | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const geocodingAttempt = Location.geocodeAsync(address)
    .then((results) => {
      const usableResult = results.find((result) =>
        Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
      );

      return usableResult
        ? { latitude: usableResult.latitude, longitude: usableResult.longitude }
        : null;
    })
    .catch((error) => {
      console.warn("Forward geocoding failed:", error);
      return null;
    });

  const timeoutFallback = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), GEOCODING_TIMEOUT_MS);
  });

  const result = await Promise.race([geocodingAttempt, timeoutFallback]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return result;
}

function carrierRouteDepartureLabel(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function carrierRoutePriceLabel(price: number): string {
  return `${price.toLocaleString("cs-CZ")} Kč`;
}

function canonicalVehicleType(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (normalized === "Osobní auto") return "Osobní automobil";
  if (normalized === "Motorka") return "Motocykl";
  return normalized;
}

type Job = {
  id: string;
  customerName: string;
  vehicle: string;
  problem: string;
  pickup: PickupCoordinates | null;
  pickupAddress?: string | null;
  destination: string;
  destinationCoordinates?: PickupCoordinates | null;
  status: JobStatus;
  driverName?: string;
  timePreference?: TimePreference;
  requestedDate?: string | null;
  requestedTime?: string | null;
  vehicleMobility?: VehicleMobility;
  createdAt?: string;
};

type CarrierRoute = {
  id: string;
  driverId?: string;
  fromAddress: string;
  toAddress: string;
  departureAt: string;
  availableSpaces: number;
  maxDeviationKm: number | null;
  vehicleTypes: string;
  price: number | null;
  description: string;
  status: string;
};

type TowOffer = {
  id: string;
  tow_request_id: string;
  driver_id: string;
  price: number | null;
  estimated_arrival_minutes: number;
  estimated_arrival_at: string | null;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
};

type ProviderIdentity = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
};

type AcceptedJob = Job & {
  acceptedOffer: TowOffer;
};

type UserProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: Role;
  email: string;
};

type CarrierProfile = {
  id: string;
  user_id: string;
  display_name: string | null;
  business_type: "individual" | "company" | null;
  company_name: string | null;
  ico: string | null;
  description: string | null;
  service_area: string | null;
  max_radius_km: number | null;
  years_experience: number | null;
  available_24_7: boolean | null;
  phone_public: boolean | null;
  email_public: boolean | null;
  status: string | null;
};

type CarrierVehicle = {
  id: string;
  carrier_id: string;
  name: string | null;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  registration_number: string | null;
  max_weight_kg: number | null;
  max_vehicle_length_cm: number | null;
  max_vehicle_width_cm: number | null;
  max_vehicle_height_cm: number | null;
  capacity: number | null;
  description: string | null;
  has_winch: boolean;
  has_hydraulic_platform: boolean;
  has_ramps: boolean;
  has_straps: boolean;
  has_jump_starter: boolean;
  has_compressor: boolean;
  is_active: boolean;
};

const DESIGN = {
  colors: {
    background: "#F6F8FB",
    surface: "#FFFFFF",
    primary: "#0B1F36",
    primaryDark: "#061525",
    textPrimary: "#0F172A",
    textSecondary: "#667085",
    border: "#E5EAF0",
    success: "#15803d",
    danger: "#b91c1c",
    warning: "#b45309",
    primarySoft: "#eaf4ff",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radius: { small: 10, medium: 12, large: 14 },
} as const;

const DEFAULT_REGION: Region = {
  latitude: 49.8209,
  longitude: 18.2625,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [role, setRole] = useState<Role>("customer");
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationError, setLocationError] = useState("");
  const [pickupText, setPickupText] = useState("");
  const [destination, setDestination] = useState("");
  const [vehicle, setVehicle] = useState("Osobní automobil");
  const [problem, setProblem] = useState("Porucha");
  const [timePreference, setTimePreference] = useState<TimePreference>("asap");
  const [requestedDate, setRequestedDate] = useState<Date | null>(null);
  const [requestedTime, setRequestedTime] = useState<Date | null>(null);
  const [vehicleMobility, setVehicleMobility] = useState<VehicleMobility>("drivable");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [requestStep, setRequestStep] = useState<1 | 2 | 3 | 4>(1);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [mobilityFilter, setMobilityFilter] = useState<VehicleMobility | "all">("all");
  const [sortOption, setSortOption] = useState<SortOption>("urgent");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [acceptedJobs, setAcceptedJobs] = useState<AcceptedJob[]>([]);
  const [acceptedJobsLoading, setAcceptedJobsLoading] = useState(false);
  const [customerRequests, setCustomerRequests] = useState<Job[]>([]);
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});
  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [routeInterestedRequests, setRouteInterestedRequests] = useState<Job[]>([]);
  const [routeInterestsLoading, setRouteInterestsLoading] = useState(false);
  const [routeInterestsError, setRouteInterestsError] = useState(false);
  const [offers, setOffers] = useState<TowOffer[]>([]);
  const [providerIdentities, setProviderIdentities] = useState<Record<string, ProviderIdentity>>({});
  const [offersLoading, setOffersLoading] = useState(false);
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [transportStatusLoading, setTransportStatusLoading] = useState(false);
 const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [interestSelectionVisible, setInterestSelectionVisible] = useState(false);
  const [interestSubmitting, setInterestSubmitting] = useState(false);
 const [requestViewMode, setRequestViewMode] = useState<RequestViewMode>("owner");
 const [userId, setUserId] = useState<string | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const [offerArrivalDate, setOfferArrivalDate] = useState<Date | null>(null);
  const [offerArrivalTime, setOfferArrivalTime] = useState<Date | null>(null);
  const [showOfferDatePicker, setShowOfferDatePicker] = useState(false);
  const [showOfferTimePicker, setShowOfferTimePicker] = useState(false);
  const [offerMessage, setOfferMessage] = useState("");
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [routeDeparture, setRouteDeparture] = useState("");
  const [routeSpaces, setRouteSpaces] = useState("1");
  const [routeMaxDeviationKm, setRouteMaxDeviationKm] = useState("");
  const [routeVehicleTypes, setRouteVehicleTypes] = useState("Osobní automobil");
  const [routePrice, setRoutePrice] = useState("");
  const [routePriceMode, setRoutePriceMode] = useState<"fixed" | "negotiable">("fixed");
  const [routeDescription, setRouteDescription] = useState("");
  const [registrationFirstName, setRegistrationFirstName] = useState("");
  const [registrationLastName, setRegistrationLastName] = useState("");
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [registrationEmail, setRegistrationEmail] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [registrationPasswordConfirmation, setRegistrationPasswordConfirmation] = useState("");
  const [registrationLoading, setRegistrationLoading] = useState(false);
  // Phase 1 Auth: login state + indikátor, že jsme již inicializovali session
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [transportTab, setTransportTab] = useState<"all" | "requests" | "capacity" | "mine">("all");
  const [transportFromFilter, setTransportFromFilter] = useState("");
  const [transportToFilter, setTransportToFilter] = useState("");
  const [transportVehicleFilter, setTransportVehicleFilter] = useState("all");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [carrierProfile, setCarrierProfile] = useState<CarrierProfile | null>(null);
  const [carrierProfileLoading, setCarrierProfileLoading] = useState(false);
  const [carrierProfileEditing, setCarrierProfileEditing] = useState(false);
  const [carrierDisplayName, setCarrierDisplayName] = useState("");
  const [carrierBusinessType, setCarrierBusinessType] = useState<"individual" | "company">("individual");
  const [carrierCompanyName, setCarrierCompanyName] = useState("");
  const [carrierIco, setCarrierIco] = useState("");
  const [carrierDescription, setCarrierDescription] = useState("");
  const [carrierServiceArea, setCarrierServiceArea] = useState("");
  const [carrierMaxRadius, setCarrierMaxRadius] = useState("");
  const [carrierYearsExperience, setCarrierYearsExperience] = useState("");
  const [carrierAvailable247, setCarrierAvailable247] = useState(false);
  const [carrierPhonePublic, setCarrierPhonePublic] = useState<boolean>(true);
  const [carrierEmailPublic, setCarrierEmailPublic] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [insuranceStatus, setInsuranceStatus] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<CarrierVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehicleEditing, setVehicleEditing] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleRegistrationNumber, setVehicleRegistrationNumber] = useState("");
  const [vehicleMaxWeight, setVehicleMaxWeight] = useState("");
  const [vehicleMaxLength, setVehicleMaxLength] = useState("");
  const [vehicleMaxWidth, setVehicleMaxWidth] = useState("");
  const [vehicleMaxHeight, setVehicleMaxHeight] = useState("");
  const [vehicleCapacity, setVehicleCapacity] = useState("");
  const [vehicleDescription, setVehicleDescription] = useState("");
  const [vehicleHasWinch, setVehicleHasWinch] = useState(false);
  const [vehicleHasHydraulicPlatform, setVehicleHasHydraulicPlatform] = useState(false);
  const [vehicleHasRamps, setVehicleHasRamps] = useState(false);
  const [vehicleHasStraps, setVehicleHasStraps] = useState(false);
  const [vehicleHasJumpStarter, setVehicleHasJumpStarter] = useState(false);
  const [vehicleHasCompressor, setVehicleHasCompressor] = useState(false);
  const [vehicleIsActive, setVehicleIsActive] = useState(true);
 console.log(
  "Supabase URL:",
  process.env.EXPO_PUBLIC_SUPABASE_URL
);

  function clearLocalUserState() {
    setUserId(null);
    setProfile(null);
    setCarrierProfile(null);
    setJobs([]);
    setAcceptedJobs([]);
    setCustomerRequests([]);
    setOfferCounts({});
    setRoutes([]);
    setActiveRouteId(null);
    setRouteInterestedRequests([]);
    setRouteInterestsError(false);
    setOffers([]);
    setProviderIdentities({});
    setVehicles([]);
    setActiveJobId(null);
    setProfileEditing(false);
    setCarrierProfileEditing(false);
    setVehicleEditing(false);
    setEditingVehicleId(null);
    setInterestSelectionVisible(false);
    setInterestSubmitting(false);
  }

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        console.error("Auth session init:", error.message);
      }
      const sessionUserId = data.session?.user?.id ?? null;
      if (sessionUserId) {
        setUserId(sessionUserId);
        setScreen((currentScreen) =>
          currentScreen === "welcome" || currentScreen === "login" || currentScreen === "signup"
            ? "overview"
            : currentScreen
        );
      } else {
        clearLocalUserState();
      }
      setAuthInitialized(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUserId = session?.user?.id ?? null;
      if (sessionUserId) {
        setUserId(sessionUserId);
      } else {
        clearLocalUserState();
        setScreen("welcome");
      }
      setAuthInitialized(true);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);
  const activeAcceptedJob = acceptedJobs.find((job) => job.id === activeJobId) || null;
  const activeJob =
    jobs.find((job) => job.id === activeJobId) ||
    customerRequests.find((job) => job.id === activeJobId) ||
    activeAcceptedJob ||
    null;
  const activeRoute = routes.find((route) => route.id === activeRouteId) || null;

  function mapTowRequestRow(row: any): Job {
    return {
      id: row.id,
      customerName: "Uživatel RoadLink",
      vehicle: canonicalVehicleType(row.vehicle_type || "Vozidlo"),
      problem: row.problem_description || "Porucha",
      pickup: coordinatesFromValues(row.pickup_lat, row.pickup_lng),
      pickupAddress: row.pickup_address || null,
      destination: row.destination_address || "Servis dle domluvy",
      destinationCoordinates: coordinatesFromValues(row.destination_lat, row.destination_lng),
      status: row.status,
      timePreference: row.time_preference || "asap",
      requestedDate: row.requested_date || null,
      requestedTime: row.requested_time || null,
      vehicleMobility: row.vehicle_mobility || "unknown",
      createdAt: row.created_at || "",
    };
  }

  async function loadJobs() {
    const { data, error } = await supabase
      .from("tow_requests")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load jobs:", error.message);
      return;
    }

    const mapped: Job[] = (data || []).map(mapTowRequestRow);

    setJobs(mapped);
  }

  async function loadAcceptedJobs() {
    if (!userId) return;

    setAcceptedJobsLoading(true);
    const { data: acceptedOffers, error: offersError } = await supabase
      .from("tow_offers")
      .select("*")
      .eq("driver_id", userId)
      .eq("status", "accepted");

    if (offersError) {
      console.error("Load accepted offers:", offersError.message);
      setAcceptedJobsLoading(false);
      return;
    }

    const offerRows = (acceptedOffers || []) as TowOffer[];
    if (offerRows.length === 0) {
      setAcceptedJobs([]);
      setAcceptedJobsLoading(false);
      return;
    }

    const { data: requestRows, error: requestsError } = await supabase
      .from("tow_requests")
      .select("*")
      .in("id", offerRows.map((offer) => offer.tow_request_id));

    if (requestsError) {
      console.error("Load accepted requests:", requestsError.message);
      setAcceptedJobsLoading(false);
      return;
    }

    const accepted = (requestRows || []).flatMap((row) => {
      const acceptedOffer = offerRows.find((offer) => offer.tow_request_id === row.id);
      if (!acceptedOffer) return [];

      return [{ ...mapTowRequestRow(row), acceptedOffer }];
    });

    setAcceptedJobs(accepted);
    setAcceptedJobsLoading(false);
  }

  async function loadCustomerRequests() {
    if (!userId) return;

    const { data, error } = await supabase
      .from("tow_requests")
      .select("*")
      .eq("customer_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load customer requests:", error.message);
      return;
    }

    const mapped: Job[] = (data || []).map(mapTowRequestRow);

    setCustomerRequests(mapped);

    if (mapped.length === 0) {
      setOfferCounts({});
      return mapped;
    }

    const { data: offerRows, error: offersError } = await supabase
      .from("tow_offers")
      .select("tow_request_id")
      .in("tow_request_id", mapped.map((job) => job.id));

    if (offersError) {
      console.error("Load offer counts:", offersError.message);
      setOfferCounts({});
      return;
    }

    const counts = (offerRows || []).reduce<Record<string, number>>((current, row) => {
      current[row.tow_request_id] = (current[row.tow_request_id] || 0) + 1;
      return current;
    }, {});
    setOfferCounts(counts);
    return mapped;
  }

  async function loadRoutes() {
    if (!userId) return;

    setRoutesLoading(true);
    setRoutesError(false);
    let query = supabase.from("carrier_routes").select("*");
    query = screen === "driverHome"
      ? query.eq("driver_id", userId).in("status", ["open", "full", "in_progress"])
      : query.eq("status", "open");
    const { data, error } = await query.order("departure_at", { ascending: true });
    setRoutesLoading(false);

    if (error) {
      console.error("Load routes:", error.message);
      setRoutesError(true);
      setRoutes([]);
      return;
    }

    setRoutes(
      (data || []).map((row) => ({
        id: row.id,
        driverId: row.driver_id,
        fromAddress: row.from_address || "Neuvedeno",
        toAddress: row.to_address || "Neuvedeno",
        departureAt: row.departure_at || "Neuvedeno",
        availableSpaces: row.available_spaces ?? 0,
        maxDeviationKm: row.max_deviation_km ?? null,
        vehicleTypes: Array.isArray(row.vehicle_types)
          ? row.vehicle_types.map((value: string) => canonicalVehicleType(value)).join(", ")
          : canonicalVehicleType(row.vehicle_types || "Neuvedeno"),
        price: row.price ?? null,
        description: row.description || "",
        status: row.status || "open",
      }))
    );
  }

  async function loadRouteInterestedRequests(routeId: string) {
    setRouteInterestsLoading(true);
    setRouteInterestsError(false);

    const { data: interestRows, error: interestsError } = await supabase
      .from("carrier_route_interests")
      .select("tow_request_id")
      .eq("carrier_route_id", routeId);

    if (interestsError) {
      console.error("Load route interests:", interestsError.message);
      setRouteInterestedRequests([]);
      setRouteInterestsError(true);
      setRouteInterestsLoading(false);
      return;
    }

    const requestIds = Array.from(new Set((interestRows || []).map((row) => row.tow_request_id).filter(Boolean)));
    if (requestIds.length === 0) {
      setRouteInterestedRequests([]);
      setRouteInterestsLoading(false);
      return;
    }

    const { data: requestRows, error: requestsError } = await supabase
      .from("tow_requests")
      .select("*")
      .in("id", requestIds);

    if (requestsError) {
      console.error("Load interested requests:", requestsError.message);
      setRouteInterestedRequests([]);
      setRouteInterestsError(true);
      setRouteInterestsLoading(false);
      return;
    }

    setRouteInterestedRequests((requestRows || []).filter((row) => row.status === "open").map(mapTowRequestRow));
    setRouteInterestsLoading(false);
  }

  async function loadOffers() {
    if (!activeJobId) {
      setOffers([]);
      setProviderIdentities({});
      return;
    }

    const requestId = activeJobId;
    setOffersLoading(true);
    const { data, error } = await supabase
      .from("tow_offers")
      .select("*")
      .eq("tow_request_id", requestId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Load offers:", error.message);
      setProviderIdentities({});
      setOffersLoading(false);
      return;
    }

    const loadedOffers = (data || []) as TowOffer[];
    setOffers(loadedOffers);

    const { data: identityRows, error: identityError } = await supabase.rpc("get_offer_provider_identities", {
      p_tow_request_id: requestId,
    });

    if (identityError) {
      console.error("Load offer provider identities:", identityError.message);
      setProviderIdentities({});
      setOffersLoading(false);
      return;
    }

    const identities = ((identityRows || []) as ProviderIdentity[]).reduce<Record<string, ProviderIdentity>>((current, identity) => {
      current[identity.user_id] = identity;
      return current;
    }, {});
    setProviderIdentities(identities);
    setOffersLoading(false);
  }

  function providerNameForOffer(offer: TowOffer) {
    const identity = providerIdentities[offer.driver_id];
    const companyName = identity?.company_name?.trim();
    if (companyName) return companyName;

    const displayName = identity?.display_name?.trim();
    if (displayName) return displayName;

    return "Přepravce";
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

  async function updateTransportStatus(nextStatus: "in_progress" | "completed") {
    if (!activeJobId || !activeJob || !userId || transportStatusLoading) return;

    const selectedOffer =
      offers.find((offer) => offer.status === "accepted") ||
      (activeAcceptedJob?.acceptedOffer.tow_request_id === activeJobId ? activeAcceptedJob.acceptedOffer : null);

    if (!selectedOffer || selectedOffer.driver_id !== userId) {
      Alert.alert("RoadLink", "Stav přepravy může měnit pouze vybraný přepravce.");
      return;
    }

    if (nextStatus === "in_progress" && activeJob.status !== "offer_selected") return;
    if (nextStatus === "completed" && activeJob.status !== "in_progress") return;

    setTransportStatusLoading(true);
    const { error } = await supabase.rpc("advance_tow_request_status", {
      p_tow_request_id: activeJobId,
      p_expected_status: activeJob.status,
      p_next_status: nextStatus,
    });

    if (error) {
      console.error("Update transport status:", error.message);
      Alert.alert("Chyba", "Stav přepravy se nepodařilo změnit. Zkuste to prosím znovu.");
      setTransportStatusLoading(false);
      return;
    }

    setJobs((current) =>
      current.map((job) => job.id === activeJobId ? { ...job, status: nextStatus } : job)
    );
    setCustomerRequests((current) =>
      current.map((job) => job.id === activeJobId ? { ...job, status: nextStatus } : job)
    );
    setAcceptedJobs((current) =>
      current.map((job) => job.id === activeJobId ? { ...job, status: nextStatus } : job)
    );

    await loadJobs();
    await loadAcceptedJobs();
    await loadCustomerRequests();
    await loadOffers();
    setTransportStatusLoading(false);
  }

  function selectedOfferForActiveJob() {
    return (
      offers.find((offer) => offer.status === "accepted") ||
      (activeAcceptedJob?.acceptedOffer.tow_request_id === activeJobId ? activeAcceptedJob.acceptedOffer : null)
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

    const deviationText = routeMaxDeviationKm.trim();
    const maxDeviationKm = deviationText === "" ? null : Number(deviationText);
    if (maxDeviationKm !== null && (!/^\d+$/.test(deviationText) || !Number.isSafeInteger(maxDeviationKm) || maxDeviationKm < 0 || maxDeviationKm > 2147483647)) {
      Alert.alert("Neplatná odchylka", "Zadejte celé nezáporné číslo v km (nejvýše 2147483647), nebo pole ponechte prázdné.");
      return;
    }

    const availableSpaces = Number(routeSpaces);
    const price = routePrice.trim() === "" ? null : Number(routePrice);

    if (!routeFrom || !routeTo || !routeDeparture || !Number.isFinite(availableSpaces) || (price !== null && !Number.isFinite(price))) {
      Alert.alert("Chyba", "Vyplňte prosím všechna povinná pole trasy.");
      return;
    }

    const fromAddress = routeFrom.trim();
    const toAddress = routeTo.trim();
    const vehicleType = canonicalVehicleType(routeVehicleTypes);
    const [fromCoordinates, toCoordinates] = await Promise.all([
      geocodeAddress(fromAddress),
      geocodeAddress(toAddress),
    ]);

    const { error } = await supabase.from("carrier_routes").insert({
      driver_id: userId,
      from_address: fromAddress,
      from_lat: fromCoordinates?.latitude ?? null,
      from_lng: fromCoordinates?.longitude ?? null,
      to_address: toAddress,
      to_lat: toCoordinates?.latitude ?? null,
      to_lng: toCoordinates?.longitude ?? null,
      departure_at: routeDeparture,
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
    setRouteMaxDeviationKm("");
    Alert.alert("Trasa vytvořena", "Vaše nabídka volné trasy byla uložena.");
    setScreen("transport");
  }

  async function handleInterestPress() {
    if (!userId) return;
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
    if (screen === "routeDetail" && activeRouteId && activeRoute?.driverId === userId) {
      loadRouteInterestedRequests(activeRouteId);
    } else {
      setRouteInterestedRequests([]);
      setRouteInterestsError(false);
      setRouteInterestsLoading(false);
    }
  }, [screen, activeRouteId, activeRoute?.driverId, userId]);

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
    if (screen === "tracking" || screen === "job") {
      loadOffers();
    }
  }, [screen, activeJobId]);

  useEffect(() => {
    if (screen === "customerRequests" && userId) {
      loadCustomerRequests();
    }
  }, [screen, userId]);

  useEffect(() => {
    if (screen === "profile" && userId) {
      loadProfile();
    }
  }, [screen, userId]);

  useEffect(() => {
    if (screen === "customerHome" || screen === "driverHome" || screen === "request" || screen === "tracking" || screen === "job") {
      requestLocation();
    }
  }, [screen]);

  useEffect(() => {
    if (screen === "vehicles" && userId) {
      loadVehicles();
    }
  }, [screen, userId]);

  async function requestLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Povolte RoadLink přístup k poloze.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocation(current);
      setLocationError("");
    } catch {
      setLocationError("Nepodařilo se získat aktuální polohu.");
    }
  }

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

  async function loginUser() {
    const email = loginEmail.trim();
    const password = loginPassword;

    if (!email || !password) {
      Alert.alert("Chybí údaje", "Zadejte prosím e-mail a heslo.");
      return;
    }

    setLoginLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Supabase signIn error:", error);
      Alert.alert("Přihlášení se nepodařilo", formatSupabaseError(error));
      setLoginLoading(false);
      return;
    }

    if (data.user) {
      setUserId(data.user.id);
    }

    setLoginLoading(false);
    setScreen("overview");
  }

  async function signOutUser() {
    setSignOutLoading(true);
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Supabase signOut error:", error);
      Alert.alert("Odhlášení se nepodařilo", formatSupabaseError(error));
      setSignOutLoading(false);
      return;
    }

    clearLocalUserState();
    setLoginPassword("");
    setScreen("welcome");
    setSignOutLoading(false);
  }

  // Zajistí, že existuje carrier_profiles řádek pro aktuálního uživatele.
  // Pokud existuje, vrátí ho. Pokud neexistuje, vytvoří ho s defaultními
  // hodnotami a vrátí nový řádek. Bezpečné volat opakovaně.
  async function ensureCarrierProfile(): Promise<CarrierProfile | null> {
    if (!userId) return null;

    // 1) Pokus o načtení existujícího profilu.
    const { data: existing, error: loadError } = await supabase
      .from("carrier_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (loadError && loadError.code !== "PGRST116") {
      console.error("Ensure carrier profile (load):", loadError.message);
      return null;
    }

    if (existing) {
      setCarrierProfile(existing as CarrierProfile);
      return existing as CarrierProfile;
    }

    // 2) Profil neexistuje → vytvoříme ho s defaultními hodnotami
    //    stejně jako při registraci (viz registerUser).
    const { data: created, error: insertError } = await supabase
      .from("carrier_profiles")
      .insert({
        user_id: userId,
        status: "pending",
        business_type: "individual",
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Ensure carrier profile (insert):", insertError.message);
      Alert.alert(
        "Přepravní profil",
        "Nepodařilo se vytvořit přepravní profil. Zkuste to prosím znovu."
      );
      return null;
    }

    setCarrierProfile(created as CarrierProfile);
    return created as CarrierProfile;
  }

  function goToVehicles() {
    setEditingVehicleId(null);
    setVehicleEditing(false);
    setScreen("vehicles");
  }

  async function loadProfile() {
    if (!userId) return;

    setProfileLoading(true);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      console.error("Load auth user:", authError?.message || "User not found");
      setProfileLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, phone, role")
      .eq("id", authData.user.id)
      .single();

    if (error) {
      console.error("Load profile:", error.message);
      setProfileLoading(false);
      return;
    }

    const loadedProfile: UserProfile = {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      role: data.role,
      email: authData.user.email || "E-mail není uveden",
    };
    setProfile(loadedProfile);
    setProfileFirstName(loadedProfile.first_name || "");
    setProfileLastName(loadedProfile.last_name || "");
    setProfilePhone(loadedProfile.phone || "");
    setProfileLoading(false);

    await loadCarrierProfile();
  }

  async function loadCarrierProfile() {
    if (!userId) return;

    setCarrierProfileLoading(true);
    const { data, error } = await supabase
      .from("carrier_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Load carrier profile:", error.message);
      setCarrierProfile(null);
      setVerificationStatus(null);
      setInsuranceStatus(null);
      setCarrierProfileLoading(false);
      return;
    }

    if (!data) {
      setCarrierProfile(null);
      setVerificationStatus(null);
      setInsuranceStatus(null);
      setCarrierProfileLoading(false);
      return;
    }

    const loadedProfile = data as CarrierProfile;
    setCarrierProfile(loadedProfile);
    setCarrierDisplayName(loadedProfile.display_name || "");
    setCarrierBusinessType(loadedProfile.business_type || "individual");
    setCarrierCompanyName(loadedProfile.company_name || "");
    setCarrierIco(loadedProfile.ico || "");
    setCarrierDescription(loadedProfile.description || "");
    setCarrierServiceArea(loadedProfile.service_area || "");
    setCarrierMaxRadius(loadedProfile.max_radius_km?.toString() || "");
    setCarrierYearsExperience(loadedProfile.years_experience?.toString() || "");
    setCarrierAvailable247(loadedProfile.available_24_7 || false);
setCarrierPhonePublic(loadedProfile.phone_public ?? true);
setCarrierEmailPublic(loadedProfile.email_public ?? false);

const [{ data: verification }, { data: insurance }] = await Promise.all([
  supabase
    .from("carrier_verification")
    .select("status")
    .eq("carrier_id", loadedProfile.id)
    .maybeSingle(),
  supabase
    .from("carrier_insurance")
    .select("status")
    .eq("carrier_id", loadedProfile.id)
    .maybeSingle(),
]);
    setVerificationStatus(verification?.status || null);
    setInsuranceStatus(insurance?.status || null);
    setCarrierProfileLoading(false);
  }

  async function activateCarrierProfile() {
    if (!userId || carrierProfileLoading) return;

    setCarrierProfileLoading(true);
    const profile = await ensureCarrierProfile();
    setCarrierProfileLoading(false);

    if (!profile) {
      Alert.alert("RoadLink", "Přepravní profil se nepodařilo aktivovat.");
      return;
    }

    await loadCarrierProfile();
  }

  async function loadVehicles() {
    if (!userId) return;

    setVehiclesLoading(true);
    const { data: carrier, error: carrierError } = await supabase
      .from("carrier_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (carrierError || !carrier) {
      console.error("Load carrier id:", carrierError?.message || "Carrier profile not found");
      setVehiclesLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("carrier_vehicles")
      .select("*")
      .eq("carrier_id", carrier.id)
      .order("name", { ascending: true });

    if (error) {
      console.error("Load carrier vehicles:", error.message);
      setVehiclesLoading(false);
      return;
    }

    setVehicles((data || []) as CarrierVehicle[]);
    setVehiclesLoading(false);
  }

  function resetVehicleForm() {
    setEditingVehicleId(null);
    setVehicleName("");
    setVehicleType("");
    setVehicleMake("");
    setVehicleModel("");
    setVehicleYear("");
    setVehicleRegistrationNumber("");
    setVehicleMaxWeight("");
    setVehicleMaxLength("");
    setVehicleMaxWidth("");
    setVehicleMaxHeight("");
    setVehicleCapacity("");
    setVehicleDescription("");
    setVehicleHasWinch(false);
    setVehicleHasHydraulicPlatform(false);
    setVehicleHasRamps(false);
    setVehicleHasStraps(false);
    setVehicleHasJumpStarter(false);
    setVehicleHasCompressor(false);
    setVehicleIsActive(true);
  }

  function editVehicle(vehicle: CarrierVehicle) {
    setEditingVehicleId(vehicle.id);
    setVehicleName(vehicle.name || "");
    setVehicleType(vehicle.vehicle_type || "");
    setVehicleMake(vehicle.make || "");
    setVehicleModel(vehicle.model || "");
    setVehicleYear(vehicle.year?.toString() || "");
    setVehicleRegistrationNumber(vehicle.registration_number || "");
    setVehicleMaxWeight(vehicle.max_weight_kg?.toString() || "");
    setVehicleMaxLength(vehicle.max_vehicle_length_cm?.toString() || "");
    setVehicleMaxWidth(vehicle.max_vehicle_width_cm?.toString() || "");
    setVehicleMaxHeight(vehicle.max_vehicle_height_cm?.toString() || "");
    setVehicleCapacity(vehicle.capacity?.toString() || "");
    setVehicleDescription(vehicle.description || "");
    setVehicleHasWinch(vehicle.has_winch);
    setVehicleHasHydraulicPlatform(vehicle.has_hydraulic_platform);
    setVehicleHasRamps(vehicle.has_ramps);
    setVehicleHasStraps(vehicle.has_straps);
    setVehicleHasJumpStarter(vehicle.has_jump_starter);
    setVehicleHasCompressor(vehicle.has_compressor);
    setVehicleIsActive(vehicle.is_active);
    setVehicleEditing(true);
  }

  async function saveVehicle() {
    if (!userId || !vehicleName.trim() || !vehicleType.trim()) {
      Alert.alert("Chybí údaje", "Vyplňte prosím název a typ vozidla.");
      return;
    }

    const toNumber = (value: string) => value.trim() === "" ? null : Number(value);
    const year = toNumber(vehicleYear);
    const maxWeight = toNumber(vehicleMaxWeight);
    const maxLength = toNumber(vehicleMaxLength);
    const maxWidth = toNumber(vehicleMaxWidth);
    const maxHeight = toNumber(vehicleMaxHeight);
    const numericValues = [year, maxWeight, maxLength, maxWidth, maxHeight];
    if (numericValues.some((value) => value !== null && !Number.isFinite(value))) {
      Alert.alert("Chyba", "Rok a rozměry vozidla musí být čísla.");
      return;
    }

    const { data: carrier, error: carrierError } = await supabase
      .from("carrier_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();
    if (carrierError || !carrier) {
      Alert.alert("Chyba", "Profil přepravce se nepodařilo načíst.");
      return;
    }

    const vehicleData = {
      name: vehicleName.trim(),
      vehicle_type: vehicleType.trim(),
      make: vehicleMake.trim() || null,
      model: vehicleModel.trim() || null,
      year,
      registration_number: vehicleRegistrationNumber.trim() || null,
      max_weight_kg: maxWeight,
      max_vehicle_length_cm: maxLength,
      max_vehicle_width_cm: maxWidth,
      max_vehicle_height_cm: maxHeight,
      capacity: toNumber(vehicleCapacity),
      description: vehicleDescription.trim() || null,
      has_winch: vehicleHasWinch,
      has_hydraulic_platform: vehicleHasHydraulicPlatform,
      has_ramps: vehicleHasRamps,
      has_straps: vehicleHasStraps,
      has_jump_starter: vehicleHasJumpStarter,
      has_compressor: vehicleHasCompressor,
      is_active: vehicleIsActive,
    };

    const query = editingVehicleId
      ? supabase.from("carrier_vehicles").update(vehicleData).eq("id", editingVehicleId).eq("carrier_id", carrier.id).select("*").single()
      : supabase.from("carrier_vehicles").insert({ carrier_id: carrier.id, ...vehicleData }).select("*").single();
    const { data, error } = await query;

    if (error) {
      console.error("Save carrier vehicle:", error.message);
      Alert.alert("Chyba", "Vozidlo se nepodařilo uložit.");
      return;
    }

    setVehicles((current) => editingVehicleId
      ? current.map((vehicle) => vehicle.id === editingVehicleId ? data as CarrierVehicle : vehicle)
      : [...current, data as CarrierVehicle]
    );
    resetVehicleForm();
    setVehicleEditing(false);
    Alert.alert("Vozidlo uloženo", "Údaje vozidla byly uloženy.");
  }

  function deleteVehicle(vehicle: CarrierVehicle) {
    Alert.alert("Smazat vozidlo?", `Opravdu chcete smazat vozidlo ${vehicle.name || "bez názvu"}?`, [
      { text: "Zrušit", style: "cancel" },
      {
        text: "Smazat",
        style: "destructive",
        onPress: async () => {
          if (!userId) return;
          const { data: carrier, error: carrierError } = await supabase
            .from("carrier_profiles")
            .select("id")
            .eq("user_id", userId)
            .single();
          if (carrierError || !carrier) {
            Alert.alert("Chyba", "Profil přepravce se nepodařilo načíst.");
            return;
          }
          const { error } = await supabase
            .from("carrier_vehicles")
            .delete()
            .eq("id", vehicle.id)
            .eq("carrier_id", carrier.id);
          if (error) {
            console.error("Delete carrier vehicle:", error.message);
            Alert.alert("Chyba", "Vozidlo se nepodařilo smazat.");
            return;
          }
          setVehicles((current) => current.filter((currentVehicle) => currentVehicle.id !== vehicle.id));
          Alert.alert("Vozidlo smazáno", "Vozidlo bylo odstraněno.");
        },
      },
    ]);
  }

  async function saveCarrierProfile() {
    if (!userId || !carrierProfile) return;

    const maxRadius = carrierMaxRadius.trim() === "" ? null : Number(carrierMaxRadius);
    const yearsExperience = carrierYearsExperience.trim() === "" ? null : Number(carrierYearsExperience);
    if ((maxRadius !== null && !Number.isFinite(maxRadius)) || (yearsExperience !== null && !Number.isFinite(yearsExperience))) {
      Alert.alert("Chyba", "Maximální vzdálenost a roky zkušeností musí být čísla.");
      return;
    }

    setCarrierProfileLoading(true);
    const { data, error } = await supabase
      .from("carrier_profiles")
      .update({
        display_name: carrierDisplayName.trim() || null,
        business_type: carrierBusinessType,
        company_name: carrierCompanyName.trim() || null,
        ico: carrierIco.trim() || null,
        description: carrierDescription.trim() || null,
        service_area: carrierServiceArea.trim() || null,
        max_radius_km: maxRadius,
        years_experience: yearsExperience,
        available_24_7: carrierAvailable247,
        phone_public: carrierPhonePublic,
        email_public: carrierEmailPublic,
      })
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      console.error("Update carrier profile:", error.message);
      Alert.alert("Chyba", "Profil přepravce se nepodařilo uložit.");
      setCarrierProfileLoading(false);
      return;
    }

    setCarrierProfile(data as CarrierProfile);
    setCarrierProfileEditing(false);
    setCarrierProfileLoading(false);
    Alert.alert("Profil uložen", "Profil přepravce byl aktualizován.");
  }

  async function saveProfile() {
    if (!userId) return;

    const firstName = profileFirstName.trim();
    const lastName = profileLastName.trim();
    const phone = profilePhone.trim();
    if (!firstName || !lastName || !phone) {
      Alert.alert("Chybí údaje", "Jméno, příjmení a telefon jsou povinné.");
      return;
    }

    setProfileLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName, phone })
      .eq("id", userId)
      .select("id, first_name, last_name, phone, role")
      .single();

    if (error) {
      console.error("Update profile:", error.message);
      Alert.alert("Chyba", "Profil se nepodařilo uložit.");
      setProfileLoading(false);
      return;
    }

    setProfile((current) => current ? {
      ...current,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
    } : current);
    setProfileEditing(false);
    setProfileLoading(false);
    Alert.alert("Profil uložen", "Vaše údaje byly aktualizovány.");
  }

  async function registerUser() {
    const firstName = registrationFirstName.trim();
    const lastName = registrationLastName.trim();
    const phone = registrationPhone.trim();
    const email = registrationEmail.trim();
    const password = registrationPassword;
    const passwordConfirmation = registrationPasswordConfirmation;

    if (!firstName || !lastName || !phone || !email || !password) {
      Alert.alert("Chybí údaje", "Vyplňte prosím všechna povinná pole.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Neplatné heslo", "Heslo musí mít alespoň 8 znaků.");
      return;
    }

    if (password !== passwordConfirmation) {
      Alert.alert("Neplatné heslo", "Potvrzení hesla se neshoduje.");
      return;
    }

    setRegistrationLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error("Supabase signUp error:", error);
      Alert.alert("Registrace se nepodařila", formatSupabaseError(error));
      setRegistrationLoading(false);
      return;
    }

    const user = data.user;
    if (!user) {
      console.error("Supabase signUp error: user was not created", { session: data.session });
      Alert.alert("Registrace se nepodařila", "Supabase nevytvořil uživatele.");
      setRegistrationLoading(false);
      return;
    }

    console.log("Supabase signUp result:", {
      userId: user.id,
      hasSession: Boolean(data.session),
      emailConfirmationRequired: !data.session,
    });

    const { error: profileError } = await supabase.from("profiles").insert({
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      phone,
      role: "customer",
    });

    if (profileError) {
      console.error("Supabase profile insert error:", profileError);
      Alert.alert(
        "Registrace se nedokončila",
        `Profil se nepodařilo uložit.\n\n${formatSupabaseError(profileError)}`
      );
      setRegistrationLoading(false);
      return;
    }

    setRegistrationLoading(false);
    if (data.session) {
      setUserId(user.id);
      setScreen("overview");
      Alert.alert("Registrace dokončena", "Váš účet byl vytvořen.");
    } else {
      Alert.alert("Registrace dokončena", "Účet byl vytvořen. Pro pokračování potvrďte e-mail.");
      setScreen("login");
    }
  }

 async function createJob() {
  if (!userId) {
    Alert.alert(
      "RoadLink",
      "Probíhá připojování k účtu. Zkuste to za chvíli."
    );
    return;
  }

  if (!vehicle) {
    Alert.alert("RoadLink", "Vyberte prosím typ vozidla.");
    return;
  }

  if (!pickupText.trim()) {
    Alert.alert("RoadLink", "Vyplňte prosím místo vyzvednutí.");
    return;
  }

  if (!destination.trim()) {
    Alert.alert("RoadLink", "Vyplňte prosím cíl přepravy.");
    return;
  }

  if (timePreference === "specific" && !requestedDate) {
    Alert.alert("RoadLink", "Vyberte prosím datum přepravy.");
    return;
  }

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
      problem_description: problem,
      requested_date:
        timePreference === "specific" && requestedDate
          ? formatPostgresDate(requestedDate)
          : null,
      requested_time:
        timePreference === "specific" && requestedTime
          ? formatPostgresTime(requestedTime)
          : null,
      time_preference: timePreference,
      vehicle_mobility: vehicleMobility,
      status: "open",
    })
    .select()
    .single();

  if (error) {
    console.error("Create tow request:", error.message);
    Alert.alert(
      "Chyba",
      "Zakázku se nepodařilo uložit do RoadLinku."
    );
    return;
  }

  const job: Job = {
    id: data.id,
    customerName: "Uživatel RoadLink",
    vehicle: canonicalVehicleType(data.vehicle_type || vehicle),
    problem: data.problem_description || problem,
    pickup: coordinatesFromValues(data.pickup_lat, data.pickup_lng) ?? pickupCoordinates,
    pickupAddress: data.pickup_address || trimmedPickupAddress,
    destination:
      data.destination_address || "Servis dle domluvy",
    destinationCoordinates:
      coordinatesFromValues(data.destination_lat, data.destination_lng) ?? destinationCoordinates,
    status: data.status,
    timePreference: data.time_preference || timePreference,
    requestedDate: data.requested_date || null,
    requestedTime: data.requested_time || null,
    vehicleMobility: data.vehicle_mobility || vehicleMobility,
    createdAt: data.created_at || "",
  };

  setJobs((current) => [job, ...current]);
  setCustomerRequests((current) => [job, ...current]);
  setActiveJobId(job.id);
  setTransportTab("mine");
  await loadJobs();
  await loadCustomerRequests();

  setPickupText(trimmedPickupAddress);

  setRequestStep(1);
  setScreen("requestSuccess");
}

  const filteredJobs = useMemo(() => {
    const timePriority: Record<TimePreference, number> = {
      asap: 0,
      within_24h: 1,
      within_3_days: 2,
      within_week: 3,
      specific: 4,
    };

    return jobs
      .filter((job) => job.status === "open")
      .filter((job) => timeFilter === "all" || job.timePreference === timeFilter)
      .filter((job) => vehicleFilter === "all" || job.vehicle === vehicleFilter)
      .filter((job) => mobilityFilter === "all" || job.vehicleMobility === mobilityFilter)
      .sort((firstJob, secondJob) => {
        if (sortOption === "newest") {
          return (Date.parse(secondJob.createdAt || "") || 0) - (Date.parse(firstJob.createdAt || "") || 0);
        }

        const priorityDifference =
          timePriority[firstJob.timePreference || "asap"] -
          timePriority[secondJob.timePreference || "asap"];
        if (priorityDifference !== 0) return priorityDifference;

        if (firstJob.timePreference === "specific" && secondJob.timePreference === "specific") {
          const firstDate = `${firstJob.requestedDate || "9999-12-31"}T${firstJob.requestedTime || "23:59:59"}`;
          const secondDate = `${secondJob.requestedDate || "9999-12-31"}T${secondJob.requestedTime || "23:59:59"}`;
          return Date.parse(firstDate) - Date.parse(secondDate);
        }

        return (Date.parse(secondJob.createdAt || "") || 0) - (Date.parse(firstJob.createdAt || "") || 0);
      });
  }, [jobs, mobilityFilter, sortOption, timeFilter, vehicleFilter]);

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
    setRequestViewMode("owner");
    setRequestStep(1);
    setScreen("request");
  }

  async function openCapacityFlow() {
    const providerProfile = carrierProfile || await ensureCarrierProfile();
    if (!providerProfile) return;
    await loadCarrierProfile();
    setScreen("routeForm");
  }

  function validateRequestStep(step: typeof requestStep) {
    if (step === 1 && !vehicle) {
      Alert.alert("RoadLink", "Vyberte prosím typ vozidla.");
      return false;
    }

    if (step === 2) {
      if (!pickupText.trim()) {
        Alert.alert("RoadLink", "Vyplňte prosím místo vyzvednutí.");
        return false;
      }
      if (!destination.trim()) {
        Alert.alert("RoadLink", "Vyplňte prosím cíl přepravy.");
        return false;
      }
      if (timePreference === "specific" && !requestedDate) {
        Alert.alert("RoadLink", "Vyberte prosím datum přepravy.");
        return false;
      }
    }

    return true;
  }

  function goToNextRequestStep() {
    if (!validateRequestStep(requestStep)) return;
    setRequestStep((current) => Math.min(current + 1, 4) as typeof requestStep);
  }

  function goToPreviousRequestStep() {
    if (requestStep === 1) {
      setScreen("overview");
      return;
    }
    setRequestStep((current) => Math.max(current - 1, 1) as typeof requestStep);
  }

  function openMyRequestsAfterSuccess() {
    setTransportTab("mine");
    setScreen("transport");
  }

  function Header({ title }: { title: string }) {
    return (
      <SafeAreaView style={styles.headerSafeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>ROADLINK</Text>
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => Alert.alert("Notifikace", "Notifikace budou dostupné v další verzi RoadLinku.")}>
          <Text style={styles.headerSignOut}>⌁</Text>
        </TouchableOpacity>
      </View>
      </SafeAreaView>
    );
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

  function BottomNavigation() {
    const navItems = [
      { key: "overview", label: "Přehled", icon: "▦" },
      { key: "transport", label: "Přeprava", icon: "⇄" },
      { key: "create", label: "+", icon: "+" },
      { key: "sos", label: "SOS", icon: "!" },
      { key: "profile", label: "Profil", icon: "◯" },
    ];

    return (
      <SafeAreaView style={styles.bottomNavSafeArea}>
      <View style={styles.bottomNav}>
        {navItems.map((item) => {
          const isActive = screen === item.key;
          const isCreate = item.key === "create";
          return (
            <TouchableOpacity
              key={item.key}
              style={styles.bottomNavItem}
              onPress={() => {
                if (item.key === "transport") {
                  setTransportTab("requests");
                }
                setScreen(item.key);
              }}
            >
              <Text style={[
                styles.bottomNavIcon,
                isActive && styles.bottomNavTextActive,
                item.key === "sos" && styles.bottomNavSos,
                isCreate && styles.bottomNavPlus,
              ]}>
                {item.icon}
              </Text>
              {!isCreate ? (
                <Text style={[styles.bottomNavText, isActive && styles.bottomNavTextActive, item.key === "sos" && styles.bottomNavSos]}>
                  {item.label}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      </SafeAreaView>
    );
  }

  if (screen === "welcome") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.introScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.introHero}>
            <Image source={require("./assets/roadlink-hero.png")} style={styles.heroImage} resizeMode="cover" />
          </View>
          <View style={styles.introPanel}>
            <Text style={styles.introClaim}>Pomoc na cestě.{"\n"}Když ji potřebujete.</Text>
            <View style={styles.benefitRow}>
              <View style={styles.benefitItem}>
                <Text style={styles.benefitIcon}>✓</Text>
                <Text style={styles.benefitText}>Ověření{"\n"}přepravci</Text>
              </View>
              <View style={styles.benefitItem}>
                <Text style={styles.benefitIcon}>◷</Text>
                <Text style={styles.benefitText}>Rychlá{"\n"}odezva</Text>
              </View>
              <View style={styles.benefitItem}>
                <Text style={styles.benefitIcon}>◆</Text>
                <Text style={styles.benefitText}>Transparentní{"\n"}ceny</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.introTransport}
              onPress={() => {
                if (userId) {
                  setTransportTab("requests");
                  setScreen("transport");
                  return;
                }
                setScreen("login");
              }}
            >
              <Text style={styles.serviceIcon}>🚚</Text>
              <Text style={styles.transportText}>Transport</Text>
              <Text style={styles.serviceArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.introServiceRow}
              onPress={() => Alert.alert("SOS", "SOS pomoc při poruše bude dostupná v další verzi.")}
            >
              <Text style={styles.serviceIcon}>🆘</Text>
              <Text style={styles.serviceText}>SOS – Potřebuji pomoc</Text>
              <Text style={styles.serviceArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.introServiceRow}
              onPress={() => Alert.alert("Servisy", "Seznam servisů bude dostupný v další verzi.")}
            >
              <Text style={styles.serviceIcon}>🔧</Text>
              <Text style={styles.serviceText}>Servisy v okolí</Text>
              <Text style={styles.serviceArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.introLogin} onPress={() => setScreen("login")}>
              <Text style={styles.introLoginText}>Máte účet? Přihlášení</Text>
              <Text style={styles.serviceArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.introSignup} onPress={() => setScreen("signup")}>
              <Text style={styles.introSignupText}>Nemáte účet? Vytvořit účet</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
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
            <TouchableOpacity onPress={() => setScreen("welcome")} disabled={registrationLoading}>
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
          <TouchableOpacity onPress={() => setScreen("signup")} disabled={loginLoading}>
            <Text style={styles.link}>Nemám účet</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen("welcome")} disabled={loginLoading}>
            <Text style={styles.link}>Zpět na úvod</Text>
          </TouchableOpacity>
        </View>
        )}
      </SafeAreaView>
    );
  }

  if (screen === "overview") {
    const activeTransports = customerRequests.filter((item) => item.status === "offer_selected" || item.status === "in_progress");
    const pendingOfferRequests = customerRequests.filter((item) => item.status === "open" && (offerCounts[item.id] || 0) > 0);
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <Header title="Přehled" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.appContent} keyboardShouldPersistTaps="handled">
          <View style={styles.dashboardPanel}>
            <TouchableOpacity style={styles.actionRow} onPress={openRequestFlow}>
              <Text style={styles.actionIcon}>↗</Text>
              <View style={styles.actionBody}>
                <Text style={styles.actionTitle}>Poptat přepravu</Text>
                <Text style={styles.actionSubtitle}>Potřebuji přepravit vozidlo</Text>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={openCapacityFlow}>
              <Text style={styles.actionIcon}>⇄</Text>
              <View style={styles.actionBody}>
                <Text style={styles.actionTitle}>Nabídnout volnou kapacitu</Text>
                <Text style={styles.actionSubtitle}>Mám volné místo na trase</Text>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => { setTransportTab("requests"); setScreen("transport"); }}>
            <Text style={styles.link}>Zobrazit poptávky →</Text>
          </TouchableOpacity>

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
                  <Text style={styles.dispatchRoute}>{item.destination}</Text>
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
                <Text style={styles.emptyCopy}>Akce k poptávkám a nabídkám se zobrazí v této sekci.</Text>
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
                    <Text style={styles.dispatchRoute}>{item.vehicle}</Text>
                    <Text style={styles.dispatchMeta}>{offerCountLabel(count)} čeká na rozhodnutí</Text>
                    <Text style={styles.dispatchMeta}>{routeDisplayLabel(item)}</Text>
                  </View>
                  <Text style={styles.dispatchArrow}>→</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.dashboardGrid}>
            <View style={styles.infoTile}>
              <Text style={styles.sectionLabel}>SERVIS</Text>
              <Text style={styles.infoTileTitle}>Podpora a servisní partneři</Text>
              <Text style={styles.emptyCopy}>Sekce bude rozšířena v další verzi.</Text>
            </View>
            <View style={styles.infoTile}>
              <Text style={styles.sectionLabel}>ECO IMPACT</Text>
              <Text style={styles.infoTileTitle}>Efektivnější vytížení tras</Text>
              <Text style={styles.emptyCopy}>Bez výpočtů v této verzi.</Text>
            </View>
          </View>
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
      <SafeAreaView style={styles.container}>
        <Header title="Přeprava" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.appContent} keyboardShouldPersistTaps="handled">
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
                <Text style={styles.sectionLabel}>FILTROVAT PŘEPRAVY</Text>
                {transportFiltersActive ? (
                  <TouchableOpacity onPress={clearTransportFilters}>
                    <Text style={styles.detailLink}>Vymazat</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
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

          {(transportTab === "all" || transportTab === "requests") ? (
            <View>
              <View style={styles.transportSectionHeader}>
                <Text style={styles.sectionLabel}>POPTÁVKY</Text>
                <Text style={styles.transportCount}>{openRequestCards.length}</Text>
              </View>
              {openRequestCards.length === 0 ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>{transportFiltersActive ? "Žádné poptávky neodpovídají filtrům" : "Žádné otevřené poptávky"}</Text></View>
              ) : openRequestCards.map((item) => (
                <TouchableOpacity key={item.id} style={styles.dispatchCard} onPress={() => { setActiveJobId(item.id); setRequestViewMode("provider"); setScreen("job"); }}>
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
                  <TouchableOpacity style={styles.secondary} onPress={loadRoutes}>
                    <Text style={styles.secondaryText}>Zkusit znovu</Text>
                  </TouchableOpacity>
                </View>
              ) : openCapacityCards.length === 0 ? (
                <View style={styles.emptyPanel}>
                  <Text style={styles.emptyTitle}>{transportFiltersActive ? "Žádné trasy neodpovídají filtrům" : "Žádné otevřené volné trasy"}</Text>
                  <Text style={styles.emptyCopy}>{transportFiltersActive ? "Upravte nebo vymažte filtry a zkuste to znovu." : "Aktivní nabídky volné kapacity se zobrazí zde."}</Text>
                </View>
              ) : openCapacityCards.map((route) => (
                <TouchableOpacity
                  key={route.id}
                  style={styles.dispatchCard}
                  onPress={() => {
                    setActiveRouteId(route.id);
                    setScreen("routeDetail");
                  }}
                >
                  <View style={styles.dispatchHeader}>
                    <Text style={styles.dispatchLabel}>VOLNÁ KAPACITA</Text>
                  </View>
                  <Text style={styles.dispatchVehicle}>{route.vehicleTypes}</Text>
                  <Text style={styles.routeLine}>{route.fromAddress} → {route.toAddress}</Text>
                  <View style={styles.dispatchFooter}>
                    <View>
                      <Text style={styles.dispatchMeta}>Odjezd: {carrierRouteDepartureLabel(route.departureAt)}</Text>
                      {route.maxDeviationKm !== null ? <Text style={styles.dispatchMeta}>Max. odchylka {route.maxDeviationKm} km</Text> : null}
                      <Text style={styles.dispatchMeta}>{route.availableSpaces} {route.availableSpaces === 1 ? "volné místo" : route.availableSpaces >= 2 && route.availableSpaces <= 4 ? "volná místa" : "volných míst"}{route.price !== null ? ` · ${carrierRoutePriceLabel(route.price)}` : ""}</Text>
                    </View>
                    <Text style={styles.dispatchArrow}>→</Text>
                  </View>
                </TouchableOpacity>
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
                <TouchableOpacity
                  key={item.id}
                  style={styles.dispatchCard}
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
                  <View style={styles.dispatchHeader}>
                    <Text style={styles.dispatchLabel}>PŘEPRAVA</Text>
                    <Text style={styles.statusPill}>{transportStatusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.dispatchVehicle}>{item.vehicle} · {vehicleMobilityLabel(item.vehicleMobility)}</Text>
                  <Text style={styles.routeLine}>{routeDisplayLabel(item)}</Text>
                  <View style={styles.dispatchFooter}>
                    <View>
                      <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                      <Text style={styles.dispatchMeta}>
                        {item.acceptedOffer.price === null
                          ? "Cena dohodou"
                          : `${item.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`}
                      </Text>
                    </View>
                    <Text style={styles.dispatchArrow}>→</Text>
                  </View>
                </TouchableOpacity>
              ))}

              <View style={styles.transportSectionHeader}>
                <Text style={styles.sectionLabel}>MOJE POPTÁVKY</Text>
                <Text style={styles.transportCount}>{myRequestCards.length}</Text>
              </View>
              {myRequestCards.length === 0 ? (
                <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Zatím nemáte žádnou vlastní poptávku</Text></View>
              ) : myRequestCards.map((item) => (
                <TouchableOpacity key={item.id} style={styles.dispatchCard} onPress={() => { setActiveJobId(item.id); setRequestViewMode("owner"); setJobs((current) => current.some((job) => job.id === item.id) ? current : [...current, item]); setScreen("job"); }}>
                  <View style={styles.dispatchHeader}>
                    <Text style={styles.dispatchLabel}>MOJE POPTÁVKA</Text>
                    <Text style={styles.statusPill}>{transportStatusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.dispatchVehicle}>{item.vehicle}</Text>
                  <Text style={styles.routeLine}>{routeDisplayLabel(item)}</Text>
                  <View style={styles.dispatchFooter}>
                    <View>
                      <Text style={styles.dispatchMeta}>{requestTimingLabel(item)}</Text>
                      <Text style={styles.dispatchMeta}>{offerCounts[item.id] ? `${offerCounts[item.id]} ${offerCounts[item.id] === 1 ? "nabídka" : "nabídky"}` : "Bez nabídek"}</Text>
                    </View>
                    <Text style={styles.dispatchArrow}>→</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </ScrollView>
        <BottomNavigation />
      </SafeAreaView>
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
      <SafeAreaView style={styles.container}>
        <Header title="Nový požadavek" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.appContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.bigTitle}>Co chcete vytvořit?</Text>
          <TouchableOpacity style={styles.actionCard} onPress={openRequestFlow}>
            <Text style={styles.actionTitle}>Poptávka</Text>
            <Text style={styles.muted}>Potřebuji přepravit vozidlo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={openCapacityFlow}>
            <Text style={styles.actionTitle}>Volná kapacita</Text>
            <Text style={styles.muted}>Mám volné místo na trase</Text>
          </TouchableOpacity>
        </ScrollView>
        <BottomNavigation />
      </SafeAreaView>
    );
  }

  if (screen === "sos") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="SOS" />
        <View style={styles.appContent}>
          <Text style={styles.bigTitle}>SOS</Text>
          <Text style={styles.muted}>SOS pomoc bude dostupná v další verzi RoadLinku.</Text>
        </View>
        <BottomNavigation />
      </SafeAreaView>
    );
  }

  if (screen === "role") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.form}>
          <Text style={styles.logo}>RoadLink</Text>
          <Text style={styles.bigTitle}>Jak chcete RoadLink používat?</Text>
          <TouchableOpacity style={styles.roleCard} onPress={() => goHome("customer")}>
            <Text style={styles.roleIcon}>🚗</Text>
            <View><Text style={styles.roleTitle}>Potřebuji odtah</Text><Text style={styles.muted}>Objednat pomoc na místě</Text></View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.roleCard} onPress={() => goHome("driver")}>
            <Text style={styles.roleIcon}>🚛</Text>
            <View><Text style={styles.roleTitle}>Jsem odtahovka</Text><Text style={styles.muted}>Přijímat a vozit zakázky</Text></View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
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
          <TouchableOpacity onPress={() => setScreen("overview")}>
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
                    <Text style={styles.profileFieldValue}>{carrierProfile.phone_public || "Neuvedeno"}</Text>
                    <Text style={styles.profileFieldLabel}>Veřejný e-mail</Text>
                    <Text style={styles.profileFieldValue}>{carrierProfile.email_public || "Neuvedeno"}</Text>
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
          <TouchableOpacity style={styles.profileLinkCard} onPress={() => setScreen("welcome")}>
            <Text style={styles.profileLinkTitle}>Zobrazit úvodní obrazovku</Text>
            <Text style={styles.profileLinkText}>Otevřít veřejný úvod bez odhlášení</Text>
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
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Nová poptávka" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.requestContent} keyboardShouldPersistTaps="handled">
          <View style={styles.stepHeader}>
            <Text style={styles.stepCounter}>Krok {Math.min(requestStep, 3)} z 3</Text>
            <Text style={styles.stepTitle}>{requestStep === 1 ? "Vozidlo" : requestStep === 2 ? "Trasa a čas" : requestStep === 3 ? "Detaily" : "Kontrola"}</Text>
            <View style={styles.stepRule} />
          </View>

          <View style={styles.requestProgressLine}>
            {[1, 2, 3].map((step) => (
              <View key={step} style={[styles.requestProgressSegment, requestStep >= step && styles.requestProgressSegmentActive]} />
            ))}
          </View>

          {requestStep === 1 ? (
            <View style={styles.requestPanelFlat}>
              <Text style={styles.formSectionLabel}>Typ vozidla</Text>
              <View style={styles.chipGrid}>
                {["Osobní automobil", "SUV / 4x4", "Motocykl", "Dodávka", "Užitkové", "Ostatní"].map((value) => (
                  <TouchableOpacity key={value} style={[styles.selectChip, vehicle === value && styles.selectChipActive]} onPress={() => setVehicle(value)}>
                    <Text style={[styles.selectChipText, vehicle === value && styles.selectChipTextActive]}>{value}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.formSectionLabel}>Pojízdnost</Text>
              <View style={styles.chipGrid}>
                {[
                  ["Ano", "drivable"],
                  ["Ne", "not_drivable"],
                  ["Nevím", "unknown"],
                ].map(([label, value]) => (
                  <TouchableOpacity key={value} style={[styles.selectChip, vehicleMobility === value && styles.selectChipActive]} onPress={() => setVehicleMobility(value as VehicleMobility)}>
                    <Text style={[styles.selectChipText, vehicleMobility === value && styles.selectChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {vehicleMobility === "not_drivable" ? (
                <Text style={styles.requestHint}>Nakládkové požadavky doplňte do poznámky. Stav se ukládá přes existující vehicle_mobility.</Text>
              ) : null}
            </View>
          ) : null}

          {requestStep === 2 ? (
            <View style={styles.requestPanelFlat}>
              <Text style={styles.formSectionLabel}>Trasa</Text>
              <TextInput style={styles.compactInput} value={pickupText} onChangeText={setPickupText} placeholder="Místo vyzvednutí" />
              <TextInput style={styles.compactInput} value={destination} onChangeText={setDestination} placeholder="Cíl přepravy" />
              <TouchableOpacity style={styles.inlineSecondary} onPress={requestLocation}>
                <Text style={styles.secondaryText}>⌖ Použít aktuální polohu</Text>
              </TouchableOpacity>

              <Text style={styles.formSectionLabel}>Čas přepravy</Text>
              <View style={styles.chipGrid}>
                {[
                  ["Co nejdříve", "asap"],
                  ["Do 24 h", "within_24h"],
                  ["Do 3 dnů", "within_3_days"],
                  ["Konkrétní čas", "specific"],
                ].map(([label, value]) => (
                  <TouchableOpacity key={value} style={[styles.selectChip, timePreference === value && styles.selectChipActive]} onPress={() => setTimePreference(value as TimePreference)}>
                    <Text style={[styles.selectChipText, timePreference === value && styles.selectChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {timePreference === "specific" ? (
                <View style={styles.inlinePickerRow}>
                  <TouchableOpacity style={[styles.inlineSecondary, styles.inlinePicker]} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.secondaryText}>{requestedDate ? requestedDate.toLocaleDateString("cs-CZ") : "Vybrat datum"}</Text>
                  </TouchableOpacity>
                  {showDatePicker ? (
                    <DateTimePicker
                      value={requestedDate || new Date()}
                      mode="date"
                      display="default"
                      onChange={(event: DateTimePickerEvent, date?: Date) => {
                        setShowDatePicker(false);
                        if (event.type === "set" && date) setRequestedDate(date);
                      }}
                    />
                  ) : null}
                  <TouchableOpacity style={[styles.inlineSecondary, styles.inlinePicker]} onPress={() => setShowTimePicker(true)}>
                    <Text style={styles.secondaryText}>{requestedTime ? formatPostgresTime(requestedTime).slice(0, 5) : "Vybrat čas"}</Text>
                  </TouchableOpacity>
                  {showTimePicker ? (
                    <DateTimePicker
                      value={requestedTime || new Date()}
                      mode="time"
                      display="default"
                      onChange={(event: DateTimePickerEvent, date?: Date) => {
                        setShowTimePicker(false);
                        if (event.type === "set" && date) setRequestedTime(date);
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
              <Text style={styles.requestHint}>Vzdálenost v km se nezadává ručně.</Text>
            </View>
          ) : null}

          {requestStep === 3 ? (
            <View style={styles.requestPanelFlat}>
              <Text style={styles.formSectionLabel}>Detaily přepravy</Text>
              <TextInput style={[styles.compactInput, styles.multilineInput]} value={problem} onChangeText={setProblem} placeholder="Poznámka, stav vozidla, specifika nakládky" multiline />
              <View style={styles.pricePrincipleBox}>
                <Text style={styles.pricePrincipleTitle}>Cena</Text>
                <Text style={styles.muted}>Chci získat nabídky přepravců.</Text>
              </View>
            </View>
          ) : null}

          {requestStep === 4 ? (
            <View style={styles.requestPanelFlat}>
              <Text style={styles.formSectionLabel}>Souhrn</Text>
              <View style={styles.summaryLine}><Text style={styles.summaryLabel}>VOZIDLO</Text><Text style={styles.summaryValue}>{vehicle} · {vehicleMobilityLabel(vehicleMobility)}</Text></View>
              <View style={styles.summaryLine}><Text style={styles.summaryLabel}>TRASA</Text><Text style={styles.summaryValue}>{pickupText || "Místo vyzvednutí neuvedeno"} → {destination || "Cíl neuveden"}</Text></View>
              <View style={styles.summaryLine}><Text style={styles.summaryLabel}>TERMÍN</Text><Text style={styles.summaryValue}>{requestTimingLabel({ id: "preview", customerName: "", vehicle, problem, pickup: null, pickupAddress: pickupText.trim() || null, destination, status: "open", timePreference, requestedDate: requestedDate ? formatPostgresDate(requestedDate) : null, requestedTime: requestedTime ? formatPostgresTime(requestedTime) : null, vehicleMobility })}</Text></View>
              <View style={styles.summaryLine}><Text style={styles.summaryLabel}>DETAILY</Text><Text style={styles.summaryValue}>{problem || "Bez poznámky"}</Text></View>
              <TouchableOpacity style={styles.primary} onPress={createJob}>
                <Text style={styles.primaryText}>ODESLAT POPTÁVKU</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.requestNavRowSplit}>
            <TouchableOpacity style={[styles.secondary, styles.requestNavButton]} onPress={goToPreviousRequestStep}>
              <Text style={styles.secondaryText}>Zpět</Text>
            </TouchableOpacity>
            {requestStep < 4 ? (
              <TouchableOpacity style={[styles.primary, styles.requestNavButton]} onPress={requestStep === 3 ? () => { if (validateRequestStep(requestStep)) setRequestStep(4); } : goToNextRequestStep}>
                <Text style={styles.primaryText}>{requestStep === 3 ? "Zkontrolovat" : "Pokračovat"}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "requestSuccess") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Poptávka odeslána" />
        <View style={styles.requestSuccessContent}>
          <Text style={styles.successMark}>✓</Text>
          <Text style={styles.bigTitle}>POPTÁVKA ODESLÁNA</Text>
          <Text style={styles.muted}>Poptávka byla zveřejněna.{"\n"}Nyní můžete dostávat cenové nabídky přepravců.</Text>
          <TouchableOpacity style={styles.primary} onPress={openMyRequestsAfterSuccess}>
            <Text style={styles.primaryText}>ZOBRAZIT MOJE POPTÁVKY</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
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
        <Header title="Nová trasa" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Odkud</Text>
          <TextInput style={styles.input} value={routeFrom} onChangeText={setRouteFrom} placeholder="Místo odjezdu" />
          <Text style={styles.label}>Kam</Text>
          <TextInput style={styles.input} value={routeTo} onChangeText={setRouteTo} placeholder="Cíl trasy" />
          <Text style={styles.label}>Datum a čas odjezdu</Text>
          <TextInput style={styles.input} value={routeDeparture} onChangeText={setRouteDeparture} placeholder="Např. 2026-09-04 14:00" />
          <Text style={styles.label}>Počet volných míst</Text>
          <TextInput style={styles.input} value={routeSpaces} onChangeText={setRouteSpaces} placeholder="Počet míst" keyboardType="numeric" />
          <Text style={styles.label}>Maximální odchylka od trasy (volitelné) · km</Text>
          <TextInput style={styles.input} value={routeMaxDeviationKm} onChangeText={setRouteMaxDeviationKm} placeholder="Odchylka v km" keyboardType="numeric" accessibilityLabel="Maximální odchylka od trasy v km" />
          <Text style={styles.label}>Typ vozidla</Text>
          <TextInput style={styles.input} value={routeVehicleTypes} onChangeText={setRouteVehicleTypes} placeholder="Typ vozidla" />
          <Text style={styles.label}>Cena</Text>
          <View style={styles.chips}>
            <TouchableOpacity
              style={[styles.chip, routePriceMode === "fixed" && styles.chipActive]}
              onPress={() => setRoutePriceMode("fixed")}
            >
              <Text>Pevná cena</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, routePriceMode === "negotiable" && styles.chipActive]}
              onPress={() => setRoutePriceMode("negotiable")}
            >
              <Text>Cena dohodou</Text>
            </TouchableOpacity>
          </View>
          <TextInput style={styles.input} value={routePrice} onChangeText={setRoutePrice} placeholder="Cena v Kč" keyboardType="numeric" />
          <Text style={styles.label}>Poznámka</Text>
          <TextInput style={styles.input} value={routeDescription} onChangeText={setRouteDescription} placeholder="Doplňující informace" multiline />
          <TouchableOpacity style={styles.primary} onPress={createRoute}>
            <Text style={styles.primaryText}>Vytvořit nabídku trasy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => { setTransportTab("capacity"); setScreen("transport"); }}>
            <Text style={styles.secondaryText}>Zpět na přepravu</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customerActionRowSubtle} onPress={() => setScreen("profile")}>
            <Text style={styles.customerActionTextSubtle}>← Zpět na profil</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "tracking") {
    if (!activeJob) return null;
    const selectedOffer = selectedOfferForActiveJob();
    const canDriverUpdateTransport = Boolean(selectedOffer && selectedOffer.driver_id === userId);

    return (
      <SafeAreaView style={styles.container}>
        <Header title="Řízení přepravy" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.requestDetailContent} keyboardShouldPersistTaps="handled">
          <View style={styles.detailTopRow}>
            <View>
              <Text style={styles.sectionLabel}>PŘEPRAVA</Text>
              <Text style={styles.detailHeroTitle}>{transportLifecycleStatusLabel(activeJob.status)}</Text>
            </View>
            <Text style={styles.statusPill}>{transportLifecycleStatusLabel(activeJob.status)}</Text>
          </View>
          <Text style={[styles.detailMuted, styles.transportLead]}>{transportLifecycleMessage(activeJob.status)}</Text>

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>TRASA</Text>
            <Text style={styles.routeEndpoint}>Vyzvednutí {pickupDisplayLabel(activeJob)}</Text>
            <Text style={styles.routeArrowDown}>↓</Text>
            <Text style={styles.routeEndpoint}>{activeJob.destination}</Text>
          </View>

          <View style={styles.detailTwoColumnRow}>
            <View style={styles.detailMiniSection}>
              <Text style={styles.sectionLabel}>VOZIDLO</Text>
              <Text style={styles.detailValueStrong}>{activeJob.vehicle}</Text>
              <Text style={styles.detailMuted}>{vehicleMobilityLabel(activeJob.vehicleMobility)}</Text>
            </View>
            <View style={styles.detailMiniSection}>
              <Text style={styles.sectionLabel}>TERMÍN</Text>
              <Text style={styles.detailValueStrong}>{requestTimingLabel(activeJob)}</Text>
            </View>
          </View>

          {selectedOffer ? (
            <View style={styles.offerRowCard}>
              <Text style={styles.sectionLabel}>CENOVÁ NABÍDKA</Text>
              <Text style={styles.offerPriceCompact}>
                {selectedOffer.price === null ? "Cena dohodou" : `${selectedOffer.price.toLocaleString("cs-CZ")} Kč`}
              </Text>
              {selectedOffer.estimated_arrival_minutes ? <Text style={styles.detailMuted}>Příjezd: {selectedOffer.estimated_arrival_minutes} min</Text> : null}
              {selectedOffer.estimated_arrival_at ? <Text style={styles.detailMuted}>Příjezd: {formatOfferArrivalDateTime(selectedOffer.estimated_arrival_at)}</Text> : null}
              {selectedOffer.message ? <Text style={styles.detailValue}>Zpráva přepravce: {selectedOffer.message}</Text> : null}
            </View>
          ) : null}

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>STAV</Text>
            <Text style={styles.detailValueStrong}>● {transportLifecycleStatusLabel(activeJob.status)}</Text>
          </View>

          {canDriverUpdateTransport && activeJob.status === "offer_selected" ? (
            <TouchableOpacity style={styles.primary} disabled={transportStatusLoading} onPress={() => updateTransportStatus("in_progress")}>
              <Text style={styles.primaryText}>{transportStatusLoading ? "Ukládám…" : "ZAHÁJIT PŘEPRAVU"}</Text>
            </TouchableOpacity>
          ) : null}

          {canDriverUpdateTransport && activeJob.status === "in_progress" ? (
            <TouchableOpacity style={styles.primary} disabled={transportStatusLoading} onPress={() => updateTransportStatus("completed")}>
              <Text style={styles.primaryText}>{transportStatusLoading ? "Ukládám…" : "OZNAČIT JAKO DORUČENO"}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={styles.secondary} onPress={() => { setTransportTab(requestViewMode === "owner" ? "mine" : "requests"); setScreen("transport"); }}>
            <Text style={styles.secondaryText}>Zpět na přepravu</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "job" && requestViewMode === "owner") {
    if (!activeJob) return null;
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Poptávka" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.requestDetailContent} keyboardShouldPersistTaps="handled">
          <View style={styles.detailTopRow}>
            <View>
              <Text style={styles.sectionLabel}>POPTÁVKA</Text>
              <Text style={styles.detailHeroTitle}>{activeJob.vehicle}</Text>
            </View>
            <Text style={styles.statusPill}>{transportStatusLabel(activeJob.status)}</Text>
          </View>

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>TRASA</Text>
            <Text style={styles.routeEndpoint}>Vyzvednutí {pickupDisplayLabel(activeJob)}</Text>
            <Text style={styles.routeArrowDown}>↓</Text>
            <Text style={styles.routeEndpoint}>{activeJob.destination}</Text>
          </View>

          <View style={styles.detailTwoColumnRow}>
            <View style={styles.detailMiniSection}>
              <Text style={styles.sectionLabel}>VOZIDLO</Text>
              <Text style={styles.detailValueStrong}>{activeJob.vehicle} · {vehicleMobilityLabel(activeJob.vehicleMobility)}</Text>
            </View>
            <View style={styles.detailMiniSection}>
              <Text style={styles.sectionLabel}>TERMÍN</Text>
              <Text style={styles.detailValueStrong}>{requestTimingLabel(activeJob)}</Text>
            </View>
          </View>

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>DETAILY</Text>
            <Text style={styles.detailValue}>{activeJob.problem || "Bez poznámky"}</Text>
          </View>

          <View style={styles.offerHeaderStrip}>
            <Text style={styles.sectionLabel}>CENOVÉ NABÍDKY</Text>
            <TouchableOpacity style={styles.refreshButton} onPress={loadOffers}>
              <Text style={styles.refreshButtonText}>Obnovit</Text>
            </TouchableOpacity>
          </View>

          {offersLoading ? (
            <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Načítám cenové nabídky…</Text></View>
          ) : offers.length === 0 ? (
            <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>Zatím nemáte žádné cenové nabídky.</Text></View>
          ) : (
            offers.map((offer) => (
              <View key={offer.id} style={styles.offerRowCard}>
                <View style={styles.dispatchHeader}>
                  <Text style={styles.dispatchLabel}>CENOVÁ NABÍDKA</Text>
                  <Text style={styles.statusPill}>{offerStatusLabel(offer.status)}</Text>
                </View>
                <Text style={styles.sectionLabel}>PŘEPRAVCE</Text>
                <Text style={styles.detailValueStrong}>{providerNameForOffer(offer)}</Text>
                <Text style={styles.offerPriceCompact}>{offer.price === null ? "Cena dohodou" : `${offer.price.toLocaleString("cs-CZ")} Kč`}</Text>
                {offer.estimated_arrival_minutes ? <Text style={styles.detailMuted}>Příjezd: {offer.estimated_arrival_minutes} min</Text> : null}
                {offer.estimated_arrival_at ? <Text style={styles.detailMuted}>Příjezd: {formatOfferArrivalDateTime(offer.estimated_arrival_at)}</Text> : null}
                {offer.message ? <Text style={styles.detailValue}>Zpráva přepravce: {offer.message}</Text> : null}
                {activeJob.status === "open" && offer.status === "pending" ? (
                  <TouchableOpacity style={styles.primary} disabled={selectingOfferId !== null} onPress={() => confirmSelectOffer(offer)}>
                    <Text style={styles.primaryText}>{selectingOfferId === offer.id ? "Vybírám…" : "VYBRAT PŘEPRAVCE"}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          )}

          {(activeJob.status === "offer_selected" || activeJob.status === "in_progress" || activeJob.status === "completed") ? (
            <View style={styles.detailSectionFlat}>
              <Text style={styles.sectionLabel}>PŘEPRAVA</Text>
              <Text style={styles.detailValue}>{transportLifecycleMessage(activeJob.status)}</Text>
              <TouchableOpacity style={styles.primary} onPress={() => setScreen("tracking")}>
                <Text style={styles.primaryText}>PŘEJÍT K PŘEPRAVĚ</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity style={styles.secondary} onPress={() => { setTransportTab("mine"); setScreen("transport"); }}>
            <Text style={styles.secondaryText}>Zpět na moje poptávky</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "job") {
    if (!activeJob) return null;
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Detail poptávky" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.requestDetailContent} keyboardShouldPersistTaps="handled">
          <View style={styles.detailTopRow}>
            <View>
              <Text style={styles.sectionLabel}>POPTÁVKA</Text>
              <Text style={styles.detailHeroTitle}>{activeJob.vehicle}</Text>
            </View>
            <Text style={styles.statusPill}>{transportStatusLabel(activeJob.status)}</Text>
          </View>

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>TRASA</Text>
            <Text style={styles.routeEndpoint}>Vyzvednutí {pickupDisplayLabel(activeJob)}</Text>
            <Text style={styles.routeArrowDown}>↓</Text>
            <Text style={styles.routeEndpoint}>{activeJob.destination}</Text>
          </View>

          <View style={styles.detailTwoColumnRow}>
            <View style={styles.detailMiniSection}>
              <Text style={styles.sectionLabel}>VOZIDLO</Text>
              <Text style={styles.detailValueStrong}>{activeJob.vehicle} · {vehicleMobilityLabel(activeJob.vehicleMobility)}</Text>
            </View>
            <View style={styles.detailMiniSection}>
              <Text style={styles.sectionLabel}>TERMÍN</Text>
              <Text style={styles.detailValueStrong}>{requestTimingLabel(activeJob)}</Text>
            </View>
          </View>

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>DETAILY</Text>
            <Text style={styles.detailValue}>{activeJob.problem || "Bez poznámky"}</Text>
          </View>

          {activeJob.status === "offer_selected" &&
          activeAcceptedJob?.id === activeJob.id &&
          activeAcceptedJob.acceptedOffer.driver_id === userId &&
          activeAcceptedJob.acceptedOffer.tow_request_id === activeJob.id ? (
            <View style={styles.offerRowCard}>
              <Text style={styles.sectionLabel}>VAŠE NABÍDKA BYLA PŘIJATA</Text>
              <Text style={styles.offerPriceCompact}>
                {activeAcceptedJob.acceptedOffer.price === null
                  ? "Cena dohodou"
                  : `${activeAcceptedJob.acceptedOffer.price.toLocaleString("cs-CZ")} Kč`}
              </Text>
            </View>
          ) : null}

          <View style={styles.detailSectionFlat}>
            <Text style={styles.sectionLabel}>AKCE</Text>
            {activeJob.status === "open" ? (
              <>
                <Text style={styles.detailMuted}>Pošlete zákazníkovi svou cenu a dostupné informace k příjezdu.</Text>
                <TouchableOpacity style={styles.primary} onPress={() => setScreen("offerForm")}>
                  <Text style={styles.primaryText}>NABÍDNOUT CENU</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.detailMuted}>Stav poptávky: {transportLifecycleStatusLabel(activeJob.status)}</Text>
                {(activeJob.status === "offer_selected" || activeJob.status === "in_progress" || activeJob.status === "completed") ? (
                  <TouchableOpacity style={styles.primary} onPress={() => setScreen("tracking")}>
                    <Text style={styles.primaryText}>PŘEJÍT K PŘEPRAVĚ</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>

          <TouchableOpacity style={styles.secondary} onPress={() => { setTransportTab("requests"); setScreen("transport"); }}>
            <Text style={styles.secondaryText}>Zpět na přepravu</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
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

function formatSupabaseError(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}) {
  return [error.message, error.code && `Kód: ${error.code}`, error.details && `Detaily: ${error.details}`, error.hint && `Nápověda: ${error.hint}`]
    .filter(Boolean)
    .join("\n");
}

function pickupDisplayLabel(job: Job) {
  if (job.pickupAddress?.trim()) return job.pickupAddress.trim();
  if (job.pickup) return `${job.pickup.latitude.toFixed(5)}, ${job.pickup.longitude.toFixed(5)}`;
  return "Místo vyzvednutí neuvedeno";
}

function routeDisplayLabel(job: Job) {
  return `Vyzvednutí ${pickupDisplayLabel(job)}  →  ${job.destination}`;
}

function requestTimingLabel(job: Job) {
  if (job.timePreference === "specific" && job.requestedDate) {
    const date = formatDate(job.requestedDate);
    const time = formatTime(job.requestedTime);
    return time ? `${date}, ${time}` : date || "Konkrétní termín";
  }
  return timePreferenceLabel(job.timePreference);
}

function offerCountLabel(count: number) {
  if (count === 1) return "1 cenová nabídka";
  if (count >= 2 && count <= 4) return `${count} cenové nabídky`;
  return `${count} cenových nabídek`;
}

function timePreferenceLabel(preference?: TimePreference) {
  switch (preference) {
    case "asap": return "Co nejdříve";
    case "within_24h": return "Do 24 hodin";
    case "within_3_days": return "Do 3 dnů";
    case "within_week": return "Do týdne";
    case "specific": return "Konkrétní termín";
    default: return "Co nejdříve";
  }
}

function vehicleMobilityLabel(mobility?: VehicleMobility) {
  switch (mobility) {
    case "drivable": return "Samo najede na vlek";
    case "partially_drivable": return "Jede, ale má problém";
    case "not_drivable": return "Nenajede na vlek – nutný naviják";
    case "unknown": return "Stav vozidla není jistý";
    default: return "Stav vozidla není jistý";
  }
}

function offerStatusLabel(status: TowOffer["status"]) {
  switch (status) {
    case "pending": return "Čeká na rozhodnutí";
    case "accepted": return "Přijato";
    case "rejected": return "Odmítnuto";
    case "withdrawn": return "Staženo";
  }
}

function formatDate(date: string | null | undefined) {
  if (!date) return null;
  const [year, month, day] = date.slice(0, 10).split("-");
  return `${Number(day)}. ${Number(month)}. ${year}`;
}

function formatTime(time: string | null | undefined) {
  return time ? time.slice(0, 5) : null;
}

function formatOfferArrivalDateTime(value: string | null | undefined) {
  if (!value) return "Čas příjezdu neuveden";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Čas příjezdu neuveden";

  return `${date.toLocaleDateString("cs-CZ")} v ${date.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatPostgresDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPostgresTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}:00`;
}

function statusLabel(status?: JobStatus) {
  switch (status) {
    case "open": return "🔎 Otevřená poptávka";
    case "offer_selected": return "✓ Přepravce vybrán";
    case "in_progress": return "🚛 Přeprava probíhá";
    case "completed": return "✓ Odtah dokončen";
    default: return "Čekáme na stav";
  }
}

function transportStatusLabel(status?: JobStatus) {
  switch (status) {
    case "open": return "Otevřená";
    case "offer_selected": return "Vybrán přepravce";
    case "in_progress": return "Probíhá";
    case "completed": return "Dokončeno";
    case "cancelled": return "Zrušeno";
    default: return "Neznámý stav";
  }
}

function transportLifecycleStatusLabel(status?: JobStatus) {
  switch (status) {
    case "offer_selected": return "Potvrzeno";
    case "in_progress": return "Přeprava probíhá";
    case "completed": return "Dokončeno";
    case "cancelled": return "Zrušeno";
    default: return transportStatusLabel(status);
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DESIGN.colors.background },
  hero: { height: "48%", backgroundColor: DESIGN.colors.primarySoft },
  heroImage: { width: "100%", height: "100%" },
  heroFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroEmoji: { fontSize: 90 },
  welcomeBody: { flex: 1, padding: 26, alignItems: "center" },
  brand: { fontSize: 42, fontWeight: "800", marginTop: 5, color: DESIGN.colors.textPrimary },
  tagline: { fontSize: 16, color: DESIGN.colors.textSecondary, marginTop: 8, marginBottom: 28, textAlign: "center" },
  introScroll: { paddingBottom: 24, backgroundColor: DESIGN.colors.background },
  introHero: { height: 300, backgroundColor: DESIGN.colors.primarySoft },
  introPanel: {
    marginTop: -24,
    padding: 22,
    paddingTop: 28,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    backgroundColor: DESIGN.colors.surface,
  },
  introClaim: { color: DESIGN.colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: "800", textAlign: "center", marginBottom: 24 },
  benefitRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  benefitItem: { width: "31%", alignItems: "center", paddingVertical: 12, borderRadius: 16, backgroundColor: DESIGN.colors.background },
  benefitIcon: { color: DESIGN.colors.primary, fontSize: 22, fontWeight: "800", marginBottom: 6 },
  benefitText: { color: DESIGN.colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  introTransport: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: 18, borderRadius: 19, backgroundColor: DESIGN.colors.textPrimary, shadowColor: DESIGN.colors.textPrimary, shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  transportText: { flex: 1, color: DESIGN.colors.surface, fontSize: 18, fontWeight: "700" },
  introServiceRow: { minHeight: 62, flexDirection: "row", alignItems: "center", marginTop: 12, paddingHorizontal: 18, borderWidth: 1, borderColor: "#dce3ea", borderRadius: 19, backgroundColor: DESIGN.colors.surface },
  serviceIcon: { width: 34, fontSize: 22, textAlign: "left" },
  serviceText: { flex: 1, color: DESIGN.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  serviceArrow: { color: DESIGN.colors.textSecondary, fontSize: 28, lineHeight: 28 },
  introLogin: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 22 },
  introLoginText: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "700" },
  introSignup: { alignItems: "center", paddingVertical: 10 },
  introSignupText: { color: DESIGN.colors.primary, fontSize: 14, fontWeight: "700" },
  headerSafeArea: { backgroundColor: DESIGN.colors.surface, paddingTop: Platform.OS === "android" ? NativeStatusBar.currentHeight || 0 : 0 },
  header: { paddingHorizontal: DESIGN.spacing.xl, paddingTop: DESIGN.spacing.md, paddingBottom: DESIGN.spacing.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: DESIGN.colors.surface, borderBottomWidth: 1, borderBottomColor: DESIGN.colors.border },
  logo: { fontSize: 12, fontWeight: "800", color: DESIGN.colors.primary, letterSpacing: 1.6 },
  headerTitle: { color: DESIGN.colors.textPrimary, fontSize: 24, fontWeight: "800", marginTop: DESIGN.spacing.xs },
  headerIconButton: { width: 32, height: 32, borderRadius: DESIGN.radius.medium, borderWidth: 1, borderColor: DESIGN.colors.border, alignItems: "center", justifyContent: "center", backgroundColor: DESIGN.colors.surface },
  headerSignOut: { color: DESIGN.colors.textSecondary, fontWeight: "800", fontSize: 15 },
  form: { padding: DESIGN.spacing.xxl, gap: DESIGN.spacing.md },
  registrationContent: { padding: DESIGN.spacing.xxl, paddingBottom: 40 },
  content: { padding: DESIGN.spacing.xl, paddingBottom: 40 },
  requestContent: { padding: DESIGN.spacing.xl, paddingTop: DESIGN.spacing.md, paddingBottom: 40, backgroundColor: DESIGN.colors.background },
  stepHeader: { marginBottom: DESIGN.spacing.md },
  stepCounter: { color: DESIGN.colors.textSecondary, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  stepTitle: { color: DESIGN.colors.textPrimary, fontSize: 26, fontWeight: "800" },
  stepRule: { height: 2, width: 76, borderRadius: 2, backgroundColor: DESIGN.colors.primary, marginTop: DESIGN.spacing.md },
  requestProgressLine: { flexDirection: "row", gap: 6, marginBottom: DESIGN.spacing.xl },
  requestProgressSegment: { flex: 1, height: 3, borderRadius: 3, backgroundColor: DESIGN.colors.border },
  requestProgressSegmentActive: { backgroundColor: DESIGN.colors.primary },
  requestProgress: { flexDirection: "row", justifyContent: "space-between", marginBottom: DESIGN.spacing.lg },
  requestProgressItem: { flex: 1, alignItems: "center" },
  requestProgressDot: { width: 28, height: 28, borderRadius: DESIGN.radius.large, borderWidth: 1, borderColor: DESIGN.colors.border, alignItems: "center", justifyContent: "center", backgroundColor: DESIGN.colors.surface },
  requestProgressDotActive: { backgroundColor: DESIGN.colors.primary, borderColor: DESIGN.colors.primary },
  requestProgressNumber: { color: DESIGN.colors.textSecondary, fontSize: 12, fontWeight: "800" },
  requestProgressNumberActive: { color: DESIGN.colors.surface },
  requestProgressLabel: { color: DESIGN.colors.textSecondary, fontSize: 11, fontWeight: "700", marginTop: DESIGN.spacing.xs, textAlign: "center" },
  requestProgressLabelActive: { color: DESIGN.colors.textPrimary },
  requestPanel: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, backgroundColor: DESIGN.colors.surface },
  requestPanelFlat: { borderTopWidth: 1, borderTopColor: DESIGN.colors.border, paddingTop: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.lg },
  formSectionLabel: { color: DESIGN.colors.textPrimary, fontSize: 13, fontWeight: "800", marginBottom: DESIGN.spacing.sm, marginTop: DESIGN.spacing.md },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: DESIGN.spacing.sm, marginBottom: DESIGN.spacing.md },
  selectChip: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, paddingHorizontal: DESIGN.spacing.md, paddingVertical: 9, backgroundColor: DESIGN.colors.surface },
  selectChipActive: { borderColor: DESIGN.colors.primary, backgroundColor: DESIGN.colors.primary },
  selectChipText: { color: DESIGN.colors.textPrimary, fontSize: 13, fontWeight: "600" },
  selectChipTextActive: { color: DESIGN.colors.surface },
  compactInput: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, paddingHorizontal: DESIGN.spacing.md, paddingVertical: 10, fontSize: 14, color: DESIGN.colors.textPrimary, backgroundColor: DESIGN.colors.surface, marginBottom: DESIGN.spacing.sm },
  inlineSecondary: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, paddingHorizontal: DESIGN.spacing.md, paddingVertical: 10, alignItems: "center", backgroundColor: DESIGN.colors.surface, marginBottom: DESIGN.spacing.sm },
  inlinePickerRow: { flexDirection: "row", gap: DESIGN.spacing.sm, marginTop: DESIGN.spacing.sm },
  inlinePicker: { flex: 1 },
  requestHint: { color: DESIGN.colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: DESIGN.spacing.md },
  requestNavRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  requestNavRowSplit: { flexDirection: "row", gap: DESIGN.spacing.md, marginTop: DESIGN.spacing.md },
  requestNavButton: { flex: 1 },
  pricePrincipleBox: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, padding: DESIGN.spacing.lg, marginTop: DESIGN.spacing.lg, backgroundColor: DESIGN.colors.background },
  pricePrincipleTitle: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "800" },
  summaryLabel: { color: DESIGN.colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginTop: DESIGN.spacing.lg },
  summaryValue: { color: DESIGN.colors.textPrimary, fontSize: 15, lineHeight: 21, marginTop: 4 },
  summaryLine: { borderBottomWidth: 1, borderBottomColor: DESIGN.colors.border, paddingBottom: DESIGN.spacing.md, marginBottom: DESIGN.spacing.sm },
  requestSuccessContent: { flex: 1, padding: 28, alignItems: "center", justifyContent: "center", backgroundColor: DESIGN.colors.background },
  successMark: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", backgroundColor: DESIGN.colors.textPrimary, color: DESIGN.colors.surface, fontSize: 34, lineHeight: 54, textAlign: "center", marginBottom: 18 },
  requestDetailContent: { padding: DESIGN.spacing.xl, paddingTop: DESIGN.spacing.md, paddingBottom: 40, backgroundColor: DESIGN.colors.background },
  detailTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: DESIGN.colors.border, paddingBottom: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.lg },
  detailHeroTitle: { color: DESIGN.colors.textPrimary, fontSize: 24, fontWeight: "800", lineHeight: 30 },
  detailSectionFlat: { borderBottomWidth: 1, borderBottomColor: DESIGN.colors.border, paddingBottom: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.lg },
  detailTwoColumnRow: { flexDirection: "row", gap: DESIGN.spacing.md, marginBottom: DESIGN.spacing.lg },
  detailMiniSection: { flex: 1, borderBottomWidth: 1, borderBottomColor: DESIGN.colors.border, paddingBottom: DESIGN.spacing.md },
  detailValueStrong: { color: DESIGN.colors.textPrimary, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  routeEndpoint: { color: DESIGN.colors.textPrimary, fontSize: 17, fontWeight: "700", lineHeight: 23 },
  routeArrowDown: { color: DESIGN.colors.textSecondary, fontSize: 18, marginVertical: DESIGN.spacing.xs },
  offerHeaderStrip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: DESIGN.spacing.sm, marginBottom: DESIGN.spacing.sm },
  offerRowCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, padding: DESIGN.spacing.md, marginBottom: DESIGN.spacing.sm, backgroundColor: DESIGN.colors.surface },
  requestDetailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  requestDetailStatus: { color: DESIGN.colors.textPrimary, fontSize: 13, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: DESIGN.colors.primarySoft, overflow: "hidden" },
  detailSectionCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, padding: 14, marginBottom: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface, shadowColor: DESIGN.colors.primaryDark, shadowOpacity: 0.03, shadowRadius: 5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  detailSectionTitle: { color: DESIGN.colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8 },
  detailPrimary: { color: DESIGN.colors.textPrimary, fontSize: 18, fontWeight: "800" },
  detailLabel: { color: DESIGN.colors.textSecondary, fontSize: 12, fontWeight: "800", marginTop: 8 },
  detailValue: { color: DESIGN.colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 3 },
  transportLead: { marginTop: -DESIGN.spacing.sm, marginBottom: DESIGN.spacing.lg },
  detailMuted: { color: DESIGN.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  offerCardCompact: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, padding: 14, marginBottom: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface, shadowColor: DESIGN.colors.primaryDark, shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  offerPriceCompact: { color: DESIGN.colors.textPrimary, fontSize: 17, fontWeight: "800", marginBottom: 4 },
  appContent: { padding: DESIGN.spacing.xl, paddingTop: DESIGN.spacing.lg, paddingBottom: 96, backgroundColor: DESIGN.colors.background },
  shellEyebrow: { color: DESIGN.colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.1, marginBottom: DESIGN.spacing.sm },
  dashboardPanel: { gap: DESIGN.spacing.sm, marginBottom: DESIGN.spacing.xl },
  actionRow: { minHeight: 72, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, paddingHorizontal: DESIGN.spacing.md, paddingVertical: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface, shadowColor: DESIGN.colors.primaryDark, shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  actionIcon: { width: 36, height: 36, borderRadius: 12, overflow: "hidden", backgroundColor: DESIGN.colors.background, color: DESIGN.colors.primary, fontSize: 18, lineHeight: 34, textAlign: "center", marginRight: DESIGN.spacing.md, fontWeight: "800" },
  actionBody: { flex: 1 },
  actionSubtitle: { color: DESIGN.colors.textSecondary, fontSize: 13, marginTop: 3 },
  actionChevron: { color: DESIGN.colors.textSecondary, fontSize: 24, lineHeight: 24, marginLeft: DESIGN.spacing.sm },
  dashboardSection: { marginTop: DESIGN.spacing.lg },
  sectionLabel: { color: DESIGN.colors.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: DESIGN.spacing.sm, textTransform: "uppercase" },
  emptyPanel: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, backgroundColor: DESIGN.colors.surface },
  emptyPanelCompact: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface },
  emptyTitle: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "700" },
  emptyCopy: { color: DESIGN.colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  dashboardGrid: { gap: DESIGN.spacing.md, marginTop: DESIGN.spacing.xl },
  infoTile: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, backgroundColor: DESIGN.colors.surface },
  infoTileTitle: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  dispatchRow: { flexDirection: "row", alignItems: "center", gap: DESIGN.spacing.md, borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface },
  dispatchMain: { flex: 1 },
  actionCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, marginTop: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface, shadowColor: DESIGN.colors.primaryDark, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  actionTitle: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "700" },
  transportSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.sm },
  transportFilterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: DESIGN.spacing.sm },
  transportCount: { color: DESIGN.colors.textSecondary, fontSize: 12, fontWeight: "800" },
  segmentedBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: DESIGN.colors.border, marginBottom: DESIGN.spacing.lg },
  segmentedItem: { paddingRight: DESIGN.spacing.lg, paddingVertical: DESIGN.spacing.sm, alignItems: "flex-start" },
  segmentedText: { color: DESIGN.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  segmentedTextActive: { color: DESIGN.colors.textPrimary, fontWeight: "800" },
  segmentedUnderline: { height: 2, width: "100%", backgroundColor: DESIGN.colors.primary, marginTop: DESIGN.spacing.sm, borderRadius: 2 },
  dispatchCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, paddingHorizontal: DESIGN.spacing.md, paddingVertical: DESIGN.spacing.sm, marginBottom: DESIGN.spacing.sm, backgroundColor: DESIGN.colors.surface },
  dispatchHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  dispatchLabel: { color: DESIGN.colors.textSecondary, fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
  dispatchVehicle: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  dispatchRoute: { color: DESIGN.colors.textPrimary, fontSize: 14, fontWeight: "700" },
  routeLine: { color: DESIGN.colors.textPrimary, fontSize: 14, lineHeight: 19, marginTop: 4 },
  dispatchFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: DESIGN.spacing.sm },
  dispatchMeta: { color: DESIGN.colors.textSecondary, fontSize: 12, lineHeight: 17 },
  dispatchArrow: { color: DESIGN.colors.textSecondary, fontSize: 19, fontWeight: "700" },
  statusPill: { alignSelf: "flex-start", color: DESIGN.colors.primary, backgroundColor: DESIGN.colors.primarySoft, borderRadius: 999, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  transportCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, padding: 14, marginBottom: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface, shadowColor: DESIGN.colors.primaryDark, shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  transportCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  transportCardMain: { flex: 1 },
  transportEyebrow: { color: DESIGN.colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 3 },
  transportTitle: { color: DESIGN.colors.textPrimary, fontSize: 17, fontWeight: "800" },
  transportProblem: { color: "#334155", fontSize: 13, marginTop: 2 },
  transportRoute: { color: "#334155", fontSize: 13, marginTop: 8, lineHeight: 18 },
  transportMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  transportMeta: { color: DESIGN.colors.textSecondary, fontSize: 12, fontWeight: "700" },
  transportBadge: { color: DESIGN.colors.textPrimary, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  transportStatus: { color: DESIGN.colors.textPrimary, fontSize: 12, fontWeight: "800" },
  transportOfferCount: { color: DESIGN.colors.primary, fontSize: 12, fontWeight: "800", marginTop: 8, textTransform: "uppercase" },
  transportArrow: { color: DESIGN.colors.textSecondary, fontSize: 20, fontWeight: "800" },
  bottomNavSafeArea: { backgroundColor: DESIGN.colors.surface, paddingBottom: 10 },
  bottomNav: { minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: DESIGN.colors.border, paddingTop: 8, paddingBottom: 10, backgroundColor: DESIGN.colors.surface },
  bottomNavItem: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 4 },
  bottomNavIcon: { color: DESIGN.colors.textSecondary, fontSize: 23, lineHeight: 27, fontWeight: "700" },
  bottomNavText: { color: DESIGN.colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: "600" },
  bottomNavTextActive: { color: DESIGN.colors.primary },
  bottomNavSos: { color: DESIGN.colors.danger },
  bottomNavPlus: { width: 42, height: 42, borderRadius: 21, overflow: "hidden", backgroundColor: DESIGN.colors.primary, color: DESIGN.colors.surface, fontSize: 27, lineHeight: 38, textAlign: "center", marginBottom: -2 },
  profileHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  profileBack: { color: DESIGN.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  profileHeaderIcon: { color: DESIGN.colors.primary, fontSize: 24 },
  profileCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: 16, padding: 18, marginBottom: 14, backgroundColor: DESIGN.colors.surface },
  profileName: { color: DESIGN.colors.textPrimary, fontSize: 24, fontWeight: "800" },
  profileRole: { color: DESIGN.colors.textSecondary, marginTop: 5, fontWeight: "700" },
  profileFieldLabel: { color: DESIGN.colors.textSecondary, fontSize: 12, fontWeight: "800", marginTop: 12 },
  profileFieldValue: { color: DESIGN.colors.textPrimary, fontSize: 16, marginTop: 3 },
  profileLinkCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: DESIGN.colors.surface },
  profileLogoutRow: { borderWidth: 1, borderColor: "#F2D5D5", borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.md, marginTop: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.xl, backgroundColor: "#FFF7F7", alignItems: "center" },
  profileLogoutText: { color: DESIGN.colors.danger, fontSize: 14, fontWeight: "700" },
  profileLinkTitle: { color: DESIGN.colors.textPrimary, fontSize: 17, fontWeight: "800" },
  profileLinkText: { color: DESIGN.colors.textSecondary, marginTop: 5 },
  navigationSection: { marginTop: 10 },
  customerContent: { padding: 20, paddingTop: 18, paddingBottom: 32 },
  scroll: { flex: 1 },
  bigTitle: { fontSize: 24, fontWeight: "800", color: DESIGN.colors.textPrimary, marginBottom: DESIGN.spacing.sm },
  primary: { backgroundColor: DESIGN.colors.primary, borderRadius: DESIGN.radius.large, paddingVertical: DESIGN.spacing.md, paddingHorizontal: DESIGN.spacing.lg, alignItems: "center", marginTop: DESIGN.spacing.lg },
  primaryText: { color: DESIGN.colors.surface, fontSize: 14, fontWeight: "800", letterSpacing: 0.2 },
  secondary: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, paddingVertical: DESIGN.spacing.md, paddingHorizontal: DESIGN.spacing.lg, alignItems: "center", marginTop: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface },
  secondaryText: { color: DESIGN.colors.textPrimary, fontWeight: "800", fontSize: 14 },
  link: { color: DESIGN.colors.primary, fontWeight: "700", marginTop: 18 },
  input: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.medium, paddingHorizontal: DESIGN.spacing.md, paddingVertical: DESIGN.spacing.md, fontSize: 15, color: DESIGN.colors.textPrimary, backgroundColor: DESIGN.colors.surface, marginTop: DESIGN.spacing.sm },
  roleCard: { flexDirection: "row", alignItems: "center", gap: 16, borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: 16, padding: 18, marginTop: 10 },
  roleIcon: { fontSize: 35 },
  roleTitle: { fontSize: 18, fontWeight: "800" },
  muted: { color: DESIGN.colors.textSecondary, marginTop: 3 },
  mapWrap: { height: 280, marginHorizontal: 14, borderRadius: 18, overflow: "hidden", position: "relative" },
  customerMapWrap: {
    height: 230,
    borderRadius: 24,
    shadowColor: DESIGN.colors.textPrimary,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  map: { flex: 1 },
  locationButton: { position: "absolute", right: 12, top: 12, backgroundColor: DESIGN.colors.surface, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  customerLocationButton: {
    right: 12,
    top: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 18,
    shadowColor: DESIGN.colors.textPrimary,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  locationButtonText: { fontWeight: "700", color: DESIGN.colors.textPrimary },
  driverTop: { paddingHorizontal: 20, paddingBottom: 8 },
  list: { padding: 20, paddingTop: 8 },
  filterRow: { gap: 8, paddingRight: 12 },
  filterPanel: { backgroundColor: DESIGN.colors.background, borderRadius: 14, padding: 12, marginTop: 12 },
  resultCount: { color: DESIGN.colors.textSecondary, fontWeight: "700", marginTop: 14, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: DESIGN.colors.textPrimary, marginBottom: DESIGN.spacing.sm },
  jobCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface },
  marketCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.md, backgroundColor: DESIGN.colors.surface },
  acceptedCard: { borderWidth: 1, borderColor: DESIGN.colors.success, borderRadius: DESIGN.radius.large, padding: DESIGN.spacing.lg, marginBottom: DESIGN.spacing.md, backgroundColor: "#ecfdf5" },
  acceptedTitle: { color: DESIGN.colors.primary, fontSize: 12, fontWeight: "800", marginBottom: 4 },
  acceptedPrice: { color: DESIGN.colors.textPrimary, fontSize: 24, fontWeight: "800", marginTop: 12 },
  offerCard: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: DESIGN.colors.surface },
  offerTitle: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "800" },
  offerPrice: { color: DESIGN.colors.textPrimary, fontSize: 24, fontWeight: "800", marginTop: 12 },
  offerEta: { color: DESIGN.colors.primary, fontSize: 16, fontWeight: "700", marginTop: 6 },
  offerMessage: { color: DESIGN.colors.textSecondary, marginTop: 10, fontStyle: "italic" },
  refreshButton: { borderWidth: 1, borderColor: DESIGN.colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  refreshButtonText: { color: DESIGN.colors.primary, fontWeight: "700" },
  marketEyebrow: { color: DESIGN.colors.primary, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  urgentBadge: { maxWidth: "58%", color: DESIGN.colors.primary, backgroundColor: DESIGN.colors.primarySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, fontWeight: "800", textAlign: "right" },
  cardLabel: { color: DESIGN.colors.textPrimary, fontWeight: "800", marginTop: 12 },
  detailLink: { color: DESIGN.colors.primary, fontWeight: "800", textAlign: "right", marginTop: 14 },
  routesSection: { marginTop: 12, paddingTop: 18, borderTopWidth: 1, borderTopColor: DESIGN.colors.border },
  rowBetween: { flexDirection: "row", justifyContent: "space-between" },
  jobId: { fontWeight: "800" },
  badge: { fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: DESIGN.colors.primarySoft, color: DESIGN.colors.primary },
  jobTitle: { fontSize: 17, fontWeight: "700", marginTop: 10, marginBottom: 4 },
  empty: { color: DESIGN.colors.textSecondary, textAlign: "center", marginTop: 40 },
  bottomAction: { padding: 20 },
  label: { fontWeight: "800", marginTop: 14, color: DESIGN.colors.textPrimary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: DESIGN.colors.border, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20 },
  chipActive: { backgroundColor: DESIGN.colors.primarySoft, borderColor: DESIGN.colors.primary },
  statusBox: { backgroundColor: DESIGN.colors.background, borderRadius: 14, padding: 16, marginTop: 16 },
  statusTitle: { fontSize: 17, fontWeight: "800", color: DESIGN.colors.textPrimary, marginBottom: 5 },
  error: { color: DESIGN.colors.danger, marginBottom: 10 },
  customerDescription: { color: DESIGN.colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 4, marginBottom: 8 },
  customerPrimary: {
    backgroundColor: DESIGN.colors.textPrimary,
    borderRadius: 18,
    minHeight: 60,
    paddingHorizontal: 18,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    shadowColor: DESIGN.colors.textPrimary,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  customerActionRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#e3e8ef",
    borderRadius: 17,
    backgroundColor: DESIGN.colors.surface,
  },
  customerActionRowSubtle: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingHorizontal: 16,
    borderRadius: 17,
  },
  customerActionIcon: { width: 28, color: DESIGN.colors.primary, fontSize: 20, fontWeight: "700" },
  customerActionText: { flex: 1, color: DESIGN.colors.textPrimary, fontSize: 16, fontWeight: "700" },
  customerActionTextSubtle: { flex: 1, color: DESIGN.colors.textSecondary, fontSize: 15, fontWeight: "600" },
  customerActionArrow: { color: DESIGN.colors.textSecondary, fontSize: 27, lineHeight: 27 },
  vehicleCard: {
    borderWidth: 1,
    borderColor: DESIGN.colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    backgroundColor: DESIGN.colors.surface,
  },
  vehicleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  vehicleName: {
    fontSize: 18,
    fontWeight: "800",
    color: DESIGN.colors.textPrimary,
  },
  vehicleInfo: {
    fontSize: 14,
    color: DESIGN.colors.textSecondary,
    marginTop: 3,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 6,
  },
  activeBadge: {
    backgroundColor: "#dcfce7",
    borderColor: "#22c55e",
    borderWidth: 1,
  },
  inactiveBadge: {
    backgroundColor: "#fef3c7",
    borderColor: "#f59e0b",
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: DESIGN.colors.textSecondary,
  },
  vehicleDetails: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 14,
    marginBottom: 10,
  },
  vehicleDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  vehicleDetailLabel: {
    color: DESIGN.colors.textSecondary,
    fontSize: 14,
    flex: 1
  },
  vehicleDetailValue: {
    color: DESIGN.colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  vehicleEquipment: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 14,
    marginBottom: 12,
  },
  equipmentLabel: {
    color: DESIGN.colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  equipmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  equipmentItem: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    color: DESIGN.colors.textSecondary,
  },
  equipmentChecked: {
    backgroundColor: DESIGN.colors.primarySoft,
    borderColor: DESIGN.colors.primary,
    color: DESIGN.colors.primary,
  },
  vehicleActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  dangerButton: {
    backgroundColor: "#fef2f2",
    borderColor: "#ef4444",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flex: 1,
    alignItems: "center",
  },
  dangerButtonText: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "700",
  },
  multilineInput: {
    height: 80,
    textAlignVertical: "top",
  },
});
