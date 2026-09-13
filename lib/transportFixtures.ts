// Fictional local fixtures for visual preview of transport cards only.
// Never submitted to Supabase, never shown in the live feed. IDs use the
// "preview-" prefix so they cannot collide with or trigger live mutations.

export type PreviewRequest = {
  id: string;
  badge: string;
  vehicle: string | null;
  pickupAddress: string | null;
  destination: string;
  requestedDate: string | null;
  vehicleMobility: string | null;
  status: string | null;
  actionLabel?: string | null;
  actionable: boolean;
};

export type PreviewRoute = {
  id: string;
  badge: string;
  fromAddress: string;
  toAddress: string;
  departureAt: string | null;
  availableSpaces: number | null;
  maxDeviationKm: number | null;
  vehicleTypes: string | null;
  price: number | null;
  status?: string | null;
  actionLabel?: string | null;
  actionable: boolean;
};

export const previewRequests: PreviewRequest[] = [
  {
    id: "preview-request-open-long-route",
    badge: "POPTÁVKA",
    vehicle: "Osobní automobil",
    pickupAddress: "Brandýs nad Labem-Stará Boleslav, Plantážní zahrada u dlouhého názvu ulice",
    destination: "Horní Dolní Lhota u Luhačovic, Družstevní ulice s velmi dlouhým názvem pro test zalamování",
    requestedDate: "2026-09-20T09:30:00",
    vehicleMobility: "Samo najede na vlek",
    status: "Otevřená",
    actionLabel: "Otevřít",
    actionable: true,
  },
  {
    id: "preview-request-own-missing-meta",
    badge: "MOJE POPTÁVKA",
    vehicle: null,
    pickupAddress: null,
    destination: "Wiener Neustadt, Niederösterreich",
    requestedDate: null,
    vehicleMobility: null,
    status: "Dokončeno",
    actionLabel: null,
    actionable: false,
  },
];

export const previewRoutes: PreviewRoute[] = [
  {
    id: "preview-route-open-long-route",
    badge: "VOLNÁ KAPACITA",
    fromAddress: "České Budějovice, Nádražní ulice s mimořádně dlouhým názvem pro ověření zalamování textu",
    toAddress: "Sankt Georgen im Attergau, Oberösterreich",
    departureAt: "2026-09-21T14:00:00",
    availableSpaces: 2,
    maxDeviationKm: null,
    vehicleTypes: "Osobní automobil, dodávka",
    price: null,
    status: null,
    actionLabel: "Detail trasy",
    actionable: true,
  },
  {
    id: "preview-route-accepted-priced",
    badge: "PŘEPRAVA",
    fromAddress: "Plzeň",
    toAddress: "Graz",
    departureAt: "2026-09-22T08:15:00",
    availableSpaces: null,
    maxDeviationKm: 20,
    vehicleTypes: "SUV / nepojízdné vozidlo",
    price: 12800,
    status: "Přeprava probíhá",
    actionLabel: null,
    actionable: false,
  },
];
