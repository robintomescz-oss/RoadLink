/**
 * Logika osobních vozidel — čisté funkce bez Reactu a bez síťových volání.
 *
 * Osobní vozidla jsou soukromá a slouží jen k rychlému předvyplnění SOS
 * formuláře. Nikdy se nesmí dostat do přepravního trhu, nabídky kapacity
 * ani matchingu — to hlídá `.roadlink/personal-vehicles-regression.js`.
 *
 * Motivace normalizace: formuláře posílají text z klávesnice, který mívá
 * okrajové mezery a prázdné řetězce. Bez `trim` by se do databáze uložila
 * hodnota `"   "`, která prohlížeč zobrazí jako prázdné pole.
 */

/** Možné pohony. `'jine'` je neutrální stav, ne chybějící údaj. */
export const PERSONAL_FUEL_TYPES = ["benzin", "nafta", "elektro", "hybrid", "lpg", "cng", "jine"] as const;

export type PersonalFuelType = (typeof PERSONAL_FUEL_TYPES)[number];

export const PERSONAL_FUEL_TYPE_LABELS: Record<PersonalFuelType, string> = {
  benzin: "Benzín",
  nafta: "Nafta",
  elektro: "Elektro",
  hybrid: "Hybrid",
  lpg: "LPG",
  cng: "CNG",
  jine: "Jiný nebo nevím",
};

export const PERSONAL_FUEL_TYPE_OPTIONS: Array<{ value: PersonalFuelType; label: string }> = PERSONAL_FUEL_TYPES.map(
  (value) => ({ value, label: PERSONAL_FUEL_TYPE_LABELS[value] }),
);

const MAX_NICKNAME = 60;
const MAX_MAKE = 60;
const MAX_MODEL = 60;
const MAX_REGISTRATION = 10;
const MAX_INSURANCE_PROVIDER = 80;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export type PersonalVehicleInput = {
  nickname: string;
  make: string;
  model: string;
  year?: number | string | null;
  fuelType?: string | null;
  registration?: string | null;
  insuranceProvider?: string | null;
};

export type PersonalVehicle = {
  nickname: string;
  make: string;
  model: string;
  year: number | null;
  fuelType: PersonalFuelType | null;
  registration: string | null;
  insuranceProvider: string | null;
};

/** Ořízne text; prázdný řetězec a whitespace-only se normalizují na `null`. */
function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > maxLength ? null : trimmed;
}

/** Rok musí být celé číslo v rozsahu; prázdná hodnota je legitimní `null`. */
function normalizeYear(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(numeric)) return undefined;
  if (numeric < MIN_YEAR || numeric > MAX_YEAR) return undefined;
  return numeric;
}

/**
 * Normalizuje vstup z formuláře na data k uložení.
 *
 * Vrací `null`, pokud jsou povinná pole prázdná nebo hodnota mimo povolený
 * rozsah — uložení vadného vozidla je horší než odmítnutí. Chybu konkrétního
 * pole zobrazí formulář, ne tato funkce.
 */
export function normalizePersonalVehicle(input: PersonalVehicleInput | null | undefined): PersonalVehicle | null {
  if (!input) return null;

  const nickname = cleanText(input.nickname, MAX_NICKNAME);
  const make = cleanText(input.make, MAX_MAKE);
  const model = cleanText(input.model, MAX_MODEL);
  if (nickname === null || make === null || model === null) return null;

  const year = normalizeYear(input.year);
  if (year === undefined) return null;

  let fuelType: PersonalFuelType | null = null;
  if (input.fuelType !== null && input.fuelType !== undefined && String(input.fuelType).trim() !== "") {
    const candidate = String(input.fuelType).trim() as PersonalFuelType;
    if (!PERSONAL_FUEL_TYPES.includes(candidate)) return null;
    fuelType = candidate;
  }

  const registration = cleanText(input.registration, MAX_REGISTRATION);
  const insuranceProvider = cleanText(input.insuranceProvider, MAX_INSURANCE_PROVIDER);

  return { nickname, make, model, year, fuelType, registration, insuranceProvider };
}

/** Tvar, který jde uložit do sloupců `personal_vehicles`. */
export function buildPersonalVehiclePayload(input: PersonalVehicleInput | null | undefined) {
  const vehicle = normalizePersonalVehicle(input);
  if (!vehicle) return null;
  return {
    nickname: vehicle.nickname,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    fuel_type: vehicle.fuelType,
    registration: vehicle.registration,
    insurance_provider: vehicle.insuranceProvider,
  };
}

/** Řádek z databáze na tvar pro UI; poškozený řádek se přeskočí. */
export function mapPersonalVehicleRow(row: Record<string, unknown> | null | undefined): PersonalVehicle | null {
  if (!row) return null;
  return normalizePersonalVehicle({
    nickname: String(row.nickname ?? ""),
    make: String(row.make ?? ""),
    model: String(row.model ?? ""),
    year: row.year as number | null,
    fuelType: row.fuel_type as string | null,
    registration: row.registration as string | null,
    insuranceProvider: row.insurance_provider as string | null,
  });
}

/** Zobrazovaný název: „Škoda Octavia“, jinak značka + model. */
export function personalVehicleDisplayLabel(vehicle: PersonalVehicle | null | undefined): string {
  if (!vehicle) return "";
  const name = `${vehicle.make} ${vehicle.model}`.trim();
  return vehicle.nickname.trim() || name;
}

/**
 * Předvyplnění SOS formuláře.
 *
 * Záměrně NEobsahuje `id` ani `user_id`: do SOS stavu se ukládá jen popis
 * vozidla, kterýAssistenci stačí a který neumožňuje odkázat na cizí záznam.
 * `registration` je prázdný řetězec, ne `null`, aby zůstal editovatelný.
 */
export function toSosVehicleInput(vehicle: PersonalVehicle | null | undefined) {
  if (!vehicle) return null;
  return {
    source: "profile" as const,
    label: personalVehicleDisplayLabel(vehicle),
    make: vehicle.make,
    model: vehicle.model,
    registration: vehicle.registration ?? "",
  };
}
