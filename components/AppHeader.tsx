import { Alert, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "../lib/appStyles";

/**
 * Horní lišta s logem a tlačítkem notifikací.
 *
 * Dva režimy:
 *  - s `title`: původní velký titulek (obrazovky, které nemají vlastní
 *    titulek v obsahu — chování beze změny);
 *  - bez `title`: kompaktní brand lišta pro obrazovky, které si velký
 *    titulek a podtitulek řeší v obsahu (Přehled, Přeprava) — lišta je
 *    pouze loga + akce, bez prázdné bílé plochy.
 */
export function AppHeader({ title }: { title?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.headerSafeArea, { paddingTop: (styles.headerSafeArea.paddingTop as number) + insets.top }]}>
      <View style={title ? styles.header : styles.headerCompact}>
        <View>
          <Text style={styles.logo}>ROADLINK</Text>
          {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
        </View>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => Alert.alert("Notifikace", "Notifikace budou dostupné v další verzi RoadLinku.")}>
          <Text style={styles.headerSignOut}>⌁</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
