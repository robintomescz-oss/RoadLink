import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "../lib/appStyles";

/**
 * Spodní navigace. Logika navigace (přepnutí tabu, ochrana profilu)
 * zůstává volající straně přes onItemPress — chování beze změny.
 */
export function BottomNav({ screen, onItemPress }: { screen: string; onItemPress: (key: string) => void }) {
  const insets = useSafeAreaInsets();
  const navItems = [
    { key: "home", label: "Domů", icon: "⌂" },
    { key: "overview", label: "Přehled", icon: "▦" },
    { key: "transport", label: "Přeprava", icon: "⇄" },
    { key: "create", label: "+", icon: "+" },
    { key: "sos", label: "SOS", icon: "!" },
    { key: "profile", label: "Profil", icon: "◯" },
  ];

  return (
    <View style={[styles.bottomNavSafeArea, { paddingBottom: (styles.bottomNavSafeArea.paddingBottom as number) + insets.bottom }]}>
      <View style={styles.bottomNav}>
        {navItems.map((item) => {
          const isActive = screen === item.key;
          const isCreate = item.key === "create";
          return (
            <TouchableOpacity
              key={item.key}
              style={styles.bottomNavItem}
              onPress={() => onItemPress(item.key)}
            >
              <Text style={[
                styles.bottomNavIcon,
                isActive && styles.bottomNavTextActive,
                item.key === "sos" && styles.bottomNavSos,
                isCreate && styles.bottomNavPlus,
              ]}>
                {item.icon}
              </Text>
              {!isCreate ? (
                <Text style={[styles.bottomNavText, isActive && styles.bottomNavTextActive, item.key === "sos" && styles.bottomNavSos]}>
                  {item.label}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
