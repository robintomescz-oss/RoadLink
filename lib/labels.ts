import type {
  Job,
  JobStatus,
  TimePreference,
  TowOffer,
  VehicleMobility,
} from "./types";

export function formatSupabaseError(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}) {
  return [error.message, error.code && `Kód: ${error.code}`, error.details && `Detaily: ${error.details}`, error.hint && `Nápověda: ${error.hint}`]
    .filter(Boolean)
    .join("\n");
}

export function pickupDisplayLabel(job: Job) {
  if (job.pickupAddress?.trim()) return job.pickupAddress.trim();
  if (job.pickup) return `${job.pickup.latitude.toFixed(5)}, ${job.pickup.longitude.toFixed(5)}`;
  return "Místo vyzvednutí neuvedeno";
}

export function routeDisplayLabel(job: Job) {
  return `Vyzvednutí ${pickupDisplayLabel(job)}  →  ${job.destination}`;
}

export function requestTimingLabel(job: Job) {
  if (job.requestedDate) {
    if (job.requestedEndDate && job.requestedEndDate !== job.requestedDate) {
      return formatDateRange(job.requestedDate, job.requestedEndDate);
    }
    if (job.timePreference === "specific") {
      const date = formatDate(job.requestedDate);
      const time = formatTime(job.requestedTime);
      return time ? `${date}, ${time}` : date || "Konkrétní termín";
    }
    const date = formatDate(job.requestedDate);
    if (date) return date;
  }
  return timePreferenceLabel(job.timePreference);
}

function formatDateRange(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.slice(0, 10).split("-").map(Number);
  const [toYear, toMonth, toDay] = to.slice(0, 10).split("-").map(Number);
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${fromDay}.–${toDay}. ${toMonth}. ${toYear}`;
  }
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function triStateLabel(value: boolean | null | undefined): string {
  if (value === true) return "Ano";
  if (value === false) return "Ne";
  return "Neví se";
}

export function mobilityOperableLabel(mobility?: VehicleMobility): string {
  if (mobility === "drivable") return "Ano";
  if (mobility === "not_drivable") return "Ne";
  return "Neví se";
}

export function offerCountLabel(count: number) {
  if (count === 1) return "1 cenová nabídka";
  if (count >= 2 && count <= 4) return `${count} cenové nabídky`;
  return `${count} cenových nabídek`;
}

export function timePreferenceLabel(preference?: TimePreference) {
  switch (preference) {
    case "asap": return "Co nejdříve";
    case "within_24h": return "Do 24 hodin";
    case "within_3_days": return "Do 3 dnů";
    case "within_week": return "Do týdne";
    case "specific": return "Konkrétní termín";
    default: return "Co nejdříve";
  }
}

export function vehicleMobilityLabel(mobility?: VehicleMobility) {
  switch (mobility) {
    case "drivable": return "Samo najede na vlek";
    case "partially_drivable": return "Jede, ale má problém";
    case "not_drivable": return "Nenajede na vlek – nutný naviják";
    case "unknown": return "Stav vozidla není jistý";
    default: return "Stav vozidla není jistý";
  }
}

export function offerStatusLabel(status: TowOffer["status"]) {
  switch (status) {
    case "pending": return "Čeká na rozhodnutí";
    case "accepted": return "Přijato";
    case "rejected": return "Odmítnuto";
    case "withdrawn": return "Staženo";
  }
}

function formatDate(date: string | null | undefined) {
  if (!date) return null;
  const [year, month, day] = date.slice(0, 10).split("-");
  return `${Number(day)}. ${Number(month)}. ${year}`;
}

function formatTime(time: string | null | undefined) {
  return time ? time.slice(0, 5) : null;
}

export function formatOfferArrivalDateTime(value: string | null | undefined) {
  if (!value) return "Čas příjezdu neuveden";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Čas příjezdu neuveden";

  return `${date.toLocaleDateString("cs-CZ")} v ${date.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function formatPostgresDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatPostgresTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}:00`;
}

export function statusLabel(status?: JobStatus) {
  switch (status) {
    case "open": return "🔎 Otevřená poptávka";
    case "offer_selected": return "✓ Přepravce vybrán";
    case "in_progress": return "🚛 Přeprava probíhá";
    case "completed": return "✓ Odtah dokončen";
    default: return "Čekáme na stav";
  }
}

export function transportStatusLabel(status?: JobStatus) {
  switch (status) {
    case "open": return "Otevřená";
    case "offer_selected": return "Vybrán přepravce";
    case "in_progress": return "Probíhá";
    case "completed": return "Dokončeno";
    case "cancelled": return "Zrušeno";
    default: return "Neznámý stav";
  }
}

export function transportLifecycleStatusLabel(status?: JobStatus) {
  switch (status) {
    case "offer_selected": return "Potvrzeno";
    case "in_progress": return "Přeprava probíhá";
    case "completed": return "Dokončeno";
    case "cancelled": return "Zrušeno";
    default: return transportStatusLabel(status);
  }
}

export function carrierRouteDepartureLabel(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function carrierRoutePriceLabel(price: number): string {
  return `${price.toLocaleString("cs-CZ")} Kč`;
}

export function canonicalVehicleType(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (normalized === "Osobní auto") return "Osobní automobil";
  if (normalized === "Motorka") return "Motocykl";
  return normalized;
}
