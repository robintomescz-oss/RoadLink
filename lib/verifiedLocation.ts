import { supabase } from "./supabase";

export type VerifiedLocation = {
  placeId: string;
  formattedAddress: string;
  publicLabel: string;
  latitude: number;
  longitude: number;
  countryCode: string;
  provider: "google";
};

export type LocationSuggestion = {
  placeId: string;
  text: string;
  primaryText: string;
  secondaryText: string;
};

export function createPlacesSessionToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function autocompleteLocations(input: string, sessionToken: string) {
  const { data, error } = await supabase.functions.invoke("google-places", {
    body: { action: "autocomplete", input, sessionToken },
  });
  if (error) throw new Error("Návrhy adres se nepodařilo načíst.");
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as LocationSuggestion[];
}

export async function resolveVerifiedLocation(placeId: string, sessionToken: string) {
  const { data, error } = await supabase.functions.invoke("google-places", {
    body: { action: "details", placeId, sessionToken },
  });
  if (error || !data?.location) throw new Error("Vybranou adresu se nepodařilo ověřit.");
  return data.location as VerifiedLocation;
}
