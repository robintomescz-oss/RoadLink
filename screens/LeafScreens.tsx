import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../components/SafeAreaViewCompat";
import { AppHeader as Header } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
import { styles } from "../lib/appStyles";
import type { Role } from "../lib/types";

/**
 * Jednoduché listové obrazovky vyextractované 1:1 z App.tsx.
 * Chování beze změny — veškerá logika zůstává volající straně.
 */

export function RoleScreen({ onSelectRole }: { onSelectRole: (role: Role) => void }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.logo}>RoadLink</Text>
        <Text style={styles.bigTitle}>Jak chcete RoadLink používat?</Text>
        <TouchableOpacity style={styles.roleCard} onPress={() => onSelectRole("customer")}>
          <Text style={styles.roleIcon}>🚗</Text>
          <View><Text style={styles.roleTitle}>Potřebuji odtah</Text><Text style={styles.muted}>Objednat pomoc na místě</Text></View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.roleCard} onPress={() => onSelectRole("driver")}>
          <Text style={styles.roleIcon}>🚛</Text>
          <View><Text style={styles.roleTitle}>Jsem odtahovka</Text><Text style={styles.muted}>Přijímat a vozit zakázky</Text></View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export function CreateScreen({
  screen,
  onItemPress,
  onRequestFlow,
  onCapacityFlow,
  onBackOverview,
}: {
  screen: string;
  onItemPress: (key: string) => void;
  onRequestFlow: () => void;
  onCapacityFlow: () => void;
  onBackOverview: () => void;
}) {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Vytvořit" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.appContent} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.formBackButtonInline} onPress={onBackOverview} accessibilityLabel="Zpět na Přehled">
          <Text style={styles.formBackText}>‹ Zpět na Přehled</Text>
        </TouchableOpacity>
        <Text style={styles.bigTitle}>Co chcete vytvořit?</Text>
        <TouchableOpacity style={styles.actionCard} onPress={onRequestFlow}>
          <Text style={styles.actionTitle}>Poptávka přepravy</Text>
          <Text style={styles.muted}>Potřebuji přepravit vozidlo.</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCard} onPress={onCapacityFlow}>
          <Text style={styles.actionTitle}>Volná kapacita</Text>
          <Text style={styles.muted}>Nabízím volné místo na své trase.</Text>
        </TouchableOpacity>
      </ScrollView>
      <BottomNav screen={screen} onItemPress={onItemPress} />
    </SafeAreaView>
  );
}

export function SosScreen({ screen, onItemPress }: { screen: string; onItemPress: (key: string) => void }) {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="SOS" />
      <View style={styles.appContent}>
        <Text style={styles.bigTitle}>SOS</Text>
        <Text style={styles.muted}>SOS pomoc bude dostupná v další verzi RoadLinku.</Text>
      </View>
      <BottomNav screen={screen} onItemPress={onItemPress} />
    </SafeAreaView>
  );
}

export function RequestSuccessScreen({ onShowRequests }: { onShowRequests: () => void }) {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Poptávka odeslána" />
      <View style={styles.requestSuccessContent}>
        <Text style={styles.successMark}>✓</Text>
        <Text style={styles.bigTitle}>POPTÁVKA ODESLÁNA</Text>
        <Text style={styles.muted}>Poptávka byla zveřejněna.{"\n"}Nyní můžete dostávat cenové nabídky přepravců.</Text>
        <TouchableOpacity style={styles.primary} onPress={onShowRequests}>
          <Text style={styles.primaryText}>ZOBRAZIT MOJE POPTÁVKY</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
