import * as Location from "expo-location";
import type { PickupCoordinates } from "./types";

export function coordinatesFromValues(latitude: unknown, longitude: unknown): PickupCoordinates | null {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);

  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    return null;
  }

  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

const GEOCODING_TIMEOUT_MS = 6000;

export async function geocodeAddress(address: string): Promise<PickupCoordinates | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const geocodingAttempt = Location.geocodeAsync(address)
    .then((results) => {
      const usableResult = results.find((result) =>
        Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
      );

      return usableResult
        ? { latitude: usableResult.latitude, longitude: usableResult.longitude }
        : null;
    })
    .catch((error) => {
      console.warn("Forward geocoding failed:", error);
      return null;
    });

  const timeoutFallback = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), GEOCODING_TIMEOUT_MS);
  });

  const result = await Promise.race([geocodingAttempt, timeoutFallback]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return result;
}
