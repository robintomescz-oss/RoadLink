import { normalizePlaceId, parseDurationSeconds } from "../google-routes/routeRequest.ts";

export const MATCHING_COMPUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const MATCHING_FIELD_MASK = "routes.distanceMeters,routes.duration";
export const MATCHING_TIMEOUT_MS = 8000;

/**
 * Route Matrix pro levné ohodnocení variant bez geometrie.
 *
 * Vrací jen vzdálenost/dobu mezi dvojicemi bodů (žádnou geometrii ani adresy),
 * takže se hodí jako předvýběr před dražším Compute Routes. Používá se jen u
 * tras s průjezdními body, kde je variant vložení víc než přesný rozpočet.
 */
export const MATCHING_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
export const MATCHING_MATRIX_FIELD_MASK = "originIndex,destinationIndex,distanceMeters,duration,condition,status";

/**
 * Maximální počet kandidátů, kteří se přesně vyhodnotí.
 *
 * Kandidáty vybírá už databáze: interní RPC filtruje ohraničujícím obdélníkem
 * celé plánované trasy a řadí je podle vzdálenosti od ní, takže Edge Function
 * žádné široké okno načítat nemusí.
 */
export const MAX_MATCH_CANDIDATES = 5;

/** Kolik průjezdních bodů smí trasa mít; odpovídá DB i google-routes. */
export const MAX_VIA_PLACES = 3;

/**
 * Kolik variant vložení nakládky/vykládky se u jednoho kandidáta ověří přesně.
 *
 * Trasa s průjezdními body má až (n+1)(n+2)/2 přípustných vložení. Ověřit
 * všechna by u 3 průjezdních bodů znamenalo 21 placených Google volání na
 * kandidáta, což je nad serverovým i Google limitem. Nejdřív se proto všechny
 * varianty levně ohodnotí přes Route Matrix a přesně se ověří jen nejlepších
 * `MAX_EXACT_VARIANTS_PER_CANDIDATE`; zbývající označíme jako neúplné
 * (`incomplete`). U přímých tras je varianta vždy jediná a chování i počet
 * volání zůstávají stejné jako dřív.
 */
export const MAX_EXACT_VARIANTS_PER_CANDIDATE = 3;

/**
 * Celkový rozpočet Google Routes volání na jeden požadavek na shody.
 *
 * Serverový rate limit (viz rateLimit.ts) povolí 10 pokusů za minutu. Držíme se
 * pod ním, abychom uživateli nespálili limit uprostřed výpočtu; jakmile je
 * rozpočet vyčerpán, zbytek se nevyhodnocuje a výsledek se označí `incomplete`.
 */
export const MAX_MATCH_ROUTE_CALLS = 8;

/**
 * Tolerance drobného záporného rozdílu vzdálenosti (zaokrouhlení výpočtu).
 * Větší záporný rozdíl znamená, že varianta s nakládkou/vykládkou vyšla kratší
 * než základní trasa — takové údaje jsou vzájemně nesrovnatelné a nesmí
 * vytvořit shodu.
 */
export const DETOUR_DISTANCE_TOLERANCE_METERS = 1000;

/**
 * Výchozí maximální odchylka v kilometrech, když přepravce nenastavil vlastní.
 *
 * Bez této hodnoty by chybějící `max_deviation_km` znamenal práh 0 m, tedy
 * odfiltrování každé poptávky s nenulovou zajížďkou. 20 km odpovídá běžnému
 * náběhu odběratele a je to výchozí hodnota, ne nové pravidlo pro uživatele.
 */
export const DEFAULT_MAX_DEVIATION_KM = 20;

export type MatchingCandidate = {
  route_id: string;
  route_origin_place_id: string;
  route_destination_place_id: string;
  /** Průjezdní body v zadaném pořadí; prázdné = přímá trasa. */
  route_via_place_ids: string[];
  /** Soukromé souřadnice trasy a poptávky; `null` když chybí (starší data). */
  route_origin_lat: number | null;
  route_origin_lng: number | null;
  route_destination_lat: number | null;
  route_destination_lng: number | null;
  route_via_latitudes: number[] | null;
  route_via_longitudes: number[] | null;
  route_distance_meters: number;
  route_duration_seconds: number;
  max_deviation_km: number | null;
  request_id: string;
  request_origin_place_id: string;
  request_destination_place_id: string;
  request_pickup_lat: number | null;
  request_pickup_lng: number | null;
  request_destination_lat: number | null;
  request_destination_lng: number | null;
};

export type Coordinate = { latitude: number; longitude: number };

export type InsertionVariant = {
  /** Celá plánovaná trasa včetně vložených bodů, v pořadí pro Google. */
  sequence: string[];
  /** Stabilní klíč pro deterministické rozhodování při shodě. */
  key: string;
  /** Obě místa poptávky už leží na plánované trase; zajížďka je 0 bez volání. */
  zeroDetour: boolean;
};

export type VariantComputation = {
  distanceMeters: number;
  durationSeconds: number;
};

export type VariantDetour = {
  detourDistanceMeters: number;
  detourDurationSeconds: number;
};

export type MatchingMetrics = {
  requestId: string;
  detourDistanceMeters: number;
  detourDurationSeconds: number;
  score: number;
  reasons: string[];
};

/** Soukromá souřadnice jako konečné číslo v deklinaci; jinak `null`. */
function normalizeCoordinate(value: unknown, maxAbs: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -maxAbs && value <= maxAbs ? value : null;
}

/**
 * Souřadnicové pole průjezdních bodů. Musí mít přesně tolik prvků jako place ID
 * a všechny hodnoty v rozsahu; jinak `null` (polohová cesta se vypne, ale
 * kandidát zůstává platný — souřadnice jsou jen volitelné obohacení).
 */
function normalizeCoordinateArray(value: unknown, maxAbs: number, expectedLength: number): number[] | null {
  if (value === null || value === undefined) return null;
  if (expectedLength === 0 || !Array.isArray(value) || value.length !== expectedLength) return null;
  const result: number[] = [];
  for (const entry of value) {
    const coordinate = normalizeCoordinate(entry, maxAbs);
    if (coordinate === null) return null;
    result.push(coordinate);
  }
  return result;
}

export function validateMatchingRequest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const routeId = (body as Record<string, unknown>).routeId;
  return typeof routeId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(routeId.trim())
    ? { routeId: routeId.trim() }
    : null;
}

export function normalizeCandidate(value: unknown): MatchingCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const routeOrigin = normalizePlaceId(row.route_origin_place_id);
  const routeDestination = normalizePlaceId(row.route_destination_place_id);
  const requestOrigin = normalizePlaceId(row.request_origin_place_id);
  const requestDestination = normalizePlaceId(row.request_destination_place_id);
  if (!routeOrigin || !routeDestination || !requestOrigin || !requestDestination) return null;
  if (typeof row.route_id !== "string" || typeof row.request_id !== "string") return null;
  if (typeof row.route_distance_meters !== "number" || row.route_distance_meters < 0) return null;
  if (typeof row.route_duration_seconds !== "number" || row.route_duration_seconds < 0) return null;
  const maxDeviation = row.max_deviation_km === null ? null : Number(row.max_deviation_km);
  if (maxDeviation !== null && (!Number.isFinite(maxDeviation) || maxDeviation < 0)) return null;

  const rawVia = row.route_via_place_ids;
  const via: string[] = [];
  if (rawVia !== null && rawVia !== undefined) {
    if (!Array.isArray(rawVia) || rawVia.length > MAX_VIA_PLACES) return null;
    const seen = new Set<string>();
    for (const entry of rawVia) {
      const placeId = normalizePlaceId(entry);
      // Duplicitní, prázdný nebo s odjezdem/cílem shodný průjezdní bod je
      // rozbitá trasa — odmítáme ji, aby nevznikla falešná nebo neplatná trasa.
      if (!placeId) return null;
      if (placeId === routeOrigin || placeId === routeDestination) return null;
      if (seen.has(placeId)) return null;
      seen.add(placeId);
      via.push(placeId);
    }
  }

  return {
    route_id: row.route_id,
    route_origin_place_id: routeOrigin,
    route_destination_place_id: routeDestination,
    route_via_place_ids: via,
    route_origin_lat: normalizeCoordinate(row.route_origin_lat, 90),
    route_origin_lng: normalizeCoordinate(row.route_origin_lng, 180),
    route_destination_lat: normalizeCoordinate(row.route_destination_lat, 90),
    route_destination_lng: normalizeCoordinate(row.route_destination_lng, 180),
    route_via_latitudes: normalizeCoordinateArray(row.route_via_latitudes, 90, via.length),
    route_via_longitudes: normalizeCoordinateArray(row.route_via_longitudes, 180, via.length),
    route_distance_meters: Math.round(row.route_distance_meters),
    route_duration_seconds: Math.round(row.route_duration_seconds),
    max_deviation_km: maxDeviation,
    request_id: row.request_id,
    request_origin_place_id: requestOrigin,
    request_destination_place_id: requestDestination,
    request_pickup_lat: normalizeCoordinate(row.request_pickup_lat, 90),
    request_pickup_lng: normalizeCoordinate(row.request_pickup_lng, 180),
    request_destination_lat: normalizeCoordinate(row.request_destination_lat, 90),
    request_destination_lng: normalizeCoordinate(row.request_destination_lng, 180),
  };
}

/** Celá plánovaná trasa: odjezd → průjezdní body v zadaném pořadí → cíl. */
export function buildRoutePlanningPoints(candidate: MatchingCandidate): string[] {
  return [
    candidate.route_origin_place_id,
    ...candidate.route_via_place_ids,
    candidate.route_destination_place_id,
  ];
}

function insertAtGap(base: string[], gap: number, placeId: string): string[] {
  const result: string[] = [];
  for (let g = 0; g <= base.length; g++) {
    if (g === gap) result.push(placeId);
    if (g < base.length) result.push(base[g]);
  }
  return result;
}

function insertAtGaps(base: string[], a: number, b: number, pickup: string, dropoff: string): string[] {
  const result: string[] = [];
  for (let g = 0; g <= base.length; g++) {
    if (g === a) result.push(pickup);
    if (g === b) result.push(dropoff);
    if (g < base.length) result.push(base[g]);
  }
  return result;
}

type RawVariant = { sequence: string[]; order: number[]; zeroDetour: boolean };

/**
 * Vygeneruje všechny přípustné varianty vložení nakládky a vykládky do
 * plánované trasy tak, aby zůstalo zachováno pořadí původních průjezdních bodů
 * a nakládka byla vždy před vykládkou.
 *
 * Body, které už na trase leží (odjezd, cíl nebo průjezdní bod), se nevkládají
 * znovu — jejich událost je pevně na pozici v trase. Tím nevzniknou duplicitní
 * place ID a zbytečné výpočty (viz zadání: duplicitní/totožné body).
 */
export function enumerateInsertionVariants(candidate: MatchingCandidate): InsertionVariant[] {
  const base = buildRoutePlanningPoints(candidate);
  if (base.length < 2) return [];
  const pickup = candidate.request_origin_place_id;
  const dropoff = candidate.request_destination_place_id;
  if (!pickup || !dropoff || pickup === dropoff) return [];

  const n = base.length;
  const iPickup = base.indexOf(pickup);
  const iDropoff = base.indexOf(dropoff);
  const hasVia = candidate.route_via_place_ids.length > 0;
  const raw: RawVariant[] = [];

  if (!hasVia) {
    // Přímá trasa: přesně jedna varianta jako dřív (vložení mezi odjezd a cíl).
    // Body shodné s konci trasy se nevkládají, jen se vyhodnotí jejich pozice.
    if (iPickup === -1 && iDropoff === -1) {
      raw.push({ sequence: insertAtGaps(base, 1, 1, pickup, dropoff), order: [0, 0, 0], zeroDetour: false });
    } else if (iPickup !== -1 && iDropoff === -1) {
      raw.push({ sequence: insertAtGap(base, iPickup + 1, dropoff), order: [0, 0, 0], zeroDetour: false });
    } else if (iPickup === -1 && iDropoff !== -1) {
      raw.push({ sequence: insertAtGap(base, iDropoff, pickup), order: [0, 0, 0], zeroDetour: false });
    } else if (iPickup < iDropoff) {
      raw.push({ sequence: [...base], order: [0, 0, 0], zeroDetour: true });
    }
  } else if (iPickup === -1 && iDropoff === -1) {
    for (let a = 0; a <= n; a++) {
      for (let b = a; b <= n; b++) {
        // Nejdřív stejný úsek (a === b), pak bližší úseky — deterministické.
        raw.push({
          sequence: insertAtGaps(base, a, b, pickup, dropoff),
          order: [a === b ? 0 : 1, Math.abs(b - a), a, b],
          zeroDetour: false,
        });
      }
    }
  } else if (iPickup !== -1 && iDropoff === -1) {
    for (let b = iPickup + 1; b <= n; b++) {
      raw.push({ sequence: insertAtGap(base, b, dropoff), order: [0, b, b, b], zeroDetour: false });
    }
  } else if (iPickup === -1 && iDropoff !== -1) {
    for (let a = 0; a <= iDropoff; a++) {
      raw.push({ sequence: insertAtGap(base, a, pickup), order: [0, a, a, a], zeroDetour: false });
    }
  } else if (iPickup < iDropoff) {
    raw.push({ sequence: [...base], order: [0, 0, 0, 0], zeroDetour: true });
  }

  raw.sort((left, right) =>
    left.order[0] - right.order[0] ||
    left.order[1] - right.order[1] ||
    left.order[2] - right.order[2] ||
    left.order[3] - right.order[3]
  );

  const seen = new Set<string>();
  const variants: InsertionVariant[] = [];
  for (const item of raw) {
    const pPickup = item.sequence.indexOf(pickup);
    const pDropoff = item.sequence.indexOf(dropoff);
    // Nakládka musí předcházet vykládce i v cílovém pořadí.
    if (pPickup < 0 || pDropoff < 0 || pPickup >= pDropoff) continue;
    const key = item.sequence.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({ sequence: item.sequence, key, zeroDetour: item.zeroDetour });
  }
  return variants;
}

/** Postaví tělo Compute Routes pro celou plánovanou trasu varianty. */
export function buildVariantRouteBody(sequence: string[]) {
  const origin = sequence[0];
  const destination = sequence[sequence.length - 1];
  const intermediates = sequence.slice(1, -1);

  const body: Record<string, unknown> = {
    origin: { placeId: origin },
    destination: { placeId: destination },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    units: "METRIC",
    languageCode: "cs",
    regionCode: "cz",
  };

  // Průjezdní body včetně vložených míst zůstávají v přesném pořadí; Google
  // nesmí zastávky přehazovat (optimizeWaypointOrder musí být false).
  if (intermediates.length > 0) {
    body.intermediates = intermediates.map((placeId) => ({ placeId }));
    body.optimizeWaypointOrder = false;
  }

  return body;
}

/** Zpětně kompatibilní obal: tělo pro nejlepší (první) variantu kandidáta. */
export function buildMatchingRouteBody(candidate: MatchingCandidate) {
  const variant = enumerateInsertionVariants(candidate)[0];
  return buildVariantRouteBody(variant ? variant.sequence : buildRoutePlanningPoints(candidate));
}

/**
 * Body pro Route Matrix: celá plánovaná trasa + místa poptávky, bez duplicit.
 * Pořadí odpovídá indexům v odpovědi matrixu.
 */
export function buildMatrixPoints(candidate: MatchingCandidate): string[] {
  const points = buildRoutePlanningPoints(candidate);
  const seen = new Set(points);
  for (const extra of [candidate.request_origin_place_id, candidate.request_destination_place_id]) {
    if (!seen.has(extra)) {
      seen.add(extra);
      points.push(extra);
    }
  }
  return points;
}

export function buildMatchingMatrixBody(points: string[]) {
  return {
    origins: points.map((placeId) => ({ waypoint: { placeId } })),
    destinations: points.map((placeId) => ({ waypoint: { placeId } })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    units: "METRIC",
  };
}

export type MatrixLeg = { distanceMeters: number; durationSeconds: number };

/** Tabulka vzdáleností/dob mezi body; klíč je `od>do`. */
export type MatrixTable = Record<string, MatrixLeg>;

function matrixKey(from: string, to: string) {
  return `${from}>${to}`;
}

/**
 * Převede odpověď Route Matrix na tabulku. Neúplné nebo neplatné elementy se
 * zahazují; když není použitelný ani jeden, vrací `null` (volající spadne zpět
 * na deterministické pořadí a označí výsledek jako neúplný).
 */
export function parseMatchingMatrix(payload: unknown, points: string[]): MatrixTable | null {
  if (!Array.isArray(payload)) return null;
  const table: MatrixTable = {};
  let usable = 0;
  for (const element of payload) {
    if (!element || typeof element !== "object") continue;
    const row = element as Record<string, unknown>;
    const originIndex = row.originIndex;
    const destinationIndex = row.destinationIndex;
    if (typeof originIndex !== "number" || typeof destinationIndex !== "number") continue;
    if (!Number.isInteger(originIndex) || !Number.isInteger(destinationIndex)) continue;
    if (originIndex < 0 || destinationIndex < 0 || originIndex >= points.length || destinationIndex >= points.length) continue;
    if (row.condition !== undefined && row.condition !== "ROUTE_EXISTS") continue;
    const distance = row.distanceMeters;
    const duration = parseDurationSeconds(row.duration);
    if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) continue;
    if (duration === null) continue;
    table[matrixKey(points[originIndex], points[destinationIndex])] = {
      distanceMeters: Math.round(distance),
      durationSeconds: duration,
    };
    usable += 1;
  }
  return usable > 0 ? table : null;
}

function approximateSequence(sequence: string[], table: MatrixTable): { distanceMeters: number; durationSeconds: number } | null {
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (let index = 1; index < sequence.length; index++) {
    const leg = table[matrixKey(sequence[index - 1], sequence[index])];
    if (!leg) return null;
    distanceMeters += leg.distanceMeters;
    durationSeconds += leg.durationSeconds;
  }
  return { distanceMeters, durationSeconds };
}

/**
 * Z hrubé tabulky odhadne zajížďku varianty vůči základní trase.
 * Jde o bodová data (ne skutečnou geometrii), proto slouží jen k seřazení
 * variant před přesným ověřením, nikdy jako výsledná shoda.
 */
export function approximateVariantDetour(base: string[], sequence: string[], table: MatrixTable): VariantDetour | null {
  const baseMetrics = approximateSequence(base, table);
  const variantMetrics = approximateSequence(sequence, table);
  if (!baseMetrics || !variantMetrics) return null;
  return {
    detourDistanceMeters: Math.max(0, variantMetrics.distanceMeters - baseMetrics.distanceMeters),
    detourDurationSeconds: Math.max(0, variantMetrics.durationSeconds - baseMetrics.durationSeconds),
  };
}

/**
 * Seřadí varianty podle hrubé zajížďky z matrixu: nejmenší odhad vzdálenosti,
 * při shodě kratší odhad času, při další shodě stabilní klíč. Varianty, které
 * matrix neumí ohodnotit, jdou na konec v původním (deterministickém) pořadí.
 */
export function rankVariantsByApproximation(base: string[], variants: InsertionVariant[], table: MatrixTable): InsertionVariant[] {
  const scored = variants.map((variant, index) => ({
    variant,
    index,
    approx: approximateVariantDetour(base, variant.sequence, table),
  }));
  scored.sort((left, right) => {
    if (left.approx && right.approx) {
      return left.approx.detourDistanceMeters - right.approx.detourDistanceMeters ||
        left.approx.detourDurationSeconds - right.approx.detourDurationSeconds ||
        left.variant.key.localeCompare(right.variant.key);
    }
    if (left.approx) return -1;
    if (right.approx) return 1;
    return left.index - right.index;
  });
  return scored.map((item) => item.variant);
}

// ---------------------------------------------------------------------------
// Polohový předvýběr a seřazení variant ze soukromých souřadnic
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6371008.8;


function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

/**
 * Vzdálenost dvou souřadnic po povrchu Země (haversine). Slouží jen k hrubému
 * řazení variant vložení; rozhoduje vždy přesné Compute Routes.
 */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Mapa place ID → soukromá souřadnice pro celou trasu i místa poptávky.
 * Vrací `null`, jakmile chybí jakákoli souřadnice — pak se polohová cesta
 * nepoužije (žádné částečné odhady z neúplných dat).
 */
export function buildRouteCoordinateMap(candidate: MatchingCandidate): Record<string, Coordinate> | null {
  const map: Record<string, Coordinate> = {};
  const routePoints: Array<{ id: string; lat: number | null; lng: number | null }> = [
    { id: candidate.route_origin_place_id, lat: candidate.route_origin_lat, lng: candidate.route_origin_lng },
  ];
  candidate.route_via_place_ids.forEach((id, index) => {
    routePoints.push({
      id,
      lat: candidate.route_via_latitudes ? candidate.route_via_latitudes[index] ?? null : null,
      lng: candidate.route_via_longitudes ? candidate.route_via_longitudes[index] ?? null : null,
    });
  });
  routePoints.push({ id: candidate.route_destination_place_id, lat: candidate.route_destination_lat, lng: candidate.route_destination_lng });

  for (const point of routePoints) {
    if (point.lat === null || point.lng === null) return null;
    map[point.id] = { latitude: point.lat, longitude: point.lng };
  }
  if (
    candidate.request_pickup_lat === null || candidate.request_pickup_lng === null ||
    candidate.request_destination_lat === null || candidate.request_destination_lng === null
  ) {
    return null;
  }
  map[candidate.request_origin_place_id] = { latitude: candidate.request_pickup_lat, longitude: candidate.request_pickup_lng };
  map[candidate.request_destination_place_id] = { latitude: candidate.request_destination_lat, longitude: candidate.request_destination_lng };
  return map;
}

function approximateSequenceByCoordinates(sequence: string[], map: Record<string, Coordinate>): number | null {
  let distanceMeters = 0;
  for (let index = 1; index < sequence.length; index++) {
    const from = map[sequence[index - 1]];
    const to = map[sequence[index]];
    if (!from || !to) return null;
    distanceMeters += haversineMeters(from, to);
  }
  return distanceMeters;
}

/** Hrubá zajížďka varianty z havérsine délek; `null` když mapa není úplná. */
export function approximateVariantDetourByCoordinates(
  map: Record<string, Coordinate>,
  base: string[],
  sequence: string[],
): VariantDetour | null {
  const baseDistance = approximateSequenceByCoordinates(base, map);
  const variantDistance = approximateSequenceByCoordinates(sequence, map);
  if (baseDistance === null || variantDistance === null) return null;
  return {
    detourDistanceMeters: Math.max(0, variantDistance - baseDistance),
    detourDurationSeconds: 0,
  };
}

/**
 * Seřadí varianty vložení podle hrubé havérsine zajížďky (nejmenší první),
 * při shodě stabilně podle klíče. Neohodnotitelné varianty jdou na konec
 * v původním pořadí.
 */
export function rankVariantsByCoordinates(
  map: Record<string, Coordinate>,
  base: string[],
  variants: InsertionVariant[],
): InsertionVariant[] {
  const scored = variants.map((variant, index) => ({
    variant,
    index,
    approx: approximateVariantDetourByCoordinates(map, base, variant.sequence),
  }));
  scored.sort((left, right) => {
    if (left.approx && right.approx) {
      return left.approx.detourDistanceMeters - right.approx.detourDistanceMeters || left.variant.key.localeCompare(right.variant.key);
    }
    if (left.approx) return -1;
    if (right.approx) return 1;
    return left.index - right.index;
  });
  return scored.map((item) => item.variant);
}

/**
 * Vrátí efektivní práh odchylky v kilometrech.
 *
 * Kladná, vyplněná hodnota se použije tak, jak ji přepravce zadal. Chybějící
 * hodnota (`null`) nebo záporná/nekonečná padá na `DEFAULT_MAX_DEVIATION_KM`,
 * aby se nezměnila v práh 0 m, který by odfiltroval všechny kandidáty.
 */
export function resolveMaxDeviationKm(candidate: MatchingCandidate): number {
  const value = candidate?.max_deviation_km;
  if (value === null || value === undefined) return DEFAULT_MAX_DEVIATION_KM;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MAX_DEVIATION_KM;
  return value;
}

/**
 * Rozhodne, zda vypočtená zajížďka spadá do povolené odchylky.
 * Porovnává se vzdálenost, ne čas — časová odchylka závisí na dopravě.
 */
export function isWithinDeviation(
  metrics: { detourDistanceMeters: number } | null,
  candidate: MatchingCandidate,
): boolean {
  if (!metrics) return false;
  return metrics.detourDistanceMeters <= resolveMaxDeviationKm(candidate) * 1000;
}

/** Z odpovědi Google vytáhne pouze vzdálenost a dobu; jinak `null`. */
export function normalizeVariantComputation(payload: unknown): VariantComputation | null {
  if (!payload || typeof payload !== "object") return null;
  const routes = (payload as Record<string, unknown>).routes;
  if (!Array.isArray(routes) || !routes[0] || typeof routes[0] !== "object") return null;
  const route = routes[0] as Record<string, unknown>;
  const distance = route.distanceMeters;
  const duration = parseDurationSeconds(route.duration);
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0 || duration === null) return null;
  return { distanceMeters: Math.round(distance), durationSeconds: duration };
}

/**
 * Zajížďka varianty vůči základní trase.
 *
 * Obě hodnoty se počítají za stejných podmínek (TRAFFIC_UNAWARE, stejné place
 * ID). Drobné záporné rozdíly ze zaokrouhlení se srovnají na nulu, ale
 * materiálně kratší varianta (rozdíl větší než tolerance) znamená
 * nesrovnatelné údaje a je odmítnuta, aby nevznikla falešná shoda.
 */
export function computeVariantDetour(
  candidate: MatchingCandidate,
  computation: VariantComputation | null,
): VariantDetour | null {
  if (!computation) return null;
  const { distanceMeters, durationSeconds } = computation;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  if (!Number.isFinite(candidate.route_distance_meters) || candidate.route_distance_meters < 0) return null;

  const rawDistance = Math.round(distanceMeters) - candidate.route_distance_meters;
  if (rawDistance < -DETOUR_DISTANCE_TOLERANCE_METERS) return null;

  const rawDuration = Math.round(durationSeconds) - candidate.route_duration_seconds;
  return {
    detourDistanceMeters: Math.max(0, rawDistance),
    detourDurationSeconds: Math.max(0, rawDuration),
  };
}

/** Sestaví finální bezpečný objekt shody ze zajížďky. */
export function buildMatchFromDetour(candidate: MatchingCandidate, detour: VariantDetour): MatchingMetrics {
  const detourKm = detour.detourDistanceMeters / 1000;
  const detourMinutes = detour.detourDurationSeconds / 60;
  const score = Math.max(0, Math.round(110 - detourKm * 2 - detourMinutes / 10));
  return {
    requestId: candidate.request_id,
    detourDistanceMeters: Math.round(detour.detourDistanceMeters),
    detourDurationSeconds: Math.round(detour.detourDurationSeconds),
    score,
    reasons: [
      `+${Math.round(detour.detourDistanceMeters / 1000)} km / ${Math.max(1, Math.round(detour.detourDurationSeconds / 60))} min`,
      "termín souhlasí",
      "vhodný typ vozidla",
      "dostatečná kapacita",
    ],
  };
}

/**
 * Zpětně kompatibilní obal nad `normalizeVariantComputation` + `computeVariantDetour`.
 * Vrací `null`, když odpověď chybí, je neplatná nebo je materiálně nesrovnatelná.
 */
export function normalizeMatchingMetrics(
  payload: unknown,
  candidate: MatchingCandidate,
  _variant?: InsertionVariant,
): MatchingMetrics | null {
  const detour = computeVariantDetour(candidate, normalizeVariantComputation(payload));
  if (!detour) return null;
  return buildMatchFromDetour(candidate, detour);
}

export type EvaluatedVariant = { variant: InsertionVariant; match: MatchingMetrics };

/**
 * Vybere nejlepší vyhodnocenou variantu: nejmenší dodatečná vzdálenost, při
 * shodě kratší dodatečný čas, při další shodě stabilně podle klíče varianty.
 * Deterministické pro stejný vstup.
 */
export function selectBestVariantMatch(evaluated: EvaluatedVariant[]): EvaluatedVariant | null {
  const sorted = evaluated
    .filter((item) => item && item.match)
    .slice()
    .sort((left, right) =>
      left.match.detourDistanceMeters - right.match.detourDistanceMeters ||
      left.match.detourDurationSeconds - right.match.detourDurationSeconds ||
      left.variant.key.localeCompare(right.variant.key)
    );
  return sorted[0] ?? null;
}
