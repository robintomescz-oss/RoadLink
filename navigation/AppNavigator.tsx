import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { NavigationContainer } from "@react-navigation/native";
import { AppProvider } from "../contexts/AppContext";
import { navigationRef } from "../navigation/navigationRef";
import type { RootStackParamList } from "./types";
import LoginScreen from "../screens/Auth/LoginScreen";
import SignupScreen from "../screens/Auth/SignupScreen";
import HomeRoute from "../screens/Home/HomeRoute";
import CreateRoute from "../screens/Create/CreateRoute";
import SosRoute from "../screens/Sos/SosRoute";
import RequestSuccessRoute from "../screens/Transport/RequestSuccessRoute";
import CreateRequestScreen from "../screens/Transport/CreateRequestScreen";
import TransportRoute from "../screens/Transport/TransportRoute";
import JobDetailRoute from "../screens/Transport/JobDetailRoute";
import RouteDetailRoute from "../screens/Transport/RouteDetailRoute";
import RouteFormRoute from "../screens/Transport/RouteFormRoute";
import OfferFormRoute from "../screens/Transport/OfferFormRoute";
import ProviderProfileRoute from "../screens/Transport/ProviderProfileRoute";
import TrackingRoute from "../screens/Transport/TrackingRoute";
import ProfileRoute from "../screens/Profile/ProfileRoute";
import VehiclesRoute from "../screens/Vehicles/VehiclesRoute";
import VehicleFormRoute from "../screens/Vehicles/VehicleFormRoute";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Jeden root stack. Aplikace není zamčená za přihlášením: host vidí úvod,
 * trh přeprav i detail poptávky a na "login" se přesměruje až při akci,
 * která přihlášení vyžaduje. Proto Login/Signup nejsou samostatný navigátor
 * podmíněný `userId`, ale běžné obrazovky téhož stacku.
 *
 * Žádné role: RoadLink má jeden účet (ROADLINK_AGENT_RULES.md).
 *
 * Dolní lištu zatím zůstává původní BottomNav uvnitř obrazovek;
 * na skutečné taby ji případně převedeme až po dokončení přesunu.
 *
 * Route řádky dole musí ukazovat přímo na skutečné obrazovky.
 */
export default function AppNavigator() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator initialRouteName="home" screenOptions={{ headerShown: false }}>
            {/* Veřejné */}
            <Stack.Screen name="home" component={HomeRoute} />
            <Stack.Screen name="transport" component={TransportRoute} />
            <Stack.Screen name="routeDetail" component={RouteDetailRoute} />
            <Stack.Screen name="create" component={CreateRoute} />
            <Stack.Screen name="sos" component={SosRoute} />
            <Stack.Screen name="login" component={LoginScreen} />
            <Stack.Screen name="signup" component={SignupScreen} />

            {/* Poptávky a přepravy */}
            {/* gestureEnabled: false — jako dřív, odchod z formuláře jde jen přes ‹ Zpět / hardwarové
                Zpět, které hlídají neuložené změny (swipe-back by je obešel). */}
            <Stack.Screen name="request" component={CreateRequestScreen} options={{ gestureEnabled: false }} />
            <Stack.Screen name="requestSuccess" component={RequestSuccessRoute} />
            <Stack.Screen name="job" component={JobDetailRoute} />
            <Stack.Screen name="offerForm" component={OfferFormRoute} />
            <Stack.Screen name="providerProfile" component={ProviderProfileRoute} />
            <Stack.Screen name="tracking" component={TrackingRoute} />
            <Stack.Screen name="routeForm" component={RouteFormRoute} options={{ gestureEnabled: false }} />

            {/* Profil a vozidla */}
            <Stack.Screen name="profile" component={ProfileRoute} />
            <Stack.Screen name="vehicles" component={VehiclesRoute} />
            <Stack.Screen name="vehicleForm" component={VehicleFormRoute} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}
