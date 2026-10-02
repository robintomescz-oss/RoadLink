import React from "react";
import SosScreen from "./SosScreen";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import type { RootScreenProps } from "../../navigation/types";

/**
 * screen === "sos" z App.tsx.
 * SOS modul je samostatný tmavý průvodce; hardware Back i tlačítko ‹ se
 * vracejí na Přehled. Tísňové volání je dostupné v trvalém pruhu uvnitř
 * SosScreen.
 */
export default function SosRoute(_props: RootScreenProps<"sos">) {
  useHardwareBackTo("home");
  return <SosScreen />;
}
