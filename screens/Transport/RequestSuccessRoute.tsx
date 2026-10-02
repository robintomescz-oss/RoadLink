import React from "react";
import { RequestSuccessScreen } from "../LeafScreens";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackAction } from "../../hooks/useBackHandlers";

/** screen === "requestSuccess" z App.tsx (+ openMyRequestsAfterSuccess) */
export default function RequestSuccessRoute() {
  const { setTransportTab } = useAppContext();
  const showMyRequests = () => {
    setTransportTab("mine");
    navigateLegacy("transport");
  };
  // Hardware Back po vytvoření poptávky vede na trh přepravy s tabem „Moje“.
  useHardwareBackAction(showMyRequests);
  return (
    <RequestSuccessScreen
      onShowRequests={showMyRequests}
    />
  );
}
