const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";
const AUTOCOMPLETE_FIELD_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
].join(",");
const DETAILS_FIELD_MASK = [
  "id",
  "formattedAddress",
  "location",
  "addressComponents",
].join(",");

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function componentByType(components: AddressComponent[], type: string) {
  return components.find((component) => component.types?.includes(type));
}

function publicLabelFromComponents(components: AddressComponent[]) {
  const locality =
    componentByType(components, "locality") ??
    componentByType(components, "postal_town") ??
    componentByType(components, "administrative_area_level_2") ??
    componentByType(components, "administrative_area_level_1");
  return normalizedText(locality?.longText, 80);
}

function countryCodeFromComponents(components: AddressComponent[]) {
  return normalizedText(componentByType(components, "country")?.shortText, 2).toUpperCase();
}

async function googleRequest(url: string, init: RequestInit, fieldMask: string) {
  const apiKey = Deno.env.get("GOOGLE_MAPS_SERVER_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_MAPS_SERVER_API_KEY is not configured");

  const response = await fetch(url, {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init.headers,
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });

  if (!response.ok) {
    console.error("Google Places request failed", { status: response.status });
    throw new Error("Google Places request failed");
  }
  return response.json();
}

async function autocomplete(input: string, sessionToken: string) {
  const data = await googleRequest(
    `${GOOGLE_PLACES_BASE_URL}/places:autocomplete`,
    {
      method: "POST",
      body: JSON.stringify({ input, sessionToken, languageCode: "cs", regionCode: "cz" }),
    },
    AUTOCOMPLETE_FIELD_MASK,
  );

  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return suggestions.flatMap((suggestion: Record<string, unknown>) => {
    const prediction = suggestion.placePrediction as Record<string, unknown> | undefined;
    const placeId = normalizedText(prediction?.placeId, 256);
    const text = normalizedText((prediction?.text as Record<string, unknown> | undefined)?.text, 300);
    const structured = prediction?.structuredFormat as Record<string, unknown> | undefined;
    const primaryText = normalizedText((structured?.mainText as Record<string, unknown> | undefined)?.text, 160);
    const secondaryText = normalizedText((structured?.secondaryText as Record<string, unknown> | undefined)?.text, 200);
    return placeId && text ? [{ placeId, text, primaryText, secondaryText }] : [];
  });
}

async function placeDetails(placeId: string, sessionToken: string) {
  const params = new URLSearchParams({ languageCode: "cs", regionCode: "cz", sessionToken });
  const data = await googleRequest(
    `${GOOGLE_PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}?${params}`,
    { method: "GET" },
    DETAILS_FIELD_MASK,
  );
  const components = Array.isArray(data?.addressComponents) ? data.addressComponents as AddressComponent[] : [];
  const latitude = Number(data?.location?.latitude);
  const longitude = Number(data?.location?.longitude);
  const formattedAddress = normalizedText(data?.formattedAddress, 500);
  const publicLabel = publicLabelFromComponents(components);
  const countryCode = countryCodeFromComponents(components);

  if (!formattedAddress || !publicLabel || !countryCode || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Selected place does not contain a usable address");
  }

  return { placeId: normalizedText(data?.id, 256) || placeId, formattedAddress, publicLabel, latitude, longitude, countryCode, provider: "google" };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const action = normalizedText(body?.action, 32);
    const sessionToken = normalizedText(body?.sessionToken, 128);
    if (!sessionToken) return jsonResponse({ error: "Missing session token" }, 400);

    if (action === "autocomplete") {
      const input = normalizedText(body?.input, 200);
      if (input.length < 3) return jsonResponse({ suggestions: [] });
      return jsonResponse({ suggestions: await autocomplete(input, sessionToken) });
    }

    if (action === "details") {
      const placeId = normalizedText(body?.placeId, 256);
      if (!placeId || !/^[A-Za-z0-9_.-]+$/.test(placeId)) return jsonResponse({ error: "Invalid place ID" }, 400);
      return jsonResponse({ location: await placeDetails(placeId, sessionToken) });
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("google-places function failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return jsonResponse({ error: "Location service is temporarily unavailable" }, 502);
  }
});
