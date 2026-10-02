/**
 * Čistá logika Google Routes pro Edge Function `google-routes`.
 *
 * Modul záměrně nepoužívá žádné Deno/Node API ani nečte API klíč — jde proto
 * transpilovat a testovat izolovaně (.roadlink/route-metrics-regression.js).
 * Klíč i síťové volání řeší až index.ts, a to výhradně ze serverového secretu.
 *
 * Kontrakt: klient posílá pouze dvě ověřená place ID. Cílovou URL, hlavičky ani
 * field mask klient nikdy nedodává — jsou zde pevně dané.
 */

export const ROUTES_COMPUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Pevný field mask: vracíme jen vzdálenost a dobu, nikdy geometrii ani adresy. */
export const ROUTES_FIELD_MASK = "routes.distanceMeters,routes.duration";

/** Rozumný timeout pro jedno volání Google Routes (8 s). */
export const ROUTES_TIMEOUT_MS = 8000;

export const MAX_PLACE_ID_LENGTH = 255;

/**
 * Kolik průjezdních bodů smí trasa obsahovat (např. "Cheb → Praha přes Plzeň").
 * Odpovídá check constraintu `carrier_routes_via_place_ids_len` v databázi.
 */
export const MAX_VIA_PLACES = 3;

/** Stejná validace place ID jako v google-places — place ID je neprůhledný token. */
const PLACE_ID_RE = /^[A-Za-z0-9_.-]+$/;

export type RouteRequestInput = {
  originPlaceId: string;
  destinationPlaceId: string;
  /** Průjezdní body v pořadí, ve kterém je přepravce zadal. */
  viaPlaceIds?: string[];
};

export type RouteMetrics = {
  distanceMeters: number;
  durationSeconds: number;
};

export type RouteErrorCode =
  | "invalid_request"
  | "no_route"
  | "rate_limited"
  | "upstream_unavailable";

export type RouteFailure = {
  status: number;
  code: RouteErrorCode;
  message: string;
};

export type RouteRequestValidation =
  | { ok: true; value: RouteRequestInput }
  | { ok: false; status: number; code: RouteErrorCode; message: string };

function normalizedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Vrátí platné place ID, nebo null. Nikdy nevyhazuje a nikdy neloguje vstup.
 * Příliš dlouhý vstup se záměrně odmítá (nezkracuje se) — zkrácené place ID
 * by tiše ukazovalo na jiné místo.
 */
export function normalizePlaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const placeId = value.trim();
  if (!placeId || placeId.length > MAX_PLACE_ID_LENGTH) return null;
  if (!PLACE_ID_RE.test(placeId)) return null;
  return placeId;
}

/**
 * Ověří a normalizuje průjezdní body.
 *
 * Vrací `null` (odmítnutí), pokud je vstup rozbitý, překročí limit, obsahuje
 * neplatné place ID, duplikát, nebo bod shodný s odjezdem/cílem. Prázdné pole
 * znamená přímou trasu, a proto je legitimní.
 */
function normalizeViaPlaceIds(value: unknown, originPlaceId: string, destinationPlaceId: string): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  // Prázdné pole odpovídá trase bez průjezdu; neplníme ho ničím.
  if (value.length === 0) return [];

  if (value.length > MAX_VIA_PLACES) return null;

  const normalized: string[] = [];
  for (const entry of value) {
    const placeId = normalizePlaceId(entry);
    if (!placeId) return null;
    // Průjezdní bod shodný s odjezdem, cílem nebo jiným průjezdním bodem
    // by dal zbytečně dlouhou trasu bez smyslu.
    if (placeId === originPlaceId || placeId === destinationPlaceId) return null;
    if (normalized.includes(placeId)) return null;
    normalized.push(placeId);
  }

  return normalized;
}

/** Ověří tělo požadavku. Chyby jsou obecné — nikdy neopakují vstup klienta. */
export function validateRouteRequest(body: unknown): RouteRequestValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, code: "invalid_request", message: "Request body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;
  const originPlaceId = normalizePlaceId(record.originPlaceId);
  const destinationPlaceId = normalizePlaceId(record.destinationPlaceId);

  if (!originPlaceId || !destinationPlaceId) {
    return { ok: false, status: 400, code: "invalid_request", message: "Both origin and destination must be valid place IDs" };
  }

  if (originPlaceId === destinationPlaceId) {
    return { ok: false, status: 400, code: "invalid_request", message: "Origin and destination must differ" };
  }

  const viaPlaceIds = normalizeViaPlaceIds(record.viaPlaceIds, originPlaceId, destinationPlaceId);
  if (viaPlaceIds === null) {
    return { ok: false, status: 400, code: "invalid_request", message: "Via points must be distinct valid place IDs" };
  }

  return { ok: true, value: { originPlaceId, destinationPlaceId, viaPlaceIds } };
}

/** Pevné tělo pro Compute Routes. Žádná pole od klienta se nepřeposílají. */
export function buildComputeRoutesBody(input: RouteRequestInput) {
  const viaPlaceIds = input.viaPlaceIds ?? [];

  const body: Record<string, unknown> = {
    origin: { placeId: input.originPlaceId },
    destination: { placeId: input.destinationPlaceId },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    units: "METRIC",
    languageCode: "cs",
    regionCode: "cz",
  };

  // Přímá trasa neposílá `intermediates` vůbec — prázdné pole by Google
  // zbytečně zpracovával a klient by nemohl pozorovat rozdíl.
  if (viaPlaceIds.length > 0) {
    body.intermediates = viaPlaceIds.map((placeId) => ({ placeId }));
    // Přepravce si pořadí průjezdu zvolil sám; optimalizace by je mohla přeházt.
    body.optimizeWaypointOrder = false;
  }

  return body;
}

/** Google vrací dobu jako řetězec "1234s"; číslo bereme jen jako záložní variantu. */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

/**
 * Z odpovědi Google vytáhne pouze normalizovanou vzdálenost a dobu.
 * Vrací null, když trasa neexistuje nebo odpověď nemá použitelná data.
 */
export function normalizeRouteMetrics(payload: unknown): RouteMetrics | null {
  if (!payload || typeof payload !== "object") return null;
  const routes = (payload as Record<string, unknown>).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const first = routes[0];
  if (!first || typeof first !== "object") return null;
  const route = first as Record<string, unknown>;

  const distance = route.distanceMeters;
  const durationSeconds = parseDurationSeconds(route.duration);

  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) return null;
  if (durationSeconds === null) return null;

  return { distanceMeters: Math.round(distance), durationSeconds };
}

/**
 * Mapování chyb Google na bezpečné kódy. Zprávu od Google nikdy nepropouštíme —
 * mohla by obsahovat adresu nebo jiná citlivá data.
 */
export function sanitizeRouteError(status: number): RouteFailure {
  if (status === 400) {
    return {
      status: 400,
      code: "invalid_request",
      message: "One of the selected places cannot be routed",
    };
  }
  if (status === 404) {
    return { status: 404, code: "no_route", message: "No drivable route was found" };
  }
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      message: "Route service is busy, try again later",
    };
  }
  return {
    status: 502,
    code: "upstream_unavailable",
    message: "Route service is temporarily unavailable",
  };
}
