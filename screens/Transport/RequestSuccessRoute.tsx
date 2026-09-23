import React from "react";
import { RequestSuccessScreen } from "../LeafScreens";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";

/** screen === "requestSuccess" z App.tsx (+ openMyRequestsAfterSuccess) */
export default function RequestSuccessRoute() {
  const { setTransportTab } = useAppContext();
  return (
    <RequestSuccessScreen
      onShowRequests={() => {
        setTransportTab("mine");
        navigateLegacy("transport");
      }}
    />
  );
}
