import { useState } from "react";
import * as Location from "expo-location";

/**
 * Spravuje aktuální polohu uživatele včetně oprávnění.
 * Vyextractováno 1:1 z App.tsx — chování beze změny.
 */
export function useLocation() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationError, setLocationError] = useState("");

  async function requestLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Povolte RoadLink přístup k poloze.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocation(current);
      setLocationError("");
    } catch {
      setLocationError("Nepodařilo se získat aktuální polohu.");
    }
  }

  return { location, locationError, requestLocation };
}
