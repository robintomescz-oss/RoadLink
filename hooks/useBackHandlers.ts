import { useCallback, useRef } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { navigateLegacy } from "../navigation/navigationRef";

/**
 * Jeden společný hardware-back mechanizmus pro celou aplikaci.
 *
 * - useFormBackGuard: formuláře (Poptávka, Volná kapacita) — dirty formulář
 *   ukáže discard dialog, čistý odejde bez dialogu, probíhající odeslání
 *   dialog potlačí. Horní ‹ Zpět volá stejnou leave funkci, takže obě cesty
 *   (tlačítko i hardware) mají identické chování. Listener se registruje jen
 *   při fokusu a čte aktuální leave funkci přes ref — žádné opakované
 *   přeregistrace, žádné dvojité dialogy. (Když je otevřená klávesnice,
 *   Android první Back standardně zavře klávesnici a BackHandler dostane
 *   až druhý stisk.)
 * - useHardwareBackTo: obrazovky bez formuláře (detaily, Profil, Vozidla) —
 *   navigateLegacy resetuje zásobník, takže bez handleru by hardware Back
 *   aplikaci ukončil. Handler ji místo toho pošle na předchozí obrazovku.
 */
export function useFormBackGuard(leaveForm: () => void) {
  const leaveRef = useRef(leaveForm);
  leaveRef.current = leaveForm;
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        leaveRef.current();
        return true;
      });
      return () => subscription.remove();
    }, [])
  );
}

export function useHardwareBackAction(handler: () => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        handlerRef.current();
        return true;
      });
      return () => subscription.remove();
    }, [])
  );
}

export function useHardwareBackTo(screenName: string) {
  const backRef = useRef(screenName);
  backRef.current = screenName;
  useHardwareBackAction(() => navigateLegacy(backRef.current));
}
