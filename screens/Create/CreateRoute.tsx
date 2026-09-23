import React from "react";
import { CreateScreen } from "../LeafScreens";
import { useBottomNavPress } from "../../components/AppBottomNav";
import { useCreateFlows } from "../../hooks/useCreateFlows";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import type { RootScreenProps } from "../../navigation/types";

/** screen === "create" z App.tsx */
export default function CreateRoute({ route }: RootScreenProps<"create">) {
  const onItemPress = useBottomNavPress();
  const { openRequestFlow, openCapacityFlow } = useCreateFlows();
  // Hardwarové Zpět = návrat na Přehled (stejně jako „Zpět na přehled“ v UI).
  useHardwareBackTo("home");
  return (
    <CreateScreen
      screen={route.name}
      onItemPress={onItemPress}
      onRequestFlow={openRequestFlow}
      onCapacityFlow={openCapacityFlow}
      onBackOverview={() => navigateLegacy("home")}
    />
  );
}
