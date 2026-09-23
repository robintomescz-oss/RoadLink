import { useNavigation } from "@react-navigation/native";
import { useAppContext } from "../contexts/AppContext";
import { navigateLegacy } from "../navigation/navigationRef";
import type { RootNavigation } from "../navigation/types";

/**
 * openRequestFlow / openCapacityFlow z App.tsx.
 * Rozdíl: formulářový stav (výchozí hodnoty, dirty-check snapshot, chyby)
 * si už inicializují samy obrazovky "request" a "routeForm" při otevření,
 * proto tu zůstala jen kontrola přihlášení, příprava profilu a navigace.
 */
export function useCreateFlows() {
  const navigation = useNavigation<RootNavigation>();
  const { userId, setRequestViewMode, profileState } = useAppContext();
  const { carrierProfile, ensureCarrierProfile, loadCarrierProfile } = profileState;

  function openRequestFlow() {
    if (!userId) {
      navigateLegacy("login");
      return;
    }
    setRequestViewMode("owner");
    navigation.navigate("request");
  }

  async function openCapacityFlow() {
    if (!userId) {
      navigateLegacy("login");
      return;
    }
    const providerProfile = carrierProfile || (await ensureCarrierProfile());
    if (!providerProfile) return;
    await loadCarrierProfile();
    navigation.navigate("routeForm");
  }

  return { openRequestFlow, openCapacityFlow };
}
