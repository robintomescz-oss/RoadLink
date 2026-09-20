import { SafeAreaView as RNSafeAreaView, type NativeSafeAreaViewProps } from "react-native-safe-area-context";

/**
 * Kompatibilní náhrada deprecated SafeAreaView z react-native.
 *
 * edges=[] = žádné automatické injekty, geometrie je 1:1 se současným
 * přijatým rozložením (core SafeAreaView je na Androidu no-op). Injekty si
 * samy řeší AppHeader (insets.top) a BottomNav (insets.bottom) — SafeAreaView
 * s defaultními edges by způsobilo dvojité odsazení.
 */
export function SafeAreaView({ edges, ...props }: NativeSafeAreaViewProps) {
  return <RNSafeAreaView {...props} edges={edges ?? []} />;
}
