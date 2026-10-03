import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "../lib/appStyles";
import { NavIcon, type NavIconName } from "./NavIcons";

/**
 * Spodní navigace. Logika navigace (ochrana profilu, přesměrování na login)
 * zůstává volající straně přes onItemPress — chování beze změny.
 *
 * Struktura: Přehled · Trh · Profil
 *
 * - `Přehled` není „Domů“: používá ikonu dashboardu, ne domečku.
 * - `Trh` je hlavní pracovní prostor pro přepravu. Vytvoření poptávky nebo
 *   kapacity do něj patří, proto je kontextová akce uvnitř obrazovky Trh,
 *   ne v této liště.
 * - SOS sem zámerě nepatří — zůstává dostupné z hlavní obrazovky přes velkou
 *   kartu, aby nepředbíhalo ostatní položky a nezvyšovalo počet tapů.
 * - `Moje` je tab uvnitř Trhu, ne položka spodní navigace.
 */
const NAV_ITEMS: Array<{ key: string; label: string; icon: NavIconName }> = [
  { key: "overview", label: "Přehled", icon: "dashboard" },
  { key: "transport", label: "Trh", icon: "market" },
  { key: "profile", label: "Profil", icon: "person" },
];

export function BottomNav({ screen, activeKey, onItemPress }: { screen: string; activeKey?: string; onItemPress: (key: string) => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bottomNavSafeArea, { paddingBottom: (styles.bottomNavSafeArea.paddingBottom as number) + insets.bottom }]}>
      <View style={styles.bottomNav} accessibilityRole="tablist">
        {NAV_ITEMS.map((item) => {
          const isActive = (activeKey || screen) === item.key;
          const iconColor = isActive ? styles.bottomNavTextActive.color : styles.bottomNavIcon.color;

          return (
            <TouchableOpacity
              key={item.key}
              style={styles.bottomNavItem}
              onPress={() => onItemPress(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
            >
              <NavIcon name={item.icon} color={iconColor} size={24} />
              <Text
                numberOfLines={1}
                style={[styles.bottomNavText, isActive && styles.bottomNavTextActive]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
