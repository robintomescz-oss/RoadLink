import { validatePublicLocationLabel } from "./publicMarket";
import type { VehicleMobility } from "./types";

export type LoadingStateOption = "drive" | "winch" | "special" | "unknown";

export type LoadingStateMapping = {
  option: LoadingStateOption;
  label: string;
  description: string;
  vehicle_mobility: VehicleMobility;
  can_drive_onto_trailer: boolean | null;
};

export const LOADING_STATE_OPTIONS: LoadingStateMapping[] = [
  {
    option: "drive",
    label: "Najede vlastní silou",
    description: "Vozidlo je pojízdné a může samo najet na přepravník.",
    vehicle_mobility: "drivable",
    can_drive_onto_trailer: true,
  },
  {
    option: "winch",
    label: "Je nutné naložení navijákem",
    description: "Vozidlo samo nenajede, přepravce musí počítat s navijákem.",
    vehicle_mobility: "not_drivable",
    can_drive_onto_trailer: false,
  },
  {
    option: "special",
    label: "Vyžaduje zvláštní způsob nakládky",
    description: "Vozidlo má omezenou pojízdnost nebo jinou komplikaci při nakládce.",
    vehicle_mobility: "partially_drivable",
    can_drive_onto_trailer: false,
  },
  {
    option: "unknown",
    label: "Nevím",
    description: "Stav nakládky není jistý; přepravce to musí předem vědět.",
    vehicle_mobility: "unknown",
    can_drive_onto_trailer: null,
  },
];

export function loadingOptionToFields(option: LoadingStateOption) {
  return LOADING_STATE_OPTIONS.find((item) => item.option === option) ?? LOADING_STATE_OPTIONS[3];
}

export function fieldsToLoadingOption(
  vehicleMobility: VehicleMobility | null | undefined,
  canTrailer: boolean | null | undefined
): LoadingStateOption {
  if (vehicleMobility === "drivable" && canTrailer === true) return "drive";
  if (vehicleMobility === "not_drivable" && canTrailer === false) return "winch";
  if (vehicleMobility === "partially_drivable") return "special";
  if (vehicleMobility === "unknown" || vehicleMobility == null) return "unknown";
  if (vehicleMobility === "drivable") return "drive";
  if (vehicleMobility === "not_drivable") return "winch";
  return "unknown";
}

export type RequestValidationInput = {
  pickupText: string;
  destination: string;
  pickupPublicLabel?: string;
  destinationPublicLabel?: string;
  requestedDate: Date | null;
  requestedEndDate: Date | null;
  dateMode: "concrete" | "window";
  vehicle: string;
  loadingState: LoadingStateOption | null;
};

export type CapacityValidationInput = {
  routeFrom: string;
  routeTo: string;
  fromPublicLabel?: string;
  toPublicLabel?: string;
  routeDepartureDate: Date | null;
  routeDepartureTime: Date | null;
  routeSpaces: string;
  routeVehicleTypes: string;
  routePriceMode: "fixed" | "negotiable";
  routePrice: string;
};

export type ValidationResult<T extends string> = {
  valid: boolean;
  errors: Partial<Record<T, string>>;
  firstInvalid: T | null;
};

function result<T extends string>(errors: Partial<Record<T, string>>, order: T[]): ValidationResult<T> {
  const firstInvalid = order.find((key) => Boolean(errors[key])) ?? null;
  return { valid: firstInvalid === null, errors, firstInvalid };
}

export type RequestErrorKey = "route" | "publicPlace" | "date" | "vehicle" | "loading";
export type CapacityErrorKey = "route" | "publicPlace" | "departure" | "capacity" | "vehicle" | "price";

export function validateRequestForm(input: RequestValidationInput): ValidationResult<RequestErrorKey> {
  const errors: Partial<Record<RequestErrorKey, string>> = {};
  // Trasa: povinné je veřejné město/obec. Přesné místo je volitelné (soukromá
  // adresa pak bezpečně padne na město/obec — viz resolvePrivateAddress),
  // takže postačí, když je vyplněné alespoň jedno z dvojice.
  if (!input.pickupText.trim() && !(input.pickupPublicLabel ?? "").trim()) errors.route = "Vyplňte prosím místo vyzvednutí.";
  else if (!input.destination.trim() && !(input.destinationPublicLabel ?? "").trim()) errors.route = "Vyplňte prosím cíl přepravy.";

  // Veřejné labely (město/obec) jsou pro nové záznamy povinné a jsou
  // viditelné ve veřejném anonymním feedu — platí pro ně vlastní pravidla.
  if (input.pickupPublicLabel !== undefined || input.destinationPublicLabel !== undefined) {
    const pickupPublic = validatePublicLocationLabel(input.pickupPublicLabel ?? "");
    const destinationPublic = validatePublicLocationLabel(input.destinationPublicLabel ?? "");
    if (!pickupPublic.valid) errors.publicPlace = pickupPublic.error ?? "Zadejte veřejné město/obec pro Odkud.";
    else if (!destinationPublic.valid) errors.publicPlace = destinationPublic.error ?? "Zadejte veřejné město/obec pro Kam.";
  }

  if (!input.requestedDate) errors.date = "Vyberte prosím datum přepravy.";
  else if (input.dateMode === "window") {
    if (!input.requestedEndDate) errors.date = "Vyberte prosím konec časového okna.";
    else {
      const startDay = new Date(input.requestedDate);
      startDay.setHours(0, 0, 0, 0);
      const endDay = new Date(input.requestedEndDate);
      endDay.setHours(0, 0, 0, 0);
      if (endDay < startDay) errors.date = "Konec časového okna nesmí být před jeho začátkem.";
    }
  }

  if (!input.vehicle.trim()) errors.vehicle = "Vyberte prosím typ vozidla.";
  if (!input.loadingState) errors.loading = "Vyberte prosím stav vozidla pro nakládku.";
  return result(errors, ["route", "publicPlace", "date", "vehicle", "loading"]);
}

export function validateCapacityForm(input: CapacityValidationInput): ValidationResult<CapacityErrorKey> {
  const errors: Partial<Record<CapacityErrorKey, string>> = {};
  const availableSpaces = Number(input.routeSpaces);
  const price = input.routePrice.trim() === "" ? null : Number(input.routePrice);

  // Trasa: povinné je veřejné město/obec; přesné místo je volitelné
  // (fallback = město/obec, viz resolvePrivateAddress).
  if (!input.routeFrom.trim() && !(input.fromPublicLabel ?? "").trim()) errors.route = "Vyplňte prosím místo odjezdu.";
  else if (!input.routeTo.trim() && !(input.toPublicLabel ?? "").trim()) errors.route = "Vyplňte prosím cíl trasy.";

  // Veřejné labely (město/obec) — povinné, veřejně viditelné v anonymním feedu.
  if (input.fromPublicLabel !== undefined || input.toPublicLabel !== undefined) {
    const fromPublic = validatePublicLocationLabel(input.fromPublicLabel ?? "");
    const toPublic = validatePublicLocationLabel(input.toPublicLabel ?? "");
    if (!fromPublic.valid) errors.publicPlace = fromPublic.error ?? "Zadejte veřejné město/obec pro Odkud.";
    else if (!toPublic.valid) errors.publicPlace = toPublic.error ?? "Zadejte veřejné město/obec pro Kam.";
  }

  // Datum odjezdu je povinné, přesný čas už ne — přepravce může jet ráno
  // i odpoledne a zbytek dopočítá nabídka shody i uživatel v kalendáři.
  if (!input.routeDepartureDate) errors.departure = "Vyberte prosím datum odjezdu.";
  if (!Number.isFinite(availableSpaces) || availableSpaces <= 0) errors.capacity = "Zadejte platný kladný počet volných míst.";

  if (!input.routeVehicleTypes.trim()) errors.vehicle = "Zadejte prosím typ přijímaného vozidla.";
  if (input.routePriceMode === "fixed" && (price === null || !Number.isFinite(price) || price < 0)) {
    errors.price = "Zadejte platnou pevnou cenu, nebo zvolte cenu dohodou.";
  }
  if (input.routePriceMode === "negotiable" && price !== null && input.routePrice.trim() !== "" && (!Number.isFinite(price) || price < 0)) {
    errors.price = "Cena musí být platné nezáporné číslo.";
  }

  return result(errors, ["route", "publicPlace", "departure", "capacity", "vehicle", "price"]);
}

function dateToken(date: Date | null) {
  return date ? date.toISOString() : "";
}

/**
 * Soukromá přesná adresa pro DB payload.
 *
 * Bez rozbaleného „Upřesnit přesné místo“ (nebo s prázdným polem) se jako
 * soukromá adresa použije bezpečný fallback = zadané město/obec — DB sloupce
 * i geocoding zůstávají beze změny, jen se nemusí přesné místo zadávat.
 * Veřejný public label se přitom nikdy nepřepisuje z přesné adresy.
 */
export function resolvePrivateAddress(publicLabel: string, precisePlace: string): string {
  return precisePlace.trim() || publicLabel.trim();
}

export function requestSnapshot(input: {
  pickupText: string;
  destination: string;
  pickupPublicLabel?: string;
  destinationPublicLabel?: string;
  vehicle: string;
  problem: string;
  requestedDate: Date | null;
  requestedEndDate: Date | null;
  dateMode: "concrete" | "window";
  loadingState: LoadingStateOption | null;
  requestVehicleModel: string;
}) {
  return JSON.stringify({ ...input, requestedDate: dateToken(input.requestedDate), requestedEndDate: dateToken(input.requestedEndDate) });
}

export type RouteMetricsSubmitPreview = {
  status: "idle" | "loading" | "success" | "error" | "rate_limited";
  pairKey: string | null;
  metrics: { distanceMeters: number; durationSeconds: number } | null;
  readyToSubmit: boolean;
};

export function currentRouteMetricsPairKey(originPlaceId: string | null | undefined, destinationPlaceId: string | null | undefined) {
  const origin = typeof originPlaceId === "string" ? originPlaceId.trim() : "";
  const destination = typeof destinationPlaceId === "string" ? destinationPlaceId.trim() : "";
  return origin && destination ? `${origin}::${destination}` : null;
}

export function routeMetricsSubmitBlockReason(input: {
  originPlaceId: string | null | undefined;
  destinationPlaceId: string | null | undefined;
  preview: RouteMetricsSubmitPreview;
}) {
  const pairKey = currentRouteMetricsPairKey(input.originPlaceId, input.destinationPlaceId);
  if (!pairKey) return "Vyberte výchozí a cílové místo";
  if (input.preview.status === "loading") return "Počítám trasu…";
  if (!input.preview.readyToSubmit || input.preview.status !== "success" || !input.preview.metrics || input.preview.pairKey !== pairKey) {
    return "Nejprve je potřeba ověřit trasu";
  }
  return null;
}

export function buildRouteMetricsPayload(input: {
  originPlaceId: string;
  destinationPlaceId: string;
  preview: RouteMetricsSubmitPreview;
}) {
  const blockReason = routeMetricsSubmitBlockReason(input);
  if (blockReason) throw new Error("Missing current route metrics for insert payload.");
  return {
    origin_place_id: input.originPlaceId,
    destination_place_id: input.destinationPlaceId,
    route_distance_meters: input.preview.metrics!.distanceMeters,
    route_duration_seconds: input.preview.metrics!.durationSeconds,
  };
}

/** Kolik průjezdních bodů smí trasa obsahovat; odpovídá DB a `MAX_VIA_PLACES`. */
export const MAX_VIA_PLACES = 3;

export type ViaPlace = { placeId: string; publicLabel: string };

/**
 * Znormalizuje seznam průjezdních bodů a odmítne rozbitý vstup.
 *
 * Vrací `null`, když je pole příliš dlouhé, obsahuje prázdný/duplicitní bod
 * nebo bod shodný s odjezdem či cílem — taková trasa by byla zbytečně dlouhá
 * nebo by Google odmítl. Prázdné pole znamená přímou trasu a je legitimní.
 */
export function normalizeViaPlaces(input: {
  viaPlaces: readonly ViaPlace[];
  originPlaceId?: string | null;
  destinationPlaceId?: string | null;
}): ViaPlace[] | null {
  const source = input.viaPlaces ?? [];
  if (source.length > MAX_VIA_PLACES) return null;

  const seen = new Set<string>();
  const origin = input.originPlaceId ?? null;
  const destination = input.destinationPlaceId ?? null;
  const result: ViaPlace[] = [];

  for (const place of source) {
    const placeId = typeof place?.placeId === "string" ? place.placeId.trim() : "";
    const publicLabel = typeof place?.publicLabel === "string" ? place.publicLabel.trim() : "";
    if (!placeId || !publicLabel) return null;
    if (placeId === origin || placeId === destination) return null;
    if (seen.has(placeId)) return null;
    seen.add(placeId);
    result.push({ placeId, publicLabel });
  }

  return result;
}

export function capacitySnapshot(input: {
  routeFrom: string;
  routeTo: string;
  fromPublicLabel?: string;
  toPublicLabel?: string;
  routeDepartureDate: Date | null;
  routeDepartureTime: Date | null;
  routeSpaces: string;
  viaPlaces?: readonly ViaPlace[];
  routeVehicleTypes: string;
  routePrice: string;
  routePriceMode: "fixed" | "negotiable";
  routeDescription: string;
}) {
  return JSON.stringify({ ...input, routeDepartureDate: dateToken(input.routeDepartureDate), routeDepartureTime: dateToken(input.routeDepartureTime) });
}
