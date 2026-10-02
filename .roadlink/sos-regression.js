/**
 * Regresní test SOS modulu „Emergency Wizard".
 *
 * Ověřuje:
 *  - obsah a bezpečnostní/komunikační zásady (tísňová čísla, trojúhelník,
 *    kontrolky, seznam problémů, nehodový checklist a jeho právní metadata),
 *  - stavový automat (průběh, stav zásahu, ochrana proti duplicitám,
 *    „síťová chyba = nikdy neodesláno"),
 *  - popis polohy (GPS vs ruční popis, zastaralá poloha, oddělení souřadnic),
 *  - odhad typu komunikace (jen z mapových dat, uživatel může opravit),
 *  - integrační rozhraní asistence a poctivý fallback,
 *  - zapojení do navigace a přístupnostní záměry v UI.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}`);
  }
}
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}${a === e ? "" : `\n  expected: ${e}\n  actual:   ${a}`}`);
}

function loadModule(rel, stubs = {}) {
  const filename = path.join(root, rel);
  const output = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith("./") || request.startsWith("../")) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function("require", "module", "exports", "__filename", "__dirname", output)(
    localRequire, module, module.exports, filename, path.dirname(filename)
  );
  return module.exports;
}

const content = loadModule("lib/sos/sosContent.ts");
const state = loadModule("lib/sos/sosState.ts", { "./sosContent": content });
const assistance = loadModule("lib/sos/assistanceProvider.ts", {
  "./sosContent": content,
  "./sosState": state,
});

// ── 1. Tísňová čísla a úvodní rozcestník ───────────────────────────────────
assertEqual(content.EMERGENCY_CONTACTS.map((c) => c.number), ["155", "112", "158"], "tři tísňová čísla: 155, 112, 158");
assert(
  content.EMERGENCY_CONTACTS.every((c) => c.tel === `tel:${c.number}`),
  "každé číslo je odkaz tel: (nikdy automatické volání)"
);
assertEqual(content.INTRO_CHOICES.map((c) => c.id), ["injured", "danger", "breakdown"], "úvodní rozcestník má tři volby");
assertEqual(content.INTRO_CHOICES[0].callContacts, ["medical", "general"], "zranění nabízí 155 a alternativně 112");
assertEqual(content.INTRO_CHOICES[1].callContacts, ["general"], "požár/nebezpečí nabízí 112");
assertEqual(content.INTRO_CHOICES[2].callContacts, [], "porucha bez zranění nic nevnucuje");
assert(content.SOS_OPERATOR_INSTRUCTION.includes("operátora"), "je uvedeno řídit se pokyny operátora");
assert(content.SOS_NEVER_AUTO_CALL_NOTE.toLowerCase().includes("nikdy nevolá automaticky"), "aplikace nikdy nevolá automaticky");

// ── 2. Bezpečnost na místě ─────────────────────────────────────────────────
assertEqual(content.SAFETY_STEPS.map((s) => s.id), ["hazard_lights", "vest", "safe_exit", "triangle"], "čtyři bezpečnostní kroky");
assertEqual(content.SAFETY_ACTIONS.map((a) => a.label), ["Hotovo", "Už hotovo", "Nelze bezpečně provést"], "tři volby u každého kroku");
const triangle = content.SAFETY_STEPS.find((s) => s.id === "triangle");
assert(triangle.notes.some((n) => n.includes("50")), "trojúhelník: ≥50 m");
assert(triangle.notes.some((n) => n.includes("100")), "trojúhelník: na dálnici ≥100 m");
assert(triangle.notes.some((n) => n.toLowerCase().includes("nepočítejte na kroky")), "trojúhelník: zákaz převodu na kroky");
assert(triangle.notes.some((n) => n.includes("obci")), "trojúhelník: v obci může být kratší");
const safeExit = content.SAFETY_STEPS.find((s) => s.id === "safe_exit");
assert(safeExit.notes.some((n) => n.includes("svodidla")), "přesun za svodidla na dálnici");
assert(safeExit.notes.some((n) => n.toLowerCase().includes("nevstupujte")), "nevstupovat do jízdních pruhů");
assert(content.SOS_SAFETY_NEVER_BLOCKS.includes("nezastaví"), "žádný krok neblokuje přivolání pomoci");
assert(content.SOS_SAFETY_NO_MOVE_INJURED.includes("operátora"), "se zraněnými nemanipulovat bez pokynu operátora");
const vest = content.SAFETY_STEPS.find((s) => s.id === "vest");
assert(vest.description.includes("pokud ji máte"), "vesta jen pokud je dostupná");

// ── 3. Kontrolky ───────────────────────────────────────────────────────────
const blinking = content.assessWarningLight({ symbol: "motor", state: "blinking", hasVehicleMessage: false, symptoms: [] });
assert(blinking.considerations.some((c) => c.toLowerCase().includes("blikající")), "blikající kontrolka je naléhavější");
assert(blinking.disclaimers.some((d) => d.includes("oranžová")), "žádné „oranžová = dojet“");
assert(blinking.disclaimers.some((d) => d.includes("červená")), "žádné univerzální „červená = vypnout motor“");
assert(blinking.manufacturerTakesPrecedence === true, "návod výrobce má přednost");
assert(blinking.kind === "orientational", "výsledek je orientační");
const smoky = content.assessWarningLight({ symbol: "olej", state: "steady", hasVehicleMessage: true, symptoms: ["smoke"] });
assert(smoky.urgent === true, "kouř je urgentní příznak");
assert(smoky.recommendation.includes("112"), "u ohně/kouře doporučí 112");
assert(!Object.keys(content.assessWarningLight({ symbol: "", state: "unknown", hasVehicleMessage: false, symptoms: [] })).includes("color"), "posouzení nezná barvu (nerozhoduje podle barvy)");

// ── 4. Určení problému ─────────────────────────────────────────────────────
assertEqual(
  content.PROBLEM_CATEGORIES.map((p) => p.id),
  ["warning_light", "tyre", "no_start", "out_of_fuel", "wrong_fuel", "accident", "other"],
  "sedm kategorií problému"
);
const noStart = content.PROBLEM_CATEGORIES.find((p) => p.id === "no_start");
assert(noStart.guidance.some((g) => g.toLowerCase().includes("ne automaticky") || g.toLowerCase().includes("nejde automaticky")), "„nelze nastartovat“ ≠ automaticky baterie");
const wrongFuel = content.PROBLEM_CATEGORIES.find((p) => p.id === "wrong_fuel");
assert(wrongFuel.guidance.some((g) => g.toLowerCase().includes("nestartujte")), "nesprávné palivo: nestartovat");
assert(content.PROBLEM_CATEGORIES.every((p) => !/vyměňte|opravte si/i.test(p.guidance.join(" "))), "žádné návody na nebezpečné opravy u silnice");

// ── 5. Nehodový checklist ──────────────────────────────────────────────────
assert(content.SOS_LEGAL_METADATA.country === "CZ", "právní obsah má zemi CZ");
assert(content.SOS_LEGAL_METADATA.reviewStatus === "pending_expert_review", "stav ověření je přiznaně neověřený");
assertEqual(content.SOS_LEGAL_METADATA.sources, ["Policie ČR", "BESIP", "HZS"], "uvedené zdroje k ověření");
const injuryItem = content.ACCIDENT_CHECKLIST.find((i) => i.id === "injury");
assert(injuryItem.legal === true, "zranění je zákonný důvod");
const damageItem = content.ACCIDENT_CHECKLIST.find((i) => i.id === "damage_over_200k");
assert(damageItem.note.includes("není to součet") || damageItem.note.toLowerCase().includes("není to součet"), "limit není součet škod všech vozidel");
const allNo = {};
for (const item of content.ACCIDENT_CHECKLIST) allNo[item.id] = "no";
assertEqual(content.evaluateAccidentChecklist(allNo).callPolice, false, "samá ne → policii nevolat");
const injuryYes = { ...allNo, injury: "yes" };
const evalInjury = content.evaluateAccidentChecklist(injuryYes);
assert(evalInjury.callPolice === true, "zranění ano → volat policii");
assert(evalInjury.legalReasons.length === 1 && evalInjury.legalReasons[0].includes("zranění"), "uvede konkrétní zákonný důvod");
const unknownLegal = { ...allNo, damage_over_200k: "unknown" };
const evalUnknown = content.evaluateAccidentChecklist(unknownLegal);
assert(evalUnknown.callPolice === true && evalUnknown.hasUnknownLegal === true, "nejistota u zákonného bodu → raději volat policii");
const dispute = { ...allNo, dispute: "yes" };
assertEqual(content.evaluateAccidentChecklist(dispute).recommendations.length, 1, "spor je doporučení, ne zákonný důvod");
assert(content.SOS_ACCIDENT_NO_POLICE_REMINDER.includes("podepsaný záznam"), "připomínka společného záznamu");
assert(content.SOS_ACCIDENT_NO_POLICE_REMINDER.includes("bezpečného místa"), "fotky jen z bezpečného místa");

// ── 6. Stavový automat ─────────────────────────────────────────────────────
let s = state.createInitialSosState();
assertEqual(s.stage, "intro", "průvodce začíná na úvodu");
assert(state.canSubmitOrder(s) === true, "na začátku lze objednat");
assertEqual(state.applyIntroChoice(s, "injured").stage, "call", "zranění → nabídka volání");
assertEqual(state.applyIntroChoice(s, "breakdown").stage, "safety", "porucha → bezpečnost na místě");

s = state.beginOrder(s, "req-1", null, 1000);
assertEqual(s.order.status, "sending", "beginOrder nastaví stav odesílání");
assert(state.canSubmitOrder(s) === false, "během odesílání nelze objednat znovu");
const doubleSubmit = state.beginOrder(s, "req-2", null, 2000);
assertEqual(doubleSubmit.order.clientRequestId, "req-1", "opakované odeslání nezmění klíč (ochrana proti duplicitám)");

let sent = state.orderSent(s, { orderId: "o-1", etaMinutes: 40 });
assertEqual(sent.order.status, "sent", "úspěch serveru → stav „odesláno“");
assert(state.canSubmitOrder(sent) === false, "po odeslání nelze odeslat znovu");
const sentView = state.orderStatusView("sent");
assert(sentView.description.toLowerCase().includes("nikdo nepřijal") || sentView.description.toLowerCase().includes("čekáme"), "„odesláno“ ≠ „přijato“");
assert(state.orderStatusView("accepted").label.includes("přijal"), "přijetí je samostatný stav");
assert(state.orderStatusView("en_route").description.includes("odhad"), "ETA je označena jako odhad");

let failed = state.orderFailed(s, "timeout");
assertEqual(failed.order.status, "failed", "síťová chyba → stav selhalo");
assertEqual(failed.order.orderId, null, "při chybě se nenastaví ID objednávky");
assert(failed.order.status !== "sent", "síťová chyba NIKDY neznamená „odesláno“");
assert(state.canSubmitOrder(failed) === true, "po chybě lze bezpečně zkusit znovu");
assertEqual(state.resetFailedOrder(failed).order.status, "idle", "retry uvolní objednávku");
const retryReady = state.resetFailedOrder(failed);
assertEqual(retryReady.order.clientRequestId, "req-1", "timeout retry zachová původní idempotency klíč");
const retryKey = assistance.resolveClientRequestId(retryReady.order.clientRequestId, () => "unexpected-new-key");
const retrySending = state.beginOrder(retryReady, retryKey, null, 3000);
assertEqual(retrySending.order.clientRequestId, "req-1", "další pokus odešle stejný klíč i po ztracené odpovědi");
const secondRetry = state.resetFailedOrder(state.orderFailed(retrySending, "another timeout"));
assertEqual(secondRetry.order.clientRequestId, "req-1", "opakované timeouty zachovají stejný klíč");
assertEqual(state.resetFailedOrder(sent), sent, "retry nesmí resetovat existující odeslanou objednávku");
assertEqual(state.resetFailedOrder(state.orderStatusChanged(s, "rejected")).order.clientRequestId, null, "potvrzené odmítnutí dovolí nový klíč");
assertEqual(state.cancelOrder(s).order.status, "sending", "během odesílání nelze zrušit");
assertEqual(state.cancelOrder(sent).order.status, "cancelled", "odeslanou objednávku lze zrušit");
assertEqual(state.orderStatusView("rejected").tone, "error", "odmítnutí má chybový tón");
assert(state.orderStatusChanged(s, "en_route", { etaMinutes: 12 }).order.etaMinutes === 12, "změna stavu umí předat ETA");

// ── 7. Poloha ──────────────────────────────────────────────────────────────
const manualLoc = state.describeLocation({ rawLocation: null, manualDescription: "D1 km 112", nowMs: 0 });
assertEqual(manualLoc.mode, "manual", "ruční popis → režim manual");
assertEqual(manualLoc.coordinates, null, "ruční popis NIKDY nedostane odhadnuté souřadnice");
const noneLoc = state.describeLocation({ rawLocation: null, manualDescription: "", nowMs: 0 });
assertEqual(noneLoc.mode, "none", "bez polohy i popisu → none");
const freshLoc = state.describeLocation({
  rawLocation: { latitude: 49.1, longitude: 16.6, accuracyMeters: 12, capturedAt: 1_000_000 },
  manualDescription: "",
  nowMs: 1_000_000 + 60_000,
});
assertEqual(freshLoc.mode, "gps", "GPS → režim gps");
assertEqual(freshLoc.freshness, "fresh", "čerstvá poloha je fresh");
assert(freshLoc.accuracyText.includes("12"), "uvede přesnost");
const staleLoc = state.describeLocation({
  rawLocation: { latitude: 49.1, longitude: 16.6, accuracyMeters: 30, capturedAt: 1_000_000 },
  manualDescription: "",
  nowMs: 1_000_000 + state.SOS_LOCATION_STALE_MS + 1,
});
assertEqual(staleLoc.freshness, "stale", "stará poloha je stale");
assert(staleLoc.disclaimer.toLowerCase().includes("zastaralá"), "u zastaralé polohy varuje");

// ── 8. Odhad typu komunikace ───────────────────────────────────────────────
const noMap = state.suggestRoadType({ mapDataAvailable: false, suggested: "motorway", userOverride: null });
assertEqual(noMap.value, "unknown", "bez mapových dat se typ neodhaduje (z GPS ne)");
const withMap = state.suggestRoadType({ mapDataAvailable: true, suggested: "motorway", userOverride: null });
assertEqual(withMap.source, "map", "s mapovými daty jde o odhad z mapy");
assert(withMap.note.toLowerCase().includes("opravit"), "odhad lze opravit");
const override = state.suggestRoadType({ mapDataAvailable: true, suggested: "motorway", userOverride: "town" });
assertEqual(override.value, "town", "volba uživatele přebije odhad");

// ── 9. Souhrn pro předání ──────────────────────────────────────────────────
const summary = state.buildRequestSummary({
  problemId: "tyre",
  location: manualLoc,
  vehicle: { source: "manual", label: "Škoda Octavia", make: "Škoda", model: "Octavia", registration: "1AB 2345" },
  roadType: "motorway",
});
assertEqual(summary.problemLabel, content.getProblemCategory("tyre").title, "souhrn obsahuje název problému");
assertEqual(summary.roadTypeLabel, "Dálnice", "souhrn obsahuje typ komunikace");
assert(summary.vehicleLabel.includes("Škoda"), "souhrn obsahuje vozidlo");

// ── 10. Integrace asistence (poctivý fallback) ─────────────────────────────
(async () => {
  assistance.resetAssistanceProvider();
  const provider = assistance.getAssistanceProvider();
  assert(provider.isConfigured() === false, "výchozí provider není nakonfigurovaný");
  const result = await provider.requestOrder({
    clientRequestId: "x",
    problemId: "tyre",
    problemLabel: "Defekt",
    location: manualLoc,
    vehicle: null,
    roadTypeLabel: "Dálnice",
    disclosedItems: [],
  });
  assertEqual(result.status, "unavailable", "bez reálného API vrací „unavailable“");
  assertEqual(result.fallback, "phone", "nabízí telefonní fallback");
  assert(!content.SOS_ORDER_NO_PARTNER_YET.includes("vymysleli"), "text nepředstírá partnery");

  const fakeProvider = {
    id: "fake",
    isConfigured: () => true,
    getOffer: async () => ({ offerId: "quote-1", providerName: "P", serviceScope: "Odtah", confirmedPrice: "1500 Kč", estimatedPrice: null, etaMinutes: 15, cancellationTerms: "Storno 0 Kč" }),
    cancelOrder: async (id) => { assertEqual(id, "o-9", "storno předá skutečné ID objednávky poskytovateli"); return { cancelled: true }; },
    requestOrder: async () => ({ status: "accepted_by_provider", orderId: "o-9", offer: { providerName: "P", serviceScope: "s", confirmedPrice: null, estimatedPrice: "odhad", etaMinutes: 15, cancellationTerms: "dle podmínek" } }),
  };
  assistance.setAssistanceProvider(fakeProvider);
  assert(assistance.getAssistanceProvider().isConfigured() === true, "provider lze vyměnit");
  const quote = await fakeProvider.getOffer({});
  assertEqual(quote.confirmedPrice, "1500 Kč", "nabídka poskytne cenu před objednáním");
  const activeOrder = state.orderSent(state.beginOrder(state.createInitialSosState(), "cancel-key", "fake", 0), { orderId: "o-9", etaMinutes: 15 });
  assertEqual((await assistance.cancelConfirmedOrder(fakeProvider, activeOrder)).order.status, "cancelled", "potvrzené storno změní stav");
  for (const cancelOrder of [async () => ({ cancelled: false }), async () => { throw new Error("timeout"); }]) {
    let rejected = false;
    try { await assistance.cancelConfirmedOrder({ ...fakeProvider, cancelOrder }, activeOrder); } catch { rejected = true; }
    assert(rejected, "nepotvrzené nebo síťově selhané storno se nevykazuje jako zrušení");
    assertEqual(activeOrder.order.status, "sent", "nepotvrzené storno zachová aktivní objednávku");
  }
  assistance.resetAssistanceProvider();
  assert(assistance.getAssistanceProvider().id === "none", "reset vrátí výchozího providera");

  assistance.resetClientRequestIdCounter();
  assertEqual(assistance.resolveClientRequestId("keep-me"), "keep-me", "existující klíč se drží (idempotence)");
  const generated = assistance.resolveClientRequestId(null);
  assert(typeof generated === "string" && generated.startsWith("sos-"), "chybějící klíč se vygeneruje");
  assert(assistance.defaultClientRequestId() !== assistance.defaultClientRequestId(), "vygenerované klíče jsou unikátní");

  // ── 11. Zapojení do aplikace + přístupnostní záměry ──────────────────────
  const navigator = read("navigation/AppNavigator.tsx");
  assert(navigator.includes('name="sos"'), "SOS route je v navigátoru");
  const route = read("screens/Sos/SosRoute.tsx");
  assert(route.includes("SosScreen") && route.includes('useHardwareBackTo("home")'), "SOS route používá nový screen a vrací se na Přehled");
  const bottomNav = read("components/BottomNav.tsx");
  assert(bottomNav.includes('key: "sos"'), "SOS je v hlavní navigaci");
  assert(bottomNav.includes("bottomNavSosButton"), "SOS tlačítko má vlastní výrazný styl");
  const screen = read("screens/Sos/SosScreen.tsx");
  assert(screen.includes("EmergencyCallBar") && screen.includes("TÍSŇOVÉ VOLÁNÍ"), "tísňové volání je dostupné na všech krocích");
  assert(screen.includes("accessibilityRole") && screen.includes("accessibilityLiveRegion"), "obrazovka používá role a live region");
  assert(screen.includes("allowFontScaling"), "texty podporují zvětšení písma");
  assert(!screen.includes("useEffect") && !screen.includes("Animated"), "bez animací → respektuje omezení pohybu");
  assert(!screen.includes("userId"), "modul nevyžaduje registraci (nečte userId)");

  const styles = read("lib/sosStyles.ts");
  assert(styles.includes("#0f172a"), "tmavý podklad #0f172a");
  assert(styles.includes("minHeight: 60") || styles.includes("minHeight: 52"), "ovládací prvky ≥ 48 px");

  if (failures > 0) {
    console.error(`SOS REGRESSION: ${failures} FAILED`);
    process.exit(1);
  }
  console.log("ALL SOS TESTS PASSED");
})();
