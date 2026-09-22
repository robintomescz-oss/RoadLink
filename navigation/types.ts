import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";

/**
 * Názvy route jsou záměrně stejné jako původní hodnoty `screen` z App.tsx
 * ("home", "transport", "job", …). Hooky useTransportData a useProfile podle
 * nich zatím rozhodují, co načíst (viz AppContext → currentScreen).
 * Přejmenovat je můžeme až po přesunu načítání do useFocusEffect.
 *
 * Parametry jsou zatím všude `undefined`: sdílený stav (activeJobId,
 * activeRouteId, requestViewMode, transportTab) žije v AppContextu.
 * Záměrně tu nejsou: "welcome", "role", "customerHome", "driverHome", "customerRequests".
 * V původním App.tsx se nikdy nenastavují (RoleScreen se nikde neotevírá, goHome se
 * volá jen z něj) — mrtvý kód z doby zákazník/řidič. Odpovídá to ROADLINK_AGENT_RULES.md
 * (jeden účet, žádné přepínání rolí).
 */
export type RootStackParamList = {
  // Veřejné (dostupné i bez přihlášení)
  home: undefined;
  transport: undefined;
  routeDetail: undefined;
  create: undefined;
  sos: undefined;
  login: undefined;
  signup: undefined;

  // Poptávky a přepravy
  request: undefined;
  requestSuccess: undefined;
  job: undefined;
  offerForm: undefined;
  providerProfile: undefined;
  tracking: undefined;
  routeForm: undefined;

  // Profil a vozidla
  profile: undefined;
  vehicles: undefined;
  vehicleForm: undefined;
};

export type RootScreenName = keyof RootStackParamList;

export type RootScreenProps<T extends RootScreenName> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

// Typované useNavigation() / navigationRef v celé aplikaci.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
