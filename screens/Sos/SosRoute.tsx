import React from "react";
import { SosScreen } from "../LeafScreens";
import { useBottomNavPress } from "../../components/AppBottomNav";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import type { RootScreenProps } from "../../navigation/types";

/** screen === "sos" z App.tsx */
export default function SosRoute({ route }: RootScreenProps<"sos">) {
  // SOS se otevírá z karty na Přehledu — hardware Back se vrací tam.
  useHardwareBackTo("home");
  const onItemPress = useBottomNavPress();
  return <SosScreen screen={route.name} onItemPress={onItemPress} />;
}
