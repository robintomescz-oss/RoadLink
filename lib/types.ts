export type Role = "customer" | "driver";
export type RequestViewMode = "owner" | "provider";
export type TimePreference =
  | "asap"
  | "within_24h"
  | "within_3_days"
  | "within_week"
  | "specific";
export type VehicleMobility =
  | "drivable"
  | "partially_drivable"
  | "not_drivable"
  | "unknown";
export type TimeFilter = "all" | TimePreference;
export type SortOption = "urgent" | "newest";
export type JobStatus =
  | "open"
  | "offer_selected"
  | "in_progress"
  | "completed"
  | "cancelled";

export type PickupCoordinates = { latitude: number; longitude: number };

export type Job = {
  id: string;
  customerName: string;
  customerId?: string;
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
  requestedEndDate?: string | null;
  requestedTime?: string | null;
  vehicleMobility?: VehicleMobility;
  vehicleModel?: string | null;
  canTrailer?: boolean | null;
  createdAt?: string;
};

export type CarrierRoute = {
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

export type TowOffer = {
  id: string;
  tow_request_id: string;
  driver_id: string;
  price: number | null;
  estimated_arrival_minutes: number;
  estimated_arrival_at: string | null;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
};

export type ProviderIdentity = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
};

export type OfferProviderProfile = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
  business_type: string | null;
  ico: string | null;
  description: string | null;
  service_area: string | null;
  max_radius_km: number | null;
  years_experience: number | null;
  available_24_7: boolean;
  public_phone: string | null;
  public_email: string | null;
};

export type AcceptedJob = Job & {
  acceptedOffer: TowOffer;
};

export type UserProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: Role;
  email: string;
};

export type CarrierProfile = {
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
  public_phone: string | null;
  public_email: string | null;
  status: string | null;
};

export type CarrierVehicle = {
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
