import type {
  AccidentAnswer,
  IntroChoiceId,
  ProblemCategoryId,
  SafetyActionId,
  WarningLightInput,
} from "./sosContent";
import { getProblemCategory } from "./sosContent";

/**
 * Stavový automat SOS průvodce – čistá logika bez Reactu.
 *
 * Zásady:
 *  - Stav zásahu rozlišuje „odesláno" od „partner přijal". Úspěšné odeslání
 *    NIKDY neznamená přijetí.
 *  - Opakované klepnutí / retry nevytvoří druhou objednávku (canSubmitOrder).
 *  - Síťová chyba NIKDY nepřepne objednávku do stavu „odesláno".
 *  - Průběh zůstává v paměti i při krátkém přerušení aplikace.
 */

export type SosStage =
  | "intro"
  | "call"
  | "safety"
  | "problem"
  | "accident"
  | "assistance"
  | "status";

export type SosOrderStatus =
  | "idle"
  | "sending"
  | "sent"
  | "awaiting_acceptance"
  | "accepted"
  | "en_route"
  | "arrived"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

/** Stavy, po kterých je možné bezpečně vytvořit novou objednávku. */
const TERMINAL_ORDER_STATUSES: SosOrderStatus[] = [
  "idle",
  "completed",
  "rejected",
  "cancelled",
  "failed",
];

export type SosVehicleInput = {
  source: "profile" | "manual";
  label: string;
  make: string;
  model: string;
  registration: string;
};

export type SosOrder = {
  status: SosOrderStatus;
  /** Stabilní klíč objednávky proti duplicitám. */
  clientRequestId: string | null;
  providerName: string | null;
  orderId: string | null;
  etaMinutes: number | null;
  error: string | null;
  lastAttemptAt: number | null;
};

export type SosState = {
  stage: SosStage;
  introChoice: IntroChoiceId | null;
  safety: Partial<Record<string, SafetyActionId>>;
  problem: ProblemCategoryId | null;
  warningLight: WarningLightInput | null;
  accident: Record<string, AccidentAnswer>;
  manualLocation: string;
  roadType: RoadType;
  roadTypeEdited: boolean;
  vehicle: SosVehicleInput | null;
  order: SosOrder;
};

export type RoadType = "motorway" | "town" | "other" | "unknown";

export const ROAD_TYPE_LABELS: Record<RoadType, string> = {
  motorway: "Dálnice",
  town: "Obec / město",
  other: "Jiná komunikace",
  unknown: "Nevím",
};

/** Pořadí voleb typu komunikace v UI. */
export const SUGGESTED_ROAD_TYPES: RoadType[] = [
  "motorway",
  "town",
  "other",
  "unknown",
];

export function createInitialSosState(): SosState {
  return {
    stage: "intro",
    introChoice: null,
    safety: {},
    problem: null,
    warningLight: null,
    accident: {},
    manualLocation: "",
    roadType: "unknown",
    roadTypeEdited: false,
    vehicle: null,
    order: {
      status: "idle",
      clientRequestId: null,
      providerName: null,
      orderId: null,
      etaMinutes: null,
      error: null,
      lastAttemptAt: null,
    },
  };
}

// ── Přechody ───────────────────────────────────────────────────────────────

export function applyIntroChoice(state: SosState, choice: IntroChoiceId): SosState {
  const stage: SosStage = choice === "breakdown" ? "safety" : "call";
  return { ...state, introChoice: choice, stage };
}

export function goToStage(state: SosState, stage: SosStage): SosState {
  return { ...state, stage };
}

export function applySafetyAction(
  state: SosState,
  stepId: string,
  action: SafetyActionId
): SosState {
  return { ...state, safety: { ...state.safety, [stepId]: action } };
}

export function selectProblem(
  state: SosState,
  problem: ProblemCategoryId
): SosState {
  const stage: SosStage = problem === "accident" ? "accident" : "assistance";
  return { ...state, problem, stage };
}

export function applyWarningLight(
  state: SosState,
  input: WarningLightInput
): SosState {
  return { ...state, warningLight: input, problem: "warning_light" };
}

export function applyAccidentAnswer(
  state: SosState,
  itemId: string,
  answer: AccidentAnswer
): SosState {
  return { ...state, accident: { ...state.accident, [itemId]: answer } };
}

export function setManualLocation(state: SosState, text: string): SosState {
  return { ...state, manualLocation: text };
}

export function setRoadType(state: SosState, roadType: RoadType): SosState {
  return { ...state, roadType, roadTypeEdited: true };
}

export function setVehicle(state: SosState, vehicle: SosVehicleInput): SosState {
  return { ...state, vehicle };
}

// ── Objednávka a ochrana proti duplicitám ──────────────────────────────────

export function canSubmitOrder(state: SosState): boolean {
  return TERMINAL_ORDER_STATUSES.includes(state.order.status);
}

export function isOrderBusy(state: SosState): boolean {
  return state.order.status === "sending";
}

/** Jediné místo, které smí nastavit klíč objednávky – volá se před odesláním. */
export function beginOrder(
  state: SosState,
  clientRequestId: string,
  providerName: string | null,
  nowMs: number
): SosState {
  if (!canSubmitOrder(state)) return state;
  return {
    ...state,
    stage: "status",
    order: {
      status: "sending",
      clientRequestId,
      providerName,
      orderId: null,
      etaMinutes: null,
      error: null,
      lastAttemptAt: nowMs,
    },
  };
}

/**
 * Objednávka byla přijata serverem – teprve teď je „odesláno".
 * Neznamená to, že ji partner přijal (to je samostatný stav).
 */
export function orderSent(
  state: SosState,
  details: { orderId: string | null; etaMinutes: number | null }
): SosState {
  return {
    ...state,
    order: {
      ...state.order,
      status: "sent",
      orderId: details.orderId,
      etaMinutes: details.etaMinutes,
      error: null,
    },
  };
}

export function orderStatusChanged(
  state: SosState,
  status: SosOrderStatus,
  details: { etaMinutes?: number | null } = {}
): SosState {
  return {
    ...state,
    order: {
      ...state.order,
      status,
      etaMinutes:
        details.etaMinutes === undefined ? state.order.etaMinutes : details.etaMinutes,
      error: status === "failed" ? state.order.error : null,
    },
  };
}

/** Síťová chyba nebo výpadek – objednávka se NIKDY nevykazuje jako odeslaná. */
export function orderFailed(state: SosState, message: string): SosState {
  return {
    ...state,
    order: {
      ...state.order,
      status: "failed",
      orderId: null,
      etaMinutes: null,
      error: message,
    },
  };
}

/** Retry po chybě: uvolní klíč, ale zachová průběh průvodce. */
export function resetFailedOrder(state: SosState): SosState {
  if (state.order.status === "sending") return state;
  return {
    ...state,
    stage: "assistance",
    order: {
      status: "idle",
      clientRequestId: null,
      providerName: null,
      orderId: null,
      etaMinutes: null,
      error: null,
      lastAttemptAt: state.order.lastAttemptAt,
    },
  };
}

/** Zrušení podle skutečných podmínek (jen když objednávka existuje). */
export function cancelOrder(state: SosState): SosState {
  if (state.order.status === "idle" || state.order.status === "sending") return state;
  return { ...state, order: { ...state.order, status: "cancelled", error: null } };
}

// ── Zobrazení stavu zásahu ─────────────────────────────────────────────────

export type OrderStatusView = {
  label: string;
  icon: string;
  description: string;
  /** „progress" není totéž jako „accepted". */
  tone: "idle" | "progress" | "waiting" | "accepted" | "success" | "error";
};

export function orderStatusView(status: SosOrderStatus): OrderStatusView {
  switch (status) {
    case "idle":
      return {
        label: "Nevytvořeno",
        icon: "•",
        description: "Objednávka zatím nebyla odeslána.",
        tone: "idle",
      };
    case "sending":
      return {
        label: "Odesílám…",
        icon: "⏳",
        description: "Požadavek se odesílá.",
        tone: "progress",
      };
    case "sent":
      return {
        label: "Odesláno – čeká na přijetí",
        icon: "📨",
        description:
          "Požadavek jsme odeslali. Zatím ho NIKDO nepřijal – čekáme na vyjádření.",
        tone: "waiting",
      };
    case "awaiting_acceptance":
      return {
        label: "Čeká na přijetí",
        icon: "📨",
        description: "Odesláno, čekáme na přijetí partnerem.",
        tone: "waiting",
      };
    case "accepted":
      return {
        label: "Partner přijal",
        icon: "✅",
        description: "Partner objednávku přijal.",
        tone: "accepted",
      };
    case "en_route":
      return {
        label: "Technik jede",
        icon: "🚚",
        description: "Technik je na cestě. Čas příjezdu je jen odhad.",
        tone: "accepted",
      };
    case "arrived":
      return {
        label: "Technik dorazil",
        icon: "📍",
        description: "Technik dorazil na místo.",
        tone: "accepted",
      };
    case "completed":
      return {
        label: "Dokončeno",
        icon: "🏁",
        description: "Zásah byl dokončen.",
        tone: "success",
      };
    case "rejected":
      return {
        label: "Odmítnuto",
        icon: "🚫",
        description: "Partner objednávku odmítl. Můžete zavolat pomoc přímo.",
        tone: "error",
      };
    case "cancelled":
      return {
        label: "Zrušeno",
        icon: "✖️",
        description: "Objednávka byla zrušena.",
        tone: "error",
      };
    case "failed":
      return {
        label: "Odeslání se nezdařilo",
        icon: "⚠️",
        description: "Objednávka nebyla odeslána. Zkuste to znovu nebo volejte.",
        tone: "error",
      };
    default:
      return {
        label: "Neznámý stav",
        icon: "❓",
        description: "Stav objednávky nelze zobrazit.",
        tone: "error",
      };
  }
}

export const SOS_ETA_IS_ESTIMATE = "Uvedený čas příjezdu je odhad, ne závazný termín.";

// ── Poloha pro SOS ─────────────────────────────────────────────────────────

export type RawDeviceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: number;
};

export type LocationFreshness = "fresh" | "stale" | "unknown";

export type SosLocationSummary = {
  mode: "gps" | "manual" | "none";
  description: string;
  coordinates: { latitude: number; longitude: number } | null;
  accuracyMeters: number | null;
  capturedAt: number | null;
  freshness: LocationFreshness;
  accuracyText: string;
  disclaimer: string;
};

export const SOS_LOCATION_STALE_MS = 5 * 60 * 1000;

export const SOS_LOCATION_COORDINATES_ARE_SEPARATE =
  "Souřadnice a ručně zadaný popis místa jsou oddělené údaje. Ručně zadaný " +
  "popis nikdy nedoplňujeme odhadnutými souřadnicemi.";

function formatAge(capturedAt: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - capturedAt) / 60000));
  if (minutes <= 0) return "právě teď";
  if (minutes === 1) return "před minutou";
  return `před ${minutes} min`;
}

export function describeLocation(input: {
  rawLocation: RawDeviceLocation | null;
  manualDescription: string;
  nowMs: number;
}): SosLocationSummary {
  const manual = input.manualDescription.trim();

  if (manual) {
    return {
      mode: "manual",
      description: manual,
      coordinates: null,
      accuracyMeters: null,
      capturedAt: null,
      freshness: "unknown",
      accuracyText: "Ručně zadaný popis místa (bez GPS souřadnic).",
      disclaimer: SOS_LOCATION_COORDINATES_ARE_SEPARATE,
    };
  }

  if (!input.rawLocation) {
    return {
      mode: "none",
      description: "Poloha zatím není k dispozici.",
      coordinates: null,
      accuracyMeters: null,
      capturedAt: null,
      freshness: "unknown",
      accuracyText: "Bez polohy.",
      disclaimer:
        "Můžete polohu zadat ručně. Bez přesné polohy to není chyba – pomoc " +
        "lze přivolat i tak.",
    };
  }

  const { latitude, longitude, accuracyMeters, capturedAt } = input.rawLocation;
  const ageMs = input.nowMs - capturedAt;
  const freshness: LocationFreshness =
    ageMs > SOS_LOCATION_STALE_MS ? "stale" : "fresh";

  const accuracyText =
    accuracyMeters == null
      ? "Přesnost neznámá."
      : `Přesnost přibližně ±${Math.round(accuracyMeters)} m.`;

  return {
    mode: "gps",
    description: `GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    coordinates: { latitude, longitude },
    accuracyMeters,
    capturedAt,
    freshness,
    accuracyText: `${accuracyText} Zjištěno ${formatAge(capturedAt, input.nowMs)}.`,
    disclaimer:
      freshness === "stale"
        ? "Poloha může být zastaralá – před odesláním ji prosím ověřte nebo zadejte ručně."
        : SOS_LOCATION_COORDINATES_ARE_SEPARATE,
  };
}

// ── Odhad typu komunikace ──────────────────────────────────────────────────

export type RoadTypeSuggestion = {
  value: RoadType;
  source: "map" | "user" | "unknown";
  correctable: true;
  note: string;
};

/**
 * Typ komunikace lze ODHADNOUT jen z mapových dat a jen jako návrh.
 * Z GPS samotné se typ silnice, směr jízdy ani kilometrník neodvozuje.
 */
export function suggestRoadType(input: {
  mapDataAvailable: boolean;
  suggested: RoadType;
  userOverride: RoadType | null;
}): RoadTypeSuggestion {
  if (input.userOverride) {
    return {
      value: input.userOverride,
      source: "user",
      correctable: true,
      note: "Typ komunikace jste zadali sami.",
    };
  }
  if (input.mapDataAvailable && input.suggested !== "unknown") {
    return {
      value: input.suggested,
      source: "map",
      correctable: true,
      note: "Odhad z mapových dat. Můžete ho opravit – nemusí být přesný.",
    };
  }
  return {
    value: "unknown",
    source: "unknown",
    correctable: true,
    note: "Typ komunikace nelze spolehlivě určit. Zadejte ho prosím sami.",
  };
}

// ── Offline obsah ──────────────────────────────────────────────────────────

/**
 * Bezpečnostní pokyny a tísňová čísla jsou součástí balíčku → fungují offline.
 * Telefonní hovor ale závisí na dostupnosti signálu.
 */
export const SOS_OFFLINE_SAFETY_STEPS = [
  "Zapněte výstražná světla.",
  "Oblečte si reflexní vestu, pokud ji máte.",
  "Přesuňte se mimo vozovku, na dálnici za svodidla.",
  "Postavte výstražný trojúhelník (≥50 m, na dálnici ≥100 m).",
];

export const SOS_OFFLINE_NOTE =
  "Tyto pokyny a tísňová čísla jsou v aplikaci uložené a fungují bez " +
  "internetu. Samotný telefonní hovor ale závisí na dostupnosti telefonní " +
  "sítě – bez signálu spojení nezaručíme.";

// ── Souhrn pro předání ─────────────────────────────────────────────────────

export type SosRequestSummary = {
  problemLabel: string;
  problemId: ProblemCategoryId | null;
  location: SosLocationSummary;
  vehicleLabel: string;
  vehicleSource: "profile" | "manual" | "none";
  roadTypeLabel: string;
};

export function buildRequestSummary(input: {
  problemId: ProblemCategoryId | null;
  location: SosLocationSummary;
  vehicle: SosVehicleInput | null;
  roadType: RoadType;
}): SosRequestSummary {
  const problemLabel = input.problemId
    ? getProblemCategory(input.problemId).title
    : "Nevybráno";

  const vehicleParts = input.vehicle
    ? [input.vehicle.label, input.vehicle.make, input.vehicle.model, input.vehicle.registration]
        .map((part) => (part || "").trim())
        .filter(Boolean)
    : [];

  return {
    problemLabel,
    problemId: input.problemId,
    location: input.location,
    vehicleLabel: vehicleParts.length > 0 ? vehicleParts.join(" · ") : "Neuvedeno",
    vehicleSource: input.vehicle ? input.vehicle.source : "none",
    roadTypeLabel: ROAD_TYPE_LABELS[input.roadType],
  };
}
