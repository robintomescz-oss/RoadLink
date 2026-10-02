import { Platform, StatusBar, StyleSheet } from "react-native";

/**
 * Styl pro SOS modul. Záměrně oddělený od lib/appStyles.ts:
 *  - SOS má vlastní tmavý režim (#0f172a) kvůli čitelnosti ve stresu,
 *  - drží se stranou světlý zbytek aplikace.
 *
 * Zásady:
 *  - Vysoký kontrast (bílý text na tmavém).
 *  - Dotykové plochy ≥ 48 px.
 *  - Bez animací → respektuje omezení pohybu.
 */

export const SOS = {
  bg: "#0f172a",
  bgElevated: "#16213a",
  bgCard: "#1c2740",
  border: "#33415c",
  text: "#ffffff",
  textMuted: "#b8c2d9",
  textFaint: "#8492ad",
  accent: "#3b82f6",
  accentSoft: "#1e3a5f",
  danger: "#ef4444",
  dangerSoft: "#3a1d24",
  warning: "#f59e0b",
  success: "#22c55e",
} as const;

export const sosStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SOS.bg },
  safeTop: { paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0 },

  // ── Hlavička ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerBack: { minHeight: 48, minWidth: 48, justifyContent: "center" },
  headerBackText: { color: SOS.text, fontSize: 26, fontWeight: "700" },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: SOS.text, fontSize: 20, fontWeight: "800" },
  headerSubtitle: { color: SOS.textMuted, fontSize: 12, marginTop: 2 },

  // ── Trvalý pruh tísňového volání ──
  emergencyBar: {
    backgroundColor: SOS.bgElevated,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: SOS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  emergencyBarTitle: {
    color: SOS.text,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  emergencyRow: { flexDirection: "row", gap: 8 },
  emergencyButton: {
    flex: 1,
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: SOS.dangerSoft,
    borderWidth: 2,
    borderColor: SOS.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  emergencyButtonPolice: {
    backgroundColor: SOS.accentSoft,
    borderColor: SOS.accent,
  },
  emergencyNumber: { color: SOS.text, fontSize: 22, fontWeight: "900" },
  emergencyLabel: {
    color: SOS.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
  },
  neverAutoCall: { color: SOS.textFaint, fontSize: 11, lineHeight: 15 },

  // ── Obsah ──
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  bigTitle: { color: SOS.text, fontSize: 26, fontWeight: "900", lineHeight: 32 },
  sectionText: { color: SOS.textMuted, fontSize: 14, lineHeight: 20 },
  footnote: { color: SOS.textFaint, fontSize: 12, lineHeight: 17 },
  divider: { height: 1, backgroundColor: SOS.border, marginVertical: 4 },

  // ── Karty voleb ──
  choiceCard: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: SOS.bgCard,
    borderWidth: 1,
    borderColor: SOS.border,
    borderRadius: 18,
    padding: 16,
  },
  choiceIcon: { fontSize: 40 },
  choiceBody: { flex: 1, gap: 3 },
  choiceTitle: { color: SOS.text, fontSize: 20, fontWeight: "800" },
  choiceDesc: { color: SOS.textMuted, fontSize: 14, lineHeight: 19 },
  choiceArrow: { color: SOS.textFaint, fontSize: 28, fontWeight: "700" },

  // ── Karty kroků / obecné ──
  card: {
    backgroundColor: SOS.bgCard,
    borderWidth: 1,
    borderColor: SOS.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  cardTitle: { color: SOS.text, fontSize: 18, fontWeight: "800" },
  cardText: { color: SOS.textMuted, fontSize: 14, lineHeight: 20 },
  stepHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepIcon: { fontSize: 30 },
  stepTitle: { flex: 1, color: SOS.text, fontSize: 18, fontWeight: "800" },
  noteText: { color: SOS.textMuted, fontSize: 13, lineHeight: 18 },
  // Odkaz z prázdného stavu: „Přidat vozidlo do profilu“. Styl odpovídá ostatním
  // akčním odkazům v SOS, jen je tichší než hlavní tlačítko.
  noteLink: { alignSelf: "flex-start", marginTop: 6, paddingVertical: 4, paddingHorizontal: 2 },
  noteLinkText: { color: SOS.accent, fontSize: 13, fontWeight: "700" },

  // ── Tlačítka ──
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionButton: {
    flexGrow: 1,
    flexBasis: "30%",
    minHeight: 52,
    minWidth: 48,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: SOS.border,
    backgroundColor: SOS.bgElevated,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  actionButtonActive: { borderColor: SOS.accent, backgroundColor: SOS.accentSoft },
  actionButtonDone: { borderColor: SOS.success, backgroundColor: "#123322" },
  actionButtonWarn: { borderColor: SOS.warning, backgroundColor: "#33280f" },
  actionButtonText: { color: SOS.text, fontSize: 14, fontWeight: "700", textAlign: "center" },

  primary: {
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: SOS.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryText: { color: SOS.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  primaryDanger: { backgroundColor: SOS.danger },
  secondary: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: SOS.border,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryText: { color: SOS.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.45 },

  // ── Formuláře ──
  inputLabel: { color: SOS.textMuted, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: SOS.border,
    backgroundColor: SOS.bg,
    color: SOS.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  multilineInput: { minHeight: 84, textAlignVertical: "top" },

  // ── Volby (chips) ──
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: SOS.border,
    backgroundColor: SOS.bgElevated,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { borderColor: SOS.accent, backgroundColor: SOS.accentSoft },
  chipText: { color: SOS.text, fontSize: 14, fontWeight: "700" },

  // ── Souhrn / stav ──
  summaryRow: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  summaryLabel: { color: SOS.textFaint, fontSize: 13, fontWeight: "700", width: 96 },
  summaryValue: { flex: 1, color: SOS.text, fontSize: 14, lineHeight: 20 },
  disclosureCard: {
    backgroundColor: SOS.bgElevated,
    borderWidth: 1,
    borderColor: SOS.border,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusIcon: { fontSize: 30 },
  statusLabel: { color: SOS.text, fontSize: 18, fontWeight: "800", flex: 1 },
  statusDesc: { color: SOS.textMuted, fontSize: 14, lineHeight: 19, marginTop: 6 },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: SOS.bgElevated,
    borderWidth: 1,
    borderColor: SOS.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: SOS.textMuted, fontSize: 11, fontWeight: "700" },
  dangerText: { color: "#fca5a5", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  successText: { color: "#86efac", fontSize: 14, fontWeight: "700", lineHeight: 20 },
});
