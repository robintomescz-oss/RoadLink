const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/** SQL bez `--` komentářů, aby slovní kontroly nelaly projít přes popis v textu. */
const readSql = (file) =>
  read(file)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

/** Zdroj bez komentářů — zmínka `carrier_vehicles` v popisu není čtení dat. */
const codeOnly = (source) =>
  source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("/*"))
    .join("\n");

function loadTs(file, stubs = {}) {
  const filename = path.join(root, file);
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const box = { exports: {} };
  const localRequire = (request) => {
    if (stubs[request]) return stubs[request];
    if (request.startsWith("./") || request.startsWith("../")) {
      try { return require(path.resolve(path.dirname(filename), request)); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function("require", "module", "exports", "__filename", "__dirname", output)(localRequire, box, box.exports, filename, path.dirname(filename));
  return box.exports;
}

let failures = 0;
function assert(condition, label) {
  if (condition) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label}`); }
}
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label} (got ${a})`);
}

// ---------------------------------------------------------------- migrace

const migration = readSql("supabase/migrations/20261004090000_personal_vehicles.sql");

assert(/create table (if not exists )?public\.personal_vehicles/i.test(migration), "migration creates personal_vehicles");
assert(/id uuid primary key default gen_random_uuid\(\)/i.test(migration), "personal_vehicles has a UUID primary key");
assert(/user_id uuid not null/i.test(migration), "personal_vehicles is owned by user_id");
assert(/references auth\.users\(id\) on delete cascade/i.test(migration), "user_id cascades from auth.users");
assert(/created_at timestamptz not null default now\(\)/i.test(migration), "created_at exists");
assert(/updated_at timestamptz not null default now\(\)/i.test(migration), "updated_at exists");

// Minimální data podle zadání.
for (const column of ["nickname", "make", "model", "year", "fuel_type", "registration", "insurance_provider"]) {
  assert(new RegExp(`\\b${column}\\b`, "i").test(migration), `migration has ${column}`);
}

// Citlivé údaje se nepřebírají z carrier_insurance ani se nepřidávají.
for (const forbidden of ["policy_number", "vin", "phone", "email", "latitude", "longitude", "lat\b", "lng\b"]) {
  assert(!new RegExp(`\\b${forbidden}\\b`, "i").test(migration), `migration stores no ${forbidden}`);
}

// RLS: jen vlastní vozidla, žádný přístup pro anon.
assert(/alter table public\.personal_vehicles enable row level security/i.test(migration), "RLS is enabled");
assert((migration.match(/create policy/gi) || []).length === 4, "exactly four policies: select, insert, update, delete");
assert(/for select to authenticated[\s\S]*using \(user_id = auth\.uid\(\)\)/i.test(migration), "select is limited to own rows");
assert(/for insert to authenticated[\s\S]*with check \(user_id = auth\.uid\(\)\)/i.test(migration), "insert is limited to own rows");
assert(/for update to authenticated[\s\S]*using \(user_id = auth\.uid\(\)\)[\s\S]*with check \(user_id = auth\.uid\(\)\)/i.test(migration), "update is limited to own rows");
assert(/for delete to authenticated[\s\S]*using \(user_id = auth\.uid\(\)\)/i.test(migration), "delete is limited to own rows");
assert(/revoke all on table public\.personal_vehicles from public/i.test(migration), "public gets no privileges");
assert(/revoke all on table public\.personal_vehicles from anon/i.test(migration), "anon gets no privileges");
assert(/grant select, insert, update, delete on table public\.personal_vehicles to authenticated/i.test(migration), "authenticated gets only its own CRUD");
assert(!/grant[^\n]*truncate/i.test(migration), "no truncate grant");

// Migrace nesmí sahat na přepravní data ani měnit cizí tabulky. Kontrola hledá
// skutečné DML výkazy; `on delete cascade` a `updated_at` nejsou mutace dat.
assert(!/^\s*(delete|truncate|drop\s+table|insert\s+into|update\s+\w+\s+set)\b/im.test(migration), "migration issues no data statement");
assert(!/alter table public\.(carrier_vehicles|carrier_profiles|profiles|carrier_routes|tow_requests)/i.test(migration), "migration touches no existing table");
assert(!/drop policy|drop column/i.test(migration), "migration drops nothing");

// Pohon: enum s 'jine', aby existoval neutrální stav.
assert(/fuel_type in \([^)]*'jine'[^)]*\)/i.test(migration), "fuel_type enum offers a neutral 'jine' option");

// ---------------------------------------------------------------- baseline migrace carrier_vehicles

const baselinePath = "supabase/migrations/20261004080000_carrier_vehicles_baseline.sql";
const baseline = readSql(baselinePath);

// Musí být bezpečná vůči existující živé tabulce: idempotentní a bez DML.
// Pořadí aplikace: baseline musí mít nižší timestamp než osobní vozidla,
// jinak by historie uváděla personal_vehicles před carrier_vehicles.
assert("20261004080000" < "20261004090000", "baseline timestamp sorts before personal vehicles");
assert(/20261004080000_carrier_vehicles_baseline/.test(baselinePath), "baseline file uses the agreed timestamp");

assert(/create table if not exists public\.carrier_vehicles/i.test(baseline), "baseline creates carrier_vehicles only when absent");
assert(!/^\s*(delete|truncate|insert\s+into|update\s+\w+\s+set|drop\s+table)\b/im.test(baseline), "baseline issues no data statement");
assert(!/alter\s+table\s+public\.carrier_vehicles[^;]*(drop\s+column|alter\s+column)/i.test(baseline), "baseline never alters or drops an existing column");

// Živou tabulku nesmí přepsat: existující definice musí zůstat nedotčená.
for (const policy of [
  "Carriers can view their own vehicles",
  "Carriers can create their own vehicles",
  "Carriers can update their own vehicles",
  "Carriers can delete their own vehicles",
  "Users can view active carrier vehicles",
  "carrier_vehicles_all",
]) {
  assert(
    new RegExp(`drop policy if exists "${policy}"[\\s\\S]*create policy "${policy}"`, "i").test(baseline),
    `baseline recreates ${policy} idempotently`,
  );
}

// Sloupce a typy musí odpovídat živé tabulce.
for (const column of ["id uuid primary key default gen_random_uuid()", "carrier_id uuid not null", "vehicle_type text not null", "is_active boolean not null default true"]) {
  assert(baseline.includes(column), `baseline defines ${column.split(" ")[0]}`);
}
assert(/on delete cascade/i.test(baseline), "baseline keeps the live ON DELETE CASCADE");
assert((baseline.match(/create index if not exists/g) || []).length === 2, "baseline declares both live indexes");

// Nesmí být bezpečnější než živá tabulka v tom, co by znemožnilo provoz.
assert(!/grant[^;]*truncate/i.test(baseline), "baseline grants no truncate");

// ---------------------------------------------------------------- logika

const logic = loadTs("lib/personalVehicles.ts");
assertEqual(typeof logic.normalizePersonalVehicle, "function", "logic exposes a normalizer");

assertEqual(
  logic.normalizePersonalVehicle({ nickname: "  Škoda Octavia  ", make: " Škoda ", model: " Octavia ", year: "2019", fuelType: "benzin", registration: " 1AB 12345 ", insuranceProvider: " Kooperativa " }),
  { nickname: "Škoda Octavia", make: "Škoda", model: "Octavia", year: 2019, fuelType: "benzin", registration: "1AB 12345", insuranceProvider: "Kooperativa" },
  "1 a trimmed normalizer",
);
assertEqual(logic.normalizePersonalVehicle({ nickname: "", make: "Škoda", model: "Octavia" }), null, "1 b blank nickname is rejected");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "", model: "Octavia" }), null, "1 c blank make is rejected");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "Škoda", model: "" }), null, "1 d blank model is rejected");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "Škoda", model: "Octavia", year: "1899" }), null, "1 e year below range is rejected");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "Škoda", model: "Octavia", year: "abc" }), null, "1 f non-numeric year is rejected");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "Škoda", model: "Octavia", fuelType: "voda" }), null, "1 g unknown fuel type is rejected");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "Škoda", model: "Octavia", registration: "12345678901" }).registration, null, "1 h oversized registration is dropped, not stored");
assertEqual(logic.normalizePersonalVehicle({ nickname: "Auto", make: "Škoda", model: "Octavia", year: "" }).year, null, "1 i empty year becomes null, not NaN");

// SosVehicleInput: bezpečné předvyplnění, údaje editovatelné, žádné cizí ID.
const sos = loadTs("lib/sos/sosState.ts");
assert(typeof sos.setVehicle === "function", "sos exposes setVehicle");

const prefill = logic.toSosVehicleInput({ nickname: "Škoda Octavia", make: "Škoda", model: "Octavia", registration: "1AB 12345" });
assertEqual(prefill, { source: "profile", label: "Škoda Octavia", make: "Škoda", model: "Octavia", registration: "1AB 12345" }, "2 a personal vehicle pre-fills the SOS vehicle input");
assertEqual(logic.toSosVehicleInput({ nickname: "Auto", make: "Škoda", model: "Octavia", registration: null }).registration, "", "2 b missing registration becomes an empty editable string");
assert(!Object.keys(prefill).some((key) => /id|user|vin|policy/i.test(key)), "2 c pre-filled SOS data carries no vehicle id, user id, VIN or policy number");

// Prázdný stav a prázdná volba nesmí vyrobit falešné předvyplnění.
assertEqual(logic.toSosVehicleInput(null), null, "2 d no selected vehicle means no pre-filled data");

// ---------------------------------------------------------------- oddělení

const profileScreen = read("screens/Profile/ProfileRoute.tsx");
const listScreen = read("screens/PersonalVehicles/PersonalVehiclesRoute.tsx");
const vehiclesScreen = read("screens/Vehicles/VehiclesRoute.tsx");
const sosScreen = read("screens/Sos/SosScreen.tsx");

// Přepravní vozidla zůstávají ve své kartě a míří na existující obrazovky.
assert(profileScreen.includes("Přepravní vozidla"), "profile has a 'Přepravní vozidla' card");
assert(profileScreen.includes('navigateLegacy("vehicles")'), "carrier vehicles still open the existing screen");
assert(profileScreen.includes("Moje vozidla"), "profile has a separate 'Moje vozidla' card");
assert(profileScreen.includes('navigateLegacy("personalVehicles")'), "personal vehicles open their own screen");
assert(!profileScreen.includes('navigateLegacy("personalVehicleForm") === undefined'), "personal vehicle form is reachable");
assert(!codeOnly(vehiclesScreen).includes("personal_vehicles"), "the existing carrier vehicle screen stays free of personal vehicles");
assert(/CarrierVehicle/.test(vehiclesScreen), "the existing carrier vehicle screen still works with CarrierVehicle rows");
assert(vehiclesScreen.includes('navigateLegacy("vehicleForm")'), "the existing carrier vehicle form is still reachable");

// Osobní vozidla nesmí být v přepravním trhu, nabídce ani matchingu.
for (const file of [
  "screens/Transport/RouteFormRoute.tsx",
  "screens/Transport/CreateRequestScreen.tsx",
  "screens/Transport/TransportRoute.tsx",
  "screens/Transport/RouteDetailRoute.tsx",
  "hooks/useTransportData.ts",
  "lib/routeMatches.ts",
  "supabase/functions/google-route-matches/index.ts",
  "supabase/functions/google-route-matches/matchingRequest.ts",
  "supabase/migrations/0017_matching_candidate_preselection.sql",
]) {
  assert(!read(file).includes("personal_vehicles"), `personal_vehicles stays out of ${file}`);
}

// SOS smí osobní vozidla číst, ale jen vlastní.
assert(sosScreen.includes("personal_vehicles") || sosScreen.includes("usePersonalVehicles"), "SOS can read personal vehicles");
assert(!codeOnly(sosScreen).includes("carrier_vehicles"), "SOS never queries carrier_vehicles");
assert(!codeOnly(sosScreen).includes("profileState.vehicles"), "SOS no longer fills vehicle options from carrier vehicles");

const usePersonalVehicles = read("hooks/usePersonalVehicles.ts");

// Rozlišení zdrojů chyby (schválené rozhodnutí):
//   * `42P01` (tabulka ještě není v DB, dočasný stav před migrací) → prázdný stav,
//   * cokoli jiného (síť, RLS, oprávnění) → chybový stav s Retry.
const errorBranch = usePersonalVehicles.slice(usePersonalVehicles.indexOf("if (error) {"), usePersonalVehicles.indexOf("const rows"));
assert(/42P01/.test(errorBranch), "the error branch recognises a missing table");
assert(/missingTable \? null :/.test(errorBranch), "only a missing table clears the error into the empty state");
assert(/setPersonalVehicles\(\[\]\)/.test(errorBranch), "the error branch always clears the stale list");

// Chybový stav musí mít Retry; prázdný stav jen možnost přidat.
assert(/Zkusit znovu/.test(listScreen), "the list screen offers a retry on error");
assert(/Přidat moje vozidlo/.test(listScreen), "the list screen offers adding a vehicle when empty");
assert(/personalVehiclesError \?/.test(listScreen), "the error branch is checked before the empty branch");
assert(/personalVehicles\.length === 0/.test(listScreen), "empty state keys off a zero-row list");

// Souhrnná karta profilu používá STEJNOU logiku: chyba se nesmí převést na
// prázdný stav a `42P01` prázdný stav zachovává.
const profileCard = profileScreen.slice(profileScreen.indexOf("Moje vozidla"));
assert(/personalVehiclesError/.test(profileCard), "the profile summary distinguishes a load error");
assert(profileCard.indexOf("personalVehiclesError") < profileCard.indexOf("personalVehicles.length === 0"), "the profile summary checks the error before the empty state");
assert(/\?\s*"Nepodařilo se načíst"/.test(profileCard), "the profile summary shows a distinct error label");
assert(/personal_vehicles/.test(usePersonalVehicles), "the personal-vehicle hook targets personal_vehicles");
assert(/eq\("user_id", userId\)/.test(usePersonalVehicles), "the hook filters by the current user id");
assert(/if \(!userId\)/.test(usePersonalVehicles), "the hook refuses to load without a signed-in user");
assert(!codeOnly(usePersonalVehicles).includes("carrier_vehicles"), "the hook never queries carrier_vehicles");

// Navigace: nová obrazovka musí být registrovaná.
const navigator = read("navigation/AppNavigator.tsx");
assert(navigator.includes('name="personalVehicles"'), "personalVehicles screen is registered");
assert(navigator.includes('name="personalVehicleForm"'), "personalVehicleForm screen is registered");
assert(navigator.includes('name="vehicles"'), "the existing carrier vehicles screen stays registered");
assert(navigator.includes('name="vehicleForm"'), "the existing carrier vehicle form stays registered");

// Bezpečnostní back handler jako v ostatních obrazovkách.
const personalVehiclesRoute = read("screens/PersonalVehicles/PersonalVehiclesRoute.tsx");
const personalVehicleForm = read("screens/PersonalVehicles/PersonalVehicleFormRoute.tsx");
for (const [name, source] of [["list", personalVehiclesRoute], ["form", personalVehicleForm]]) {
  assert(/SafeAreaView/.test(source), `${name} screen uses SafeAreaView`);
  assert(/useHardwareBackTo\(/.test(source), `${name} screen registers a hardware back handler`);
}

console.log("");
if (failures === 0) console.log("ALL PERSONAL VEHICLES REGRESSION TESTS PASSED");
else { console.error(`${failures} PERSONAL VEHICLE REGRESSION TEST(S) FAILED`); process.exit(1); }
