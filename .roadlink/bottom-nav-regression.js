const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let failures = 0;
function check(condition, label) {
  if (condition) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label}`); }
}

const bottomNav = read("components/BottomNav.tsx");
const appBottomNav = read("components/AppBottomNav.tsx");
const transport = read("screens/Transport/TransportRoute.tsx");
const profile = read("screens/Profile/ProfileRoute.tsx");
const home = read("screens/Home/HomeRoute.tsx");
const appContext = read("contexts/AppContext.tsx");
const appNavigator = read("navigation/AppNavigator.tsx");

// ── Spodní lišta: přesně tři položky ───────────────────────────────
check(!/key: "sos"/.test(bottomNav), "bottom nav has no SOS item");
check(!/key: "create"/.test(bottomNav), "bottom nav has no Vytvořit item");
check(!/key: "mine"/.test(bottomNav), "bottom nav has no Moje item");

const keys = [...bottomNav.matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
check(
  JSON.stringify(keys) === JSON.stringify(["overview", "transport", "profile"]),
  `bottom nav has exactly three keys [overview, transport, profile] (got ${JSON.stringify(keys)})`
);

// ── Ikony a názvy ──────────────────────────────────────────────────
const items = [...bottomNav.matchAll(/key: "([a-z]+)", *label: "([^"]+)", *icon: "(\w+)"/g)];
check(items.length === 3, `three nav items parsed (got ${items.length})`);
check(
  items.some((m) => m[1] === "overview" && m[2] === "Přehled" && m[3] === "dashboard"),
  "Přehled uses the dashboard icon"
);
check(!/\bhome\b|\bhouse\b|\broof\b/i.test(bottomNav), "no home icon in the bottom nav");
check(items.some((m) => m[1] === "transport" && m[2] === "Trh"), "Trh points at transport");
check(items.some((m) => m[1] === "profile" && m[2] === "Profil"), "Profil is the third item");
check(items.every((m) => m[3] !== "null"), "no centre-only create button remains");

// ── Chování tlačítka Přehled ────────────────────────────────────────
check(
  /key === "overview"/.test(appBottomNav) && /navigateLegacy\("home"\)/.test(appBottomNav),
  "Přehled still navigates to home"
);
check(
  /key === "profile" && !userId/.test(appBottomNav) && /navigateLegacy\("login"\)/.test(appBottomNav),
  "signed-out user tapping Profil is sent to login"
);

// ── Trh: výchozí tab Vše + login guard pro Moje ───────────────────
check(
  /useState<TransportTab>\("all"\)/.test(appContext),
  "transport tab defaults to all"
);
check(
  /\["Vše", "Poptávky", "Volná kapacita", "Moje"\]/.test(transport),
  "market tabs are Vše / Poptávky / Volná kapacita / Moje"
);
check(
  /value === "mine" && !userId/.test(transport) && /navigateLegacy\("login"\)/.test(transport),
  "Moje tab sends a signed-out user to login"
);

// ── Vytvoření jen v Trhu ───────────────────────────────────────────
check(/navigateLegacy\("create"\)/.test(transport), "the market screen opens the create screen");
check(/Vytvořit poptávku nebo kapacitu/.test(transport), "the market screen has the create action label");
check(!/key === "create"/.test(appBottomNav), "the bottom nav handler no longer routes a create key");
check(fs.existsSync(path.join(root, "screens/Create/CreateRoute.tsx")), "the create screen still exists");
check(/name="create"/.test(appNavigator), "create route is still registered");

// ── Profil: Moje přepravy → Trh na tabu Moje ───────────────────────
check(
  /setTransportTab\("mine"\)/.test(profile) && /navigateLegacy\("transport"\)/.test(profile),
  "profile Moje přepravy opens the market on the Moje tab"
);

// ── Rozlišení názvů vozidel ────────────────────────────────────────
check(/Přepravní vozidla/.test(profile), "profile uses 'Přepravní vozidla'");
check(/Moje vozidla/.test(profile), "profile uses 'Moje vozidla' for personal vehicles");

const vehiclesScreen = read("screens/Vehicles/VehiclesRoute.tsx");
check(
  !/title="Moje vozidla"/.test(vehiclesScreen),
  "the carrier-vehicle screen does NOT use the title 'Moje vozidla'"
);
check(/title="Přepravní vozidla"/.test(vehiclesScreen), "the carrier-vehicle screen is titled 'Přepravní vozidla'");

// ── SOS zůstává jen na hlavní obrazovce ─────────────────────────────
check(/sos/i.test(home), "home screen keeps a SOS entry point");

console.log("");
if (failures === 0) console.log("ALL BOTTOM NAV SIMPLIFICATION TESTS PASSED");
else { console.error(`${failures} BOTTOM NAV TEST(S) FAILED`); process.exit(1); }
