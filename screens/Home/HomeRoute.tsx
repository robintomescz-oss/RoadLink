import React from "react";
import GlobalHome from "../../lib/GlobalHome";
import { AppBottomNav } from "../../components/AppBottomNav";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";

/** screen === "home" z App.tsx */
export default function HomeRoute() {
  const { setTransportTab } = useAppContext();
  return (
    <GlobalHome
      onTransport={() => {
        setTransportTab("all");
        navigateLegacy("transport");
      }}
      bottomNav={<AppBottomNav />}
    />
  );
}
