export type PublicMarketplaceRequest = {
  public_id: string;
  item_type: "tow_request";
  origin_label: string | null;
  destination_label: string | null;
  vehicle_type: string | null;
  vehicle_mobility: string | null;
  requested_date: string | null;
  date_to: string | null;
  time_preference: string | null;
  created_at: string;
  status: "open";
};

export type PublicMarketplaceRoute = {
  public_id: string;
  item_type: "carrier_route";
  origin_label: string | null;
  destination_label: string | null;
  vehicle_types: string[] | null;
  departure_at: string | null;
  available_spaces: number | null;
  price: number | null;
  created_at: string;
  status: "open";
};

export type PublicMarketplaceForbiddenField =
  | "customer_id"
  | "driver_id"
  | "pickup_address"
  | "destination_address"
  | "from_address"
  | "to_address"
  | "pickup_lat"
  | "pickup_lng"
  | "destination_lat"
  | "destination_lng"
  | "from_lat"
  | "from_lng"
  | "to_lat"
  | "to_lng"
  | "problem_description"
  | "description"
  | "offer"
  | "offers"
  | "tow_offers";

export const PUBLIC_MARKETPLACE_FORBIDDEN_FIELDS: PublicMarketplaceForbiddenField[] = [
  "customer_id",
  "driver_id",
  "pickup_address",
  "destination_address",
  "from_address",
  "to_address",
  "pickup_lat",
  "pickup_lng",
  "destination_lat",
  "destination_lng",
  "from_lat",
  "from_lng",
  "to_lat",
  "to_lng",
  "problem_description",
  "description",
  "offer",
  "offers",
  "tow_offers",
];

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/i;
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;
const PHONE_RE = /(?:\+?\d[\s().-]*){7,}/;

export function normalizePublicLocationLabel(value: string) {
  return value.trim();
}

export function validatePublicLocationLabel(value: string) {
  const normalized = normalizePublicLocationLabel(value);
  if (!normalized) return { valid: false, value: normalized, error: "Vyplňte veřejně zobrazitelné město/obec." };
  if (normalized.length > 80) return { valid: false, value: normalized, error: "Veřejný název místa může mít nejvýše 80 znaků." };
  if (EMAIL_RE.test(normalized)) return { valid: false, value: normalized, error: "Veřejné místo nesmí obsahovat e-mail." };
  if (URL_RE.test(normalized)) return { valid: false, value: normalized, error: "Veřejné místo nesmí obsahovat URL adresu." };
  if (PHONE_RE.test(normalized)) return { valid: false, value: normalized, error: "Veřejné místo nesmí obsahovat telefonní číslo." };
  return { valid: true, value: normalized, error: null };
}

function assertNoForbiddenFields(row: Record<string, unknown>) {
  const present = PUBLIC_MARKETPLACE_FORBIDDEN_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(row, field));
  if (present.length > 0) {
    throw new Error(`Public marketplace payload contains forbidden field(s): ${present.join(", ")}`);
  }
}

export function publicLabelOrFallback(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "Oblast neuvedena";
}

export function mapPublicMarketplaceRequest(row: Record<string, unknown>): PublicMarketplaceRequest {
  assertNoForbiddenFields(row);
  return {
    public_id: String(row.public_id),
    item_type: "tow_request",
    origin_label: typeof row.origin_label === "string" ? row.origin_label : null,
    destination_label: typeof row.destination_label === "string" ? row.destination_label : null,
    vehicle_type: typeof row.vehicle_type === "string" ? row.vehicle_type : null,
    vehicle_mobility: typeof row.vehicle_mobility === "string" ? row.vehicle_mobility : null,
    requested_date: typeof row.requested_date === "string" ? row.requested_date : null,
    date_to: typeof row.date_to === "string" ? row.date_to : null,
    time_preference: typeof row.time_preference === "string" ? row.time_preference : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    status: "open",
  };
}

export function mapPublicMarketplaceRoute(row: Record<string, unknown>): PublicMarketplaceRoute {
  assertNoForbiddenFields(row);
  return {
    public_id: String(row.public_id),
    item_type: "carrier_route",
    origin_label: typeof row.origin_label === "string" ? row.origin_label : null,
    destination_label: typeof row.destination_label === "string" ? row.destination_label : null,
    vehicle_types: Array.isArray(row.vehicle_types) ? row.vehicle_types.filter((value): value is string => typeof value === "string") : null,
    departure_at: typeof row.departure_at === "string" ? row.departure_at : null,
    available_spaces: typeof row.available_spaces === "number" ? row.available_spaces : null,
    price: typeof row.price === "number" ? row.price : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    status: "open",
  };
}

export function shouldShowPublicMarketEmptyState(loading: boolean, error: string | null, totalItems: number) {
  return !loading && !error && totalItems === 0;
}

function publicFilterText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function filterPublicRequests(
  requests: PublicMarketplaceRequest[],
  fromFilter: string,
  toFilter: string,
  vehicleFilter: string,
) {
  const from = publicFilterText(fromFilter);
  const to = publicFilterText(toFilter);
  return requests
    .filter((request) => !from || publicFilterText(request.origin_label).includes(from))
    .filter((request) => !to || publicFilterText(request.destination_label).includes(to))
    .filter((request) => vehicleFilter === "all" || publicFilterText(request.vehicle_type) === publicFilterText(vehicleFilter));
}

export function filterPublicRoutes(
  routes: PublicMarketplaceRoute[],
  fromFilter: string,
  toFilter: string,
  vehicleFilter: string,
) {
  const from = publicFilterText(fromFilter);
  const to = publicFilterText(toFilter);
  return routes
    .filter((route) => !from || publicFilterText(route.origin_label).includes(from))
    .filter((route) => !to || publicFilterText(route.destination_label).includes(to))
    .filter((route) => vehicleFilter === "all" || (route.vehicle_types || []).map(publicFilterText).includes(publicFilterText(vehicleFilter)));
}

export function publicCardAuthTarget(userId: string | null) {
  return userId ? "authorized-detail" : "login";
}
