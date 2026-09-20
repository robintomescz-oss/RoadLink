import { Alert, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "../lib/appStyles";

/**
 * Horní lišta s logem a tlačítkem notifikací.
 * Vyextractováno 1:1 z App.tsx — chování beze změny.
 */
export function AppHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.headerSafeArea, { paddingTop: (styles.headerSafeArea.paddingTop as number) + insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>ROADLINK</Text>
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => Alert.alert("Notifikace", "Notifikace budou dostupné v další verzi RoadLinku.")}>
          <Text style={styles.headerSignOut}>⌁</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
