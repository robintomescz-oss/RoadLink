import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "../lib/appStyles";
import { NavIcon, type NavIconName } from "./NavIcons";

/**
 * Spodní navigace. Logika navigace (přepnutí tabu, ochrana profilu)
 * zůstává volající straně přes onItemPress — chování beze změny.
 *
 * SOS bylo z navigace záměrně odstraněno (rozhodnutí uživatele) —
 * SOS zůstává dostupné přes kartu na Global Home; obrazovka SOS
 * a její handler zůstávají zachovány.
 *
 * Struktura: Přehled · [centrální vytvoření] · Moje · Profil
 */
const NAV_ITEMS: Array<{ key: string; label: string; icon: NavIconName | null }> = [
  { key: "overview", label: "Přehled", icon: "dashboard" },
  { key: "create", label: "Vytvořit", icon: null },
  { key: "mine", label: "Moje", icon: "mine" },
  { key: "profile", label: "Profil", icon: "person" },
];

export function BottomNav({ screen, activeKey, onItemPress }: { screen: string; activeKey?: string; onItemPress: (key: string) => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bottomNavSafeArea, { paddingBottom: (styles.bottomNavSafeArea.paddingBottom as number) + insets.bottom }]}>
      <View style={styles.bottomNav} accessibilityRole="tablist">
        {NAV_ITEMS.map((item) => {
          const isActive = (activeKey || screen) === item.key;
          const isCreate = item.icon === null;

          if (isCreate) {
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.bottomNavItem}
                onPress={() => onItemPress(item.key)}
                accessibilityRole="button"
                accessibilityLabel="Vytvořit nový požadavek"
                accessibilityHint="Otevře výběr mezi poptávkou přepravy a nabídkou volné kapacity"
              >
                <View style={styles.bottomNavPlusCircle}>
                  <Text style={styles.bottomNavPlusGlyph}>+</Text>
                </View>
                <Text style={styles.bottomNavCreateLabel}>{item.label}</Text>
              </TouchableOpacity>
            );
          }

          const iconName = item.icon as NavIconName;
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
              <NavIcon name={iconName} color={iconColor} size={24} />
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
