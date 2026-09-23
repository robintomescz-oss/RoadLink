import React from "react";
import { useRoute } from "@react-navigation/native";
import { BottomNav } from "./BottomNav";
import { useAppContext } from "../contexts/AppContext";
import { navigateLegacy } from "../navigation/navigationRef";

/**
 * Logika dolní lišty přesunutá z App.tsx (handleBottomNavItemPress).
 * Přepnutí položky lišty je přepnutí sekce, ne "krok dál", proto se dělá
 * reset zásobníku (stejně jako původní setScreen, který nemá historii).
 */
export function useBottomNavPress() {
  const { userId, setTransportTab } = useAppContext();

  return function handleBottomNavItemPress(key: string) {
    if (key === "overview") {
      navigateLegacy("home");
      return;
    }
    if (key === "mine") {
      if (!userId) {
        navigateLegacy("login");
        return;
      }
      setTransportTab("mine");
      navigateLegacy("transport");
      return;
    }
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
  const { transportTab } = useAppContext();
  const onItemPress = useBottomNavPress();
  const screen = route.name;

  const activeKey =
    screen === "home" || screen === "overview"
      ? "overview"
      : screen === "transport" && transportTab === "mine"
      ? "mine"
      : screen === "create"
      ? "create"
      : screen === "profile"
      ? "profile"
      : undefined;

  return <BottomNav screen={screen} activeKey={activeKey} onItemPress={onItemPress} />;
}
