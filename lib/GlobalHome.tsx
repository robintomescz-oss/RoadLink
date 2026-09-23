import React from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Circle } from "react-native-svg";
import { StatusBar } from "expo-status-bar";

type Props = { onTransport: () => void; bottomNav?: React.ReactNode };
function Icon({ name, color = "#102A43", size = 40 }: { name: string; color?: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    {name === "person" ? <><Circle cx={24} cy={15} r={7} fill={color} stroke="none" /><Path d="M10 39v-5c0-12 28-12 28 0v5c-8 4-20 4-28 0Z" fill={color} stroke="none" /></> : name === "truck" ? <><Path d="M3 29h27v10H3zM30 23h8l7 8v8H30M33 26v7h10M6 24v-6l5-7h12l6 7v6H6ZM8 18h18" /><Circle cx={11} cy={39} r={5} fill="#EAF3FF" /><Circle cx={37} cy={39} r={5} fill="#EAF3FF" /><Circle cx={11} cy={23} r={2} /><Circle cx={24} cy={23} r={2} /></> : name === "siren" ? <><Path d="M13 35V23a11 11 0 0 1 22 0v12ZM10 40h28M24 3v5M7 10l4 4M41 10l-4 4M3 24h5M40 24h5" /><Path d="M14 34V24a10 10 0 0 1 20 0v10Z" fill={color} /><Path d="M18 23c0-3 1-5 4-6" stroke="white" /></> : <><Path d="M30 5a12 12 0 0 0-13 16L5 34a6 6 0 0 0 9 9l13-14A12 12 0 0 0 43 15l-9 8-8-8 8-10Z" fill={color} stroke="none" /><Circle cx={10} cy={38} r={2} fill="white" stroke="none" /></>}
  </Svg>;
}
function HomeContent({ onTransport, bottomNav }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const [headerH, setHeaderH] = React.useState(0);
  const [bottomNavH, setBottomNavH] = React.useState(0);
  const fallbackBottomNavH = 88 + insets.bottom;
  const measuredBottomNavH = bottomNav ? (bottomNavH || fallbackBottomNavH) : 0;
  // measuredBottomNavH už obsahuje dolní safe-area inset. Druhé odečtení
  // insets.bottom by krátké telefony chybně zařadilo do ještě menšího viewportu.
  const usableViewportH = height - measuredBottomNavH;
  const density = usableViewportH < 650 || (fontScale >= 1.25 && usableViewportH < 700)
    ? "compact"
    : usableViewportH > 720
    ? "tall"
    : "regular";
  const compact = density === "compact" || width < 380;
  const wide = width >= 400;
  const inlineStatus = wide || (density === "compact" && width >= 350 && fontScale <= 1.1);
  const wordmarkSize = density === "compact" ? Math.max(38, Math.min(44, width * 0.12)) : density === "tall" ? 50 : 48;
  const naturalSceneH = (width * 895) / 1374;
  const sceneHeight = density === "compact"
    ? naturalSceneH
    : density === "tall"
    ? Math.min(naturalSceneH + 32, height * 0.36)
    : naturalSceneH;
  const cardGap = density === "compact" ? 7 : density === "tall" ? 14 : 12;
  const cardsMarginTop = density === "compact" ? 7 : density === "tall" ? 14 : 12;
  const cardPaddingV = density === "compact" ? 8 : 14;
  const primaryPaddingV = density === "compact" ? 9 : 16;
  const tileSize = density === "compact" ? 46 : 56;
  const iconSize = density === "compact" ? 31 : 38;
  // BottomNav je samostatný flex sibling, takže ScrollView už nad ním končí.
  // Stačí malá rezerva pro pohodlné doscrollování poslední karty.
  const scrollBottomClearance = 16 + insets.bottom;
  return <View style={s.root}>
    <StatusBar style="dark" />
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingBottom: scrollBottomClearance }} showsVerticalScrollIndicator={false}>
      <View onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h && Math.abs(h - headerH) > 1) setHeaderH(h); }} style={[s.headerCenter, { paddingTop: insets.top + (density === "compact" ? 6 : 10), backgroundColor: "transparent", position: "relative", zIndex: 1, elevation: 1 }]}>
        <Text accessibilityLabel="RoadLink" style={[s.wordmark, { fontSize: wordmarkSize }]}>Road<Text style={s.link}>Link</Text></Text>
      </View>
      <Image source={require("../assets/global-home-scene.png")} style={[s.scene, { height: sceneHeight, marginTop: headerH ? -(headerH + (density === "compact" ? 8 : 4)) : -(insets.top + 56) }]} resizeMode="cover" />
      <View style={[s.cards, { marginTop: cardsMarginTop, gap: cardGap, paddingHorizontal: density === "compact" ? 12 : 16 }]}>
        <TouchableOpacity style={[s.cardPrimary, compact && s.cardCompact, { minHeight: density === "compact" ? 72 : 92, paddingVertical: primaryPaddingV }]} onPress={onTransport} accessibilityRole="button" accessibilityLabel="Trh přepravy">
          <View style={[s.tileBlue, { width: tileSize, height: tileSize }]}><Icon name="truck" size={iconSize} /></View>
          <View style={s.body}>
            <Text style={s.titlePrimary} allowFontScaling>Trh přepravy</Text>
            <Text style={s.descPrimary} allowFontScaling>{density === "compact" ? "Poptávky a nabídky volné kapacity." : "Prohlédněte si poptávky a nabídky volné kapacity."}</Text>
          </View>
          <View style={s.actionBlue}><Text style={s.actionArrow}>›</Text></View>
        </TouchableOpacity>
        <TouchableOpacity style={[s.card, compact && s.cardCompact, { minHeight: density === "compact" ? 70 : 88, paddingVertical: cardPaddingV }]} onPress={() => Alert.alert("SOS", "SOS pomoc při poruše bude dostupná v další verzi.")} accessibilityRole="button" accessibilityLabel="SOS pomoc">
          <View style={[s.tile, s.redTile, { width: tileSize, height: tileSize }]}><Icon name="siren" size={iconSize} color="#D7263D" /></View>
          <View style={s.body}>
            <View style={s.titleRow}>
              <Text style={s.title} allowFontScaling>SOS pomoc</Text>
              {inlineStatus ? <View style={[s.pill, compact && s.pillCompact]}><Text style={s.pillText}>Připravujeme</Text></View> : null}
              {inlineStatus ? <Text style={s.chev}>›</Text> : null}
            </View>
            <Text style={s.description} allowFontScaling>Pomoc při poruše nebo nehodě.</Text>
            {!inlineStatus ? <View style={s.pillRowBelow}><View style={s.pill}><Text style={s.pillText}>Připravujeme</Text></View><Text style={s.chev}>›</Text></View> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[s.card, compact && s.cardCompact, { minHeight: density === "compact" ? 70 : 88, paddingVertical: cardPaddingV }]} onPress={() => Alert.alert("Servisy", "Seznam servisů bude dostupný v další verzi.")} accessibilityRole="button" accessibilityLabel="Servis vozidla">
          <View style={[s.tile, { width: tileSize, height: tileSize }]}><Icon name="wrench" size={iconSize} /></View>
          <View style={s.body}>
            <View style={s.titleRow}>
              <Text style={s.title} allowFontScaling>Servis vozidla</Text>
              {inlineStatus ? <View style={[s.pill, compact && s.pillCompact]}><Text style={s.pillText}>Připravujeme</Text></View> : null}
              {inlineStatus ? <Text style={s.chev}>›</Text> : null}
            </View>
            <Text style={s.description} allowFontScaling>{density === "compact" ? "Najděte servis pro své vozidlo." : "Najděte servis nebo připravte požadavek na opravu."}</Text>
            {!inlineStatus ? <View style={s.pillRowBelow}><View style={s.pill}><Text style={s.pillText}>Připravujeme</Text></View><Text style={s.chev}>›</Text></View> : null}
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
    {bottomNav ? <View onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h && Math.abs(h - bottomNavH) > 1) setBottomNavH(h); }} style={s.bottomBar}>{bottomNav}</View> : null}
  </View>;
}
export default function GlobalHome(props: Props) { return <HomeContent {...props} />; }
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F0F7FF" },
  bottomBar: { backgroundColor: "transparent" },
  headerCenter: { paddingHorizontal: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  wordmark: { color: "#071A3A", fontWeight: "900", fontStyle: "italic", letterSpacing: -1.4, textAlign: "center" }, link: { color: "#2062F8" },
  scene: { width: "100%", marginTop: 4 },
  cards: { paddingHorizontal: 16 },
  cardPrimary: { minHeight: 92, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 20, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", shadowColor: "#1A3A5A", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3, borderWidth: 1, borderColor: "rgba(15,42,67,0.04)" },
  card: { minHeight: 88, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", shadowColor: "#1A3A5A", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2, borderWidth: 1, borderColor: "rgba(15,42,67,0.03)" },
  cardCompact: { paddingHorizontal: 12, borderRadius: 18 },
  tileBlue: { width: 56, height: 56, backgroundColor: "#E6EEFF", borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 12 },
  tile: { width: 56, height: 56, backgroundColor: "#E6EEFF", borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 12 }, redTile: { backgroundColor: "#FFECEF" },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  titlePrimary: { fontSize: 17, fontWeight: "800", color: "#0B1E3A", letterSpacing: -0.3 },
  descPrimary: { fontSize: 13, lineHeight: 17, color: "#6B7A90", fontWeight: "400", marginTop: 3 },
  title: { fontSize: 16, fontWeight: "800", color: "#0B1E3A", letterSpacing: -0.2, flexShrink: 1 },
  description: { fontSize: 13, lineHeight: 17, color: "#6B7A90", fontWeight: "400", marginTop: 3, flexShrink: 1 },
  actionBlue: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#2062FF", alignItems: "center", justifyContent: "center", marginLeft: 10 },
  actionArrow: { color: "white", fontSize: 20, fontWeight: "600", marginTop: -1, includeFontPadding: false } as any,
  pill: { backgroundColor: "#E8EEF6", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  pillCompact: { paddingHorizontal: 8, paddingVertical: 5 },
  pillText: { color: "#6B7A90", fontSize: 11, fontWeight: "600" },
  chev: { color: "#8A9BB3", fontSize: 16, fontWeight: "400", marginLeft: 2 },
  pillRowBelow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-start" },
});
