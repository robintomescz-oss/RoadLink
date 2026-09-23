import type { CarrierProfile } from "./types";

export type VehicleFormValues = {
  name: string;
  type: string;
  make: string;
  model: string;
  year: string;
  registrationNumber: string;
  maxWeight: string;
  maxLength: string;
  maxWidth: string;
  maxHeight: string;
  capacity: string;
  description: string;
  hasWinch: boolean;
  hasHydraulicPlatform: boolean;
  hasRamps: boolean;
  hasStraps: boolean;
  hasJumpStarter: boolean;
  hasCompressor: boolean;
  isActive: boolean;
};

type VehicleNumericInput = Pick<VehicleFormValues, "year" | "maxWeight" | "maxLength" | "maxWidth" | "maxHeight" | "capacity">;

export function mapCarrierProfileToFormFields(row: CarrierProfile) {
  return {
    displayName: row.display_name || "",
    businessType: row.business_type || "individual",
    companyName: row.company_name || "",
    ico: row.ico || "",
    description: row.description || "",
    serviceArea: row.service_area || "",
    maxRadius: row.max_radius_km?.toString() || "",
    yearsExperience: row.years_experience?.toString() || "",
    available247: row.available_24_7 || false,
    phonePublic: row.phone_public ?? true,
    emailPublic: row.email_public ?? false,
    publicPhone: row.public_phone || "",
    publicEmail: row.public_email || "",
  };
}

export function parseVehicleNumericFields(values: VehicleNumericInput) {
  const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
  const year = toNumber(values.year);
  const maxWeight = toNumber(values.maxWeight);
  const maxLength = toNumber(values.maxLength);
  const maxWidth = toNumber(values.maxWidth);
  const maxHeight = toNumber(values.maxHeight);
  const capacity = toNumber(values.capacity);
  const numericValues = [year, maxWeight, maxLength, maxWidth, maxHeight];
  const allValid = !numericValues.some((value) => value !== null && !Number.isFinite(value));
  return { year, maxWeight, maxLength, maxWidth, maxHeight, capacity, allValid };
}

export function buildVehiclePayload(values: VehicleFormValues): Record<string, unknown> {
  const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
  return {
    name: values.name.trim(),
    vehicle_type: values.type.trim(),
    make: values.make.trim() || null,
    model: values.model.trim() || null,
    year: toNumber(values.year),
    registration_number: values.registrationNumber.trim() || null,
    max_weight_kg: toNumber(values.maxWeight),
    max_vehicle_length_cm: toNumber(values.maxLength),
    max_vehicle_width_cm: toNumber(values.maxWidth),
    max_vehicle_height_cm: toNumber(values.maxHeight),
    capacity: toNumber(values.capacity),
    description: values.description.trim() || null,
    has_winch: values.hasWinch,
    has_hydraulic_platform: values.hasHydraulicPlatform,
    has_ramps: values.hasRamps,
    has_straps: values.hasStraps,
    has_jump_starter: values.hasJumpStarter,
    has_compressor: values.hasCompressor,
    is_active: values.isActive,
  };
}

export function parseCarrierProfilePublicContact(
  maxRadiusText: string,
  yearsExperienceText: string,
  publicPhoneText: string,
  publicEmailText: string,
) {
  const maxRadius = maxRadiusText.trim() === "" ? null : Number(maxRadiusText);
  const yearsExperience = yearsExperienceText.trim() === "" ? null : Number(yearsExperienceText);
  const publicPhone = publicPhoneText.trim() || null;
  const publicEmail = publicEmailText.trim().toLowerCase() || null;
  const numbersValid = !((maxRadius !== null && !Number.isFinite(maxRadius)) || (yearsExperience !== null && !Number.isFinite(yearsExperience)));
  const emailValid = !(publicEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail));
  return { maxRadius, yearsExperience, publicPhone, publicEmail, numbersValid, emailValid };
}
