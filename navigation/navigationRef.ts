import { CommonActions, createNavigationContainerRef } from "@react-navigation/native";

// KROK 1: dočasně volně typovaný ref. V kroku 2 ho nahradíme
// createNavigationContainerRef<RootStackParamList>().
type LooseParamList = Record<string, object | undefined>;

export const navigationRef = createNavigationContainerRef<LooseParamList>();

/** Aktuální (nejhlouběji zaostřená) route, nebo undefined před inicializací. */
export function getCurrentRouteName(): string | undefined {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
}

/**
 * Náhrada původního setScreen(name) pro hooky (useAuth, goHome).
 * V původní aplikaci setScreen znamenal "vyměň obrazovku, žádná historie",
 * proto se dělá reset zásobníku na jedinou route. Funguje stejně
 * v React Navigation 6 i 7 (na rozdíl od navigate, jehož chování se ve v7 změnilo).
 * Před inicializací kontejneru nedělá nic.
 */
export function navigateLegacy(name: string) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(CommonActions.reset({ index: 0, routes: [{ name }] }));
}