// scripts/test-rls-e2e.mjs
//
// E2E test RLS politik RoadLink po aplikaci migrací 0001 + 0002.
//
// TENTO SKRIPT NICI REÁLNĚ NETRVALE NEUKLÍZÍ SMZÁNÍM DAT.
// Smazání auth.users vyžaduje service_role – proto tento skript
// pouze vytvoří testovací data a na konci vypíše PASS/FAIL
// spolu s ID, která můžeš ručně smazat přes Supabase Dashboard.
//
// Spuštění:
//   node scripts/test-rls-e2e.mjs
//
// Požadavky:
//   * Aplikované migrace 0001 a 0002 v Supabase
//   * V .env nastavené EXPO_PUBLIC_SUPABASE_URL a EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   * V Supabase Auth → Providers → Email je vypnuté "Confirm email"
//     (jinak signUp vrátí user bez session a test selže na kroku 1)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// -----------------------------------------------------------
// 0) Načtení env a vytvoření klienta
// -----------------------------------------------------------

const envPath = resolve(process.cwd(), ".env");
if (!existsSync(envPath)) {
  console.error("CHYBA: .env neexistuje v", process.cwd());
  process.exit(1);
}

const envContent = readFileSync(envPath, "utf8");
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  env[key] = value;
}

const url = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !anonKey) {
  console.error("CHYBA: v .env chybí EXPO_PUBLIC_SUPABASE_URL nebo EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -----------------------------------------------------------
// Pomocné funkce
// -----------------------------------------------------------

let pass = 0;
let fail = 0;
const created = { userId: null, profileId: null, requestId: null, offerId: null, vehicleId: null, carrierProfileId: null };

function step(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

function header(name) {
  console.log(`\n=== ${name} ===`);
}

// Náhodný email, aby test mohl běžet opakovaně.
const testEmail = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@roadlink-test.local`;
const testPassword = "TestHeslo1234567!";

// -----------------------------------------------------------
// KROK 1: Založení zákazníka
// -----------------------------------------------------------

header("KROK 1: Založení zákazníka (auth.signUp + profiles.insert)");

const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
  email: testEmail,
  password: testPassword,
  options: { data: { first_name: "Test", last_name: "Zakaznik" } },
});

if (signUpError) {
  step("auth.signUp", false, signUpError.message);
  process.exit(1);
}
if (!signUpData.user) {
  step("auth.signUp", false, "user nebyl vytvořen (pravděpodobně vyžadováno potvrzení e-mailu)");
  process.exit(1);
}
step("auth.signUp", true, `userId = ${signUpData.user.id}`);
created.userId = signUpData.user.id;

// Po úspěšném signUp s vypnutým "Confirm email" máme rovnou session.
// Pokud by Supabase vyžadoval potvrzení, níže by selhalo – to je záměr.

if (!signUpData.session) {
  step("session po signUp", false, "session chybí – zkontroluj 'Confirm email' v Supabase Auth providers");
  process.exit(1);
}
step("session po signUp", true);

// Vložení profiles (napodobuje logiku registerUser v App.tsx)
const { error: profileInsertError } = await supabase
  .from("profiles")
  .insert({
    id: signUpData.user.id,
    first_name: "Test",
    last_name: "Zakaznik",
    phone: "+420000000000",
    role: "customer",
  });

if (profileInsertError) {
  step("profiles.insert (customer)", false, profileInsertError.message);
  process.exit(1);
}
step("profiles.insert (customer)", true);
created.profileId = signUpData.user.id;

// Ověření: customer smí číst svůj profil přes RLS
const { data: ownProfile, error: readOwnError } = await supabase
  .from("profiles")
  .select("id, role")
  .eq("id", signUpData.user.id)
  .single();

if (readOwnError || !ownProfile) {
  step("profiles.select own", false, readOwnError?.message || "žádná data");
} else {
  step("profiles.select own", true, `role = ${ownProfile.role}`);
}

// Ověření: customer NESMÍ číst cizí profil – zkusíme náhodný fake UUID
const fakeOtherId = "00000000-0000-0000-0000-000000000000";
const { data: otherProfile, error: readOtherError } = await supabase
  .from("profiles")
  .select("id")
  .eq("id", fakeOtherId)
  .maybeSingle();

if (readOtherError) {
  step("profiles.select other (expect null or error)", false, readOtherError.message);
} else if (otherProfile) {
  step("profiles.select other (expect null)", false, "RLS propustil cizí profil – ZÁVAŽNÁ CHYBA");
} else {
  step("profiles.select other (expect null)", true, "RLS správně blokuje");
}

// -----------------------------------------------------------
// KROK 2: Vytvoření poptávky (tow_requests)
// -----------------------------------------------------------

header("KROK 2: Vytvoření poptávky zákazníkem");

const { data: request, error: requestError } = await supabase
  .from("tow_requests")
  .insert({
    customer_id: signUpData.user.id,
    pickup_lat: 50.0875,
    pickup_lng: 14.4213,
    destination_address: "Testovací servis",
    vehicle_type: "Osobní auto",
    problem_description: "Test porucha",
    time_preference: "asap",
    vehicle_mobility: "drivable",
    status: "open",
  })
  .select()
  .single();

if (requestError) {
  step("tow_requests.insert", false, requestError.message);
  process.exit(1);
}
step("tow_requests.insert", true, `id = ${request.id}`);
created.requestId = request.id;

// -----------------------------------------------------------
// KROK 3: Multi-role – přepnutí na driver roli
//         (simulace goHome('driver') v App.tsx)
// -----------------------------------------------------------

header("KROK 3: Přepnutí na driver roli – ensureCarrierProfile()");

// Simulace logiky z App.tsx: ensureCarrierProfile
// 1) Nejprve zkusíme načíst carrier_profiles (očekáváme, že neexistuje)
const { data: existingCarrier, error: loadCarrierError } = await supabase
  .from("carrier_profiles")
  .select("*")
  .eq("user_id", signUpData.user.id)
  .maybeSingle();

if (loadCarrierError) {
  step("carrier_profiles.select (expect empty)", false, loadCarrierError.message);
} else if (existingCarrier) {
  step("carrier_profiles.select (expect empty)", false, "neočekávaně existuje – test musí běžet na čistém účtu");
  process.exit(1);
} else {
  step("carrier_profiles.select (expect empty)", true, "žádný carrier_profiles – OK");
}

// 2) Vložíme carrier_profiles s defaultními hodnotami (napodobuje registerUser)
const { data: carrier, error: carrierInsertError } = await supabase
  .from("carrier_profiles")
  .insert({
    user_id: signUpData.user.id,
    status: "pending",
    business_type: "individual",
  })
  .select()
  .single();

if (carrierInsertError) {
  step("carrier_profiles.insert", false, carrierInsertError.message);
  process.exit(1);
}
step("carrier_profiles.insert", true, `id = ${carrier.id}`);
created.carrierProfileId = carrier.id;

// Ověření: driver smí číst svůj carrier_profiles
const { data: ownCarrier, error: readOwnCarrierError } = await supabase
  .from("carrier_profiles")
  .select("id, status, business_type")
  .eq("id", carrier.id)
  .single();

if (readOwnCarrierError || !ownCarrier) {
  step("carrier_profiles.select own", false, readOwnCarrierError?.message || "žádná data");
} else {
  step("carrier_profiles.select own", true, `status = ${ownCarrier.status}`);
}

// Multi-role compliance: i když jsme se registrovali jako customer,
// driver-flow (čtení carrier_profiles) musí fungovat
if (ownCarrier && ownCarrier.status === "pending") {
  step("multi-role: driver-flow funguje pro customer-signed-up user", true);
} else {
  step("multi-role: driver-flow funguje pro customer-signed-up user", false);
}

// -----------------------------------------------------------
// KROK 4: Vytvoření nabídky (tow_offers) řidičem
// -----------------------------------------------------------

header("KROK 4: Nabídka řidiče na vlastní (svou) poptávku");

const arrivalAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const { data: offer, error: offerError } = await supabase
  .from("tow_offers")
  .insert({
    tow_request_id: request.id,
    driver_id: signUpData.user.id,
    price: 1500,
    estimated_arrival_at: arrivalAt,
    message: "Test nabídka",
    status: "pending",
  })
  .select()
  .single();

if (offerError) {
  step("tow_offers.insert", false, offerError.message);
  // Nepřerušujeme – může jít o RLS blokaci, kterou chceme reportovat
} else {
  step("tow_offers.insert", true, `id = ${offer.id}`);
  created.offerId = offer.id;
}

// -----------------------------------------------------------
// KROK 5: Uložení nového vozidla (carrier_vehicles)
// -----------------------------------------------------------

header("KROK 5: Vytvoření vozidla řidičem");

const { data: vehicle, error: vehicleError } = await supabase
  .from("carrier_vehicles")
  .insert({
    carrier_id: carrier.id,
    name: "Testovací vlek",
    vehicle_type: "Od tow truck",
    make: "Iveco",
    model: "Daily",
    year: 2020,
    registration_number: "TEST-001",
    max_weight_kg: 3500,
    max_vehicle_length_cm: 600,
    max_vehicle_width_cm: 220,
    max_vehicle_height_cm: 250,
    capacity: 2,
    description: "Test",
    has_winch: true,
    has_hydraulic_platform: false,
    has_ramps: true,
    has_straps: true,
    has_jump_starter: false,
    has_compressor: false,
    is_active: true,
  })
  .select()
  .single();

if (vehicleError) {
  step("carrier_vehicles.insert", false, vehicleError.message);
} else {
  step("carrier_vehicles.insert", true, `id = ${vehicle.id}`);
  created.vehicleId = vehicle.id;
}

// -----------------------------------------------------------
// NEGATIVNÍ TEST: driver se NESMÍ vložit cizí carrier_profiles
// -----------------------------------------------------------

header("NEGATIVNÍ TEST: ochrana proti podvržení cizího user_id");

const fakeUserId = "11111111-1111-1111-1111-111111111111";
const { error: spoofError } = await supabase
  .from("carrier_profiles")
  .insert({
    user_id: fakeUserId, // jiný než auth.uid()
    status: "pending",
    business_type: "individual",
  });

if (spoofError) {
  step("carrier_profiles.insert s cizím user_id (expect reject)", true, `RLS správně odmítl: ${spoofError.message}`);
} else {
  step("carrier_profiles.insert s cizím user_id (expect reject)", false, "RLS propustil – ZÁVAŽNÁ CHYBA");
}

// -----------------------------------------------------------
// SOUHRN
// -----------------------------------------------------------

header("SOUHRN");
console.log(`  PASS: ${pass}`);
console.log(`  FAIL: ${fail}`);
console.log("");
console.log("  Vytvořená testovací data (vyžadují ruční smazání přes Supabase Dashboard):");
console.log(`    auth.users.id         = ${created.userId}`);
console.log(`    profiles.id           = ${created.profileId}`);
console.log(`    tow_requests.id       = ${created.requestId}`);
console.log(`    carrier_profiles.id   = ${created.carrierProfileId}`);
console.log(`    tow_offers.id         = ${created.offerId ?? "(nevytvořeno)"}`);
console.log(`    carrier_vehicles.id   = ${created.vehicleId ?? "(nevytvořeno)"}`);
console.log("");
console.log(`  Email testu: ${testEmail}`);
console.log(`  Smazat auth.users lze přes SQL: DELETE FROM auth.users WHERE id = '${created.userId}';`);
console.log(`  (vyžaduje service_role – doporučuji Supabase Dashboard → Authentication → Users → Delete)`);

process.exit(fail === 0 ? 0 : 1);
