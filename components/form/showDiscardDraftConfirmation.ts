import { Alert } from "react-native";

/** Potvrzení odchodu z rozepsaného formuláře (z App.tsx, sdílí request a routeForm). */
export function showDiscardDraftConfirmation(onDiscard: () => void) {
  Alert.alert(
    "Zahodit rozepsané údaje?",
    "Máte rozepsané údaje. Pokud odejdete, změny se neuloží.",
    [
      { text: "Pokračovat v úpravách", style: "cancel" },
      { text: "Zahodit", style: "destructive", onPress: onDiscard },
    ]
  );
}
