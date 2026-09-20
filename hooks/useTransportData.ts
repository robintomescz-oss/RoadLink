import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { canonicalVehicleType } from "../lib/labels";
import { coordinatesFromValues } from "../lib/geocode";
import type {
  AcceptedJob,
  CarrierRoute,
  Job,
  ProviderIdentity,
  TowOffer,
} from "../lib/types";

/**
 * Datová vrstva přeprav: poptávky, přijaté zakázky, vlastní poptávky,
 * počty nabídek, volné trasy, zájmy o trasy, nabídky a identity přepravců.
 * Vyextractováno 1:1 z App.tsx — chování beze změny.
 */
export function useTransportData({
  userId,
  screen,
  activeJobId,
}: {
  userId: string | null;
  screen: string;
  activeJobId: string | null;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
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

  const activeAcceptedJob = acceptedJobs.find((job) => job.id === activeJobId) || null;
  const activeJob =
    jobs.find((job) => job.id === activeJobId) ||
    customerRequests.find((job) => job.id === activeJobId) ||
    activeAcceptedJob ||
    null;
  const activeRoute = routes.find((route) => route.id === activeRouteId) || null;
  const offerLoadSequenceRef = useRef(0);

  function mapTowRequestRow(row: any): Job {
    return {
      id: row.id,
      customerName: "Uživatel RoadLink",
      customerId: row.customer_id || undefined,
      vehicle: canonicalVehicleType(row.vehicle_type || "Vozidlo"),
      problem: row.problem_description || "Porucha",
      pickup: coordinatesFromValues(row.pickup_lat, row.pickup_lng),
      pickupAddress: row.pickup_address || null,
      destination: row.destination_address || "Servis dle domluvy",
      destinationCoordinates: coordinatesFromValues(row.destination_lat, row.destination_lng),
      status: row.status,
      timePreference: row.time_preference || "asap",
      requestedDate: row.requested_date || null,
      requestedEndDate: row.date_to || null,
      requestedTime: row.requested_time || null,
      vehicleMobility: row.vehicle_mobility || "unknown",
      vehicleModel: row.vehicle_model || null,
      canTrailer: row.can_drive_onto_trailer ?? null,
      createdAt: row.created_at || "",
    };
  }

  async function loadJobs() {
    setJobsLoading(true);
    const { data, error } = await supabase
      .from("tow_requests")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load jobs:", error.message);
      setJobsLoading(false);
      return;
    }

    const mapped: Job[] = (data || []).map(mapTowRequestRow);

    setJobs(mapped);
    setJobsLoading(false);
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
    const loadSequence = offerLoadSequenceRef.current + 1;
    offerLoadSequenceRef.current = loadSequence;

    if (!activeJobId) {
      setOffers([]);
      setProviderIdentities({});
      setOffersLoading(false);
      return;
    }

    const requestId = activeJobId;
    const requestOwnerId = activeJob?.id === requestId ? activeJob.customerId : null;
    const canLoadProviderIdentities = Boolean(userId && requestOwnerId && requestOwnerId === userId);

    setOffersLoading(true);
    setProviderIdentities({});

    const { data, error } = await supabase
      .from("tow_offers")
      .select("*")
      .eq("tow_request_id", requestId)
      .order("created_at", { ascending: true });

    if (offerLoadSequenceRef.current !== loadSequence) return;

    if (error) {
      console.error("Load offers:", error.message);
      setProviderIdentities({});
      setOffersLoading(false);
      return;
    }

    const loadedOffers = (data || []) as TowOffer[];
    setOffers(loadedOffers);

    if (!canLoadProviderIdentities) {
      setProviderIdentities({});
      setOffersLoading(false);
      return;
    }

    const { data: identityRows, error: identityError } = await supabase.rpc("get_offer_provider_identities", {
      p_tow_request_id: requestId,
    });

    if (offerLoadSequenceRef.current !== loadSequence) return;

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

  function selectedOfferForActiveJob() {
    return (
      offers.find((offer) => offer.status === "accepted") ||
      (activeAcceptedJob?.acceptedOffer.tow_request_id === activeJobId ? activeAcceptedJob.acceptedOffer : null)
    );
  }

  function resetTransportData() {
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
    if (screen === "tracking" || screen === "job") {
      loadOffers();
      return;
    }

    offerLoadSequenceRef.current += 1;
    setProviderIdentities({});
    setOffersLoading(false);
  }, [screen, activeJobId, userId, activeJob?.customerId]);

  return {
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
  };
}
