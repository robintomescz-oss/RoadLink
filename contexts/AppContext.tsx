import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getCurrentRouteName,
  navigateLegacy,
  navigationRef,
} from "../navigation/navigationRef";
import { useAuthSession } from "../hooks/useAuthSession";
import { supabase } from "../lib/supabase";
import { useLocation } from "../hooks/useLocation";
import { useProfile } from "../hooks/useProfile";
import { useTransportData } from "../hooks/useTransportData";
import type { OfferProviderProfile, RequestViewMode, TowOffer } from "../lib/types";

export type TransportTab = "all" | "requests" | "capacity" | "mine";

/**
 * Poslední hodnoty formuláře nové poptávky. V původní App žily tyto čtyři pole
 * v paměti aplikace a umožňují návrat k rozepsanému formuláři. Výslovná volba
 * „Zahodit“ a úspěšné odeslání draft vyčistí.
 */
export type RequestDraft = {
  pickupText: string;
  destination: string;
  pickupPublicLabel: string;
  destinationPublicLabel: string;
  vehicle: string;
  problem: string;
};

const INITIAL_REQUEST_DRAFT: RequestDraft = {
  pickupText: "",
  destination: "",
  pickupPublicLabel: "",
  destinationPublicLabel: "",
  vehicle: "Osobní automobil",
  problem: "",
};

type AuthState = ReturnType<typeof useAuthSession>;
type LocationState = ReturnType<typeof useLocation>;
type TransportState = ReturnType<typeof useTransportData>;
type ProfileState = ReturnType<typeof useProfile>;

export type AppContextValue = {
  // ── Jádro (sdílené napříč obrazovkami) ────────────────────────────────
  // Žádná `role`: RoadLink má jeden účet (viz ROADLINK_AGENT_RULES.md).
  userId: AuthState["userId"];
  activeJobId: string | null;
  setActiveJobId: React.Dispatch<React.SetStateAction<string | null>>;
  activeRouteId: TransportState["activeRouteId"];
  setActiveRouteId: TransportState["setActiveRouteId"];

  // Původně lokální stavy Appky, které se zapisují na jedné obrazovce
  // a čtou na jiné (seznam → detail). Viz poznámka v odpovědi.
  requestViewMode: RequestViewMode;
  setRequestViewMode: React.Dispatch<React.SetStateAction<RequestViewMode>>;
  transportTab: TransportTab;
  setTransportTab: React.Dispatch<React.SetStateAction<TransportTab>>;

  requestDraft: RequestDraft;
  setRequestDraft: React.Dispatch<React.SetStateAction<RequestDraft>>;

  selectedOfferId: string | null;
  selectedProviderProfile: OfferProviderProfile | null;
  providerProfileLoading: boolean;
  providerProfileError: boolean;
  openProviderProfile: (offer: TowOffer) => Promise<void>;

  /** Název aktuální obrazovky (dočasný most pro hooky, které ještě čtou `screen`). */
  currentScreen: string;

  clearLocalUserState: () => void;

  // ── Hooky inicializované jednou pro celou aplikaci ────────────────────
  authState: AuthState;
  locationState: LocationState;
  transportState: TransportState;
  profileState: ProfileState;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [requestViewMode, setRequestViewMode] = useState<RequestViewMode>("owner");
  const [transportTab, setTransportTab] = useState<TransportTab>("all");
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(INITIAL_REQUEST_DRAFT);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [selectedProviderProfile, setSelectedProviderProfile] = useState<OfferProviderProfile | null>(null);
  const [providerProfileLoading, setProviderProfileLoading] = useState(false);
  const [providerProfileError, setProviderProfileError] = useState(false);

  // ── Most: `screen` pro hooky, které ho zatím očekávají ────────────────
  // AppProvider je nad NavigationContainerem, proto název aktuální route
  // sledujeme přes navigationRef. Route jmenujeme stejně jako původní
  // hodnoty `screen` ("home", "transport", "job", …), takže porovnání
  // uvnitř hooků fungují beze změny.
  const [currentScreen, setCurrentScreen] = useState<string>("home");

  useEffect(() => {
    const sync = () => {
      const name = navigationRef.getCurrentRoute()?.name;
      if (name) setCurrentScreen(name);
    };
    // Listener přidaný před inicializací kontejneru se zařadí do fronty.
    const unsubscribe = navigationRef.addListener("state", sync);
    if (navigationRef.isReady()) sync();
    return unsubscribe;
  }, []);

  // Náhrada za původní useState setter: useAuth ho volá jako setScreen("home")
  // i jako updater setScreen((current) => …). Stejně jako u setState se při
  // stejné hodnotě nic nestane. Aktuální route čteme přímo z navigationRef
  // (žádné zpoždění za Reactem).
  const setScreen = useCallback(
    (next: string | ((prev: string) => string)) => {
      const current = getCurrentRouteName() ?? "home";
      const name = typeof next === "function" ? next(current) : next;
      if (name === current) return;
      navigateLegacy(name);
    },
    []
  );

  // ── Hooky (stejné pořadí a argumenty jako v původní App) ──────────────
  const authState = useAuthSession({
    setScreen,
    onUnauthenticated: () => clearLocalUserState(),
  });
  const { userId, setUserId } = authState;

  const locationState = useLocation();

  const transportState = useTransportData({
    userId,
    screen: currentScreen,
    activeJobId,
    transportTab,
  });

  const profileState = useProfile({ userId, screen: currentScreen });

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
      navigateLegacy("providerProfile");
      return;
    }

    const rows = (data || []) as OfferProviderProfile[];
    setSelectedProviderProfile(rows.length === 0 ? null : rows[0]);
    navigateLegacy("providerProfile");
  }

  // Stejná logika jako původně. Vynecháno: setInterestSelectionVisible /
  // setInterestSubmitting – ty se přesunou jako lokální stav do obrazovky
  // s detailem trasy a zanikají s ní při odhlášení.
  function clearLocalUserState() {
    setUserId(null);
    profileState.resetProfileData();
    transportState.resetTransportData();
    setActiveJobId(null);
  }

  const value: AppContextValue = {
    userId,
    activeJobId,
    setActiveJobId,
    activeRouteId: transportState.activeRouteId,
    setActiveRouteId: transportState.setActiveRouteId,
    requestViewMode,
    setRequestViewMode,
    transportTab,
    setTransportTab,
    requestDraft,
    setRequestDraft,
    selectedOfferId,
    selectedProviderProfile,
    providerProfileLoading,
    providerProfileError,
    openProviderProfile,
    currentScreen,
    clearLocalUserState,
    authState,
    locationState,
    transportState,
    profileState,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext musí být použit uvnitř <AppProvider>.");
  }
  return ctx;
}
