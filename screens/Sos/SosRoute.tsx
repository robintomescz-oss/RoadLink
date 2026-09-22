import React from "react";
import { SosScreen } from "../LeafScreens";
import { useBottomNavPress } from "../../components/AppBottomNav";
import type { RootScreenProps } from "../../navigation/types";

/** screen === "sos" z App.tsx */
export default function SosRoute({ route }: RootScreenProps<"sos">) {
  const onItemPress = useBottomNavPress();
  return <SosScreen screen={route.name} onItemPress={onItemPress} />;
}
