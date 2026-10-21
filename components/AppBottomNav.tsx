import React from "react";
import { useRoute } from "@react-navigation/native";
import { BottomNav } from "./BottomNav";
import { useAppContext } from "../contexts/AppContext";
import { navigateLegacy } from "../navigation/navigationRef";

/**
 * Logika dolní lišty přesunutá z App.tsx (handleBottomNavItemPress).
 * Přepnutí položky lišty je přepnutí sekce, ne "krok dál", proto se dělí
 * reset zásobníku (stejně jako původní setScreen, který nemá historii).
 *
 * Liška má tři položky: Přehled · Trh · Profil.
 * `Moje` je tab uvnitř Trhu, `Vytvořit` je kontextová akce v Trhu a SOS
 * zůstává na hlavní obrazovce — proto tu žádné z nich nejsou.
 */
export function useBottomNavPress() {
  const { userId } = useAppContext();

  return function handleBottomNavItemPress(key: string) {
    if (key === "overview") {
      navigateLegacy("home");
      return;
    }
    // Profil pro odhlášeného uživatele otevře přihlášení — beze změny.
    if (key === "profile" && !userId) {
      navigateLegacy("login");
      return;
    }
    navigateLegacy(key);
  };
}

/** Původní BottomNavigation() z App.tsx. Aktivní položku určuje route, na které je vykreslená. */
export function AppBottomNav() {
  const route = useRoute();
  const onItemPress = useBottomNavPress();
  const screen = route.name;

  // `Trh` je aktivní i na obrazovkách detailu trasy — patří do stejného modulu.
  const activeKey =
    screen === "home" || screen === "overview"
      ? "overview"
      : screen === "transport" || screen === "routeDetail"
      ? "transport"
      : screen === "profile"
      ? "profile"
      : undefined;

  return <BottomNav screen={screen} activeKey={activeKey} onItemPress={onItemPress} />;
}
