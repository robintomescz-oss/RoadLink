/**
 * Balíček pro Supabase SQL Editor musí zůstat v souladu s migracemi.
 *
 * Balíček je generovaný (`scripts/build-sql-editor-bundle.mjs`), takže hlavní
 * riziko je rozdvoj: někdo upraví migraci a zapomene balíček přegenerovat.
 * Tento test to odhalí spuštěním generátoru v režimu `--check`.
 *
 * Druhé riziko je bezpečnostní: do balíčku se nesmí dostat krok
 * `20261005180000` (cleanup), protože je jednosměrný a patří až po ověřeném
 * produkčním chodu.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const bundleDir = path.join(root, "supabase/sql-editor");
const readBundle = (name) => fs.readFileSync(path.join(bundleDir, name), "utf8");


// ── Očekávané soubory, žádný jiný ──────────────────────────────────────────
const expected = [
  "00_preflight_readonly.sql",
  "step_1_120000_via_routes.sql",
  "step_2_130000_via_coordinates.sql",
  "step_3_140000_bbox_preselection.sql",
  "step_4_150000_enable_postgis.sql",
  "step_5_160000_route_line.sql",
  "step_6_170000_spatial_preselection.sql",
  "README.md",
];
assert.deepStrictEqual(fs.readdirSync(bundleDir).sort(), [...expected].sort(), "the bundle contains exactly the expected files");

// ── Každý step obsahuje zdrojovou migraci beze změny ───────────────────────
const steps = expected.filter((name) => name.startsWith("step_"));
assert.strictEqual(steps.length, 6, "the bundle covers six forward migrations");

for (const name of steps) {
  const content = readBundle(name);
  const sourceLine = content.split("\n").find((line) => line.startsWith("-- Zdroj:"));
  assert(sourceLine, `${name} names its source migration`);

  const source = sourceLine.split("/").pop();
  const migration = read(`supabase/migrations/${source}`).replace(/\r\n/g, "\n").trim();
  assert(migration.length > 0, `${source} is not empty`);
  assert(content.includes(migration), `${name} embeds ${source} verbatim, with no drift`);
}

// ── Jednosměrný cleanup NESMÍ být v balíčku ─────────────────────────────────
// Kontrolujeme jen SQL soubory: README cleanup záměrně jmenuje, aby vysvětlilo
// jeho nepřítomnost.
const sqlFiles = expected.filter((name) => name.endsWith(".sql"));
for (const name of sqlFiles) {
  const content = readBundle(name);
  assert(!content.includes("20261005180000"), `${name} does not carry the cleanup migration`);
  assert(!/drop column if exists bbox_min_lat/.test(content), `${name} does not drop the bbox columns`);
  assert(!content.includes("assign_carrier_route_geometry"), `${name} does not install the post-cleanup trigger`);
}

// ── Balíček je bezpečný pro SQL Editor ─────────────────────────────────────
const stepFiles = steps.map((name) => ({ name, content: readBundle(name) }));

for (const { name, content } of stepFiles) {
  // Každý krok je jedna transakce: při chybě se odroluje celý.
  assert(/^begin;/im.test(content), `${name} opens a transaction`);
  assert(/commit;\s*$/im.test(content), `${name} commits the transaction`);

  // Na konci je čitelná kontrola s očekávaným výsledkem.
  assert(/KONTROLA KROKU \d/.test(content), `${name} ends with verification queries`);
  assert(/očekáváno/i.test(content), `${name} states the expected result`);
}

// Kontrolní dotazy jsou read-only: nejsou součástí transakce zápisových kroků.
const preflight = readBundle("00_preflight_readonly.sql");
const preflightBody = preflight.replace(/--[^\n]*/g, "");
assert(
  !/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke)\b/i.test(preflightBody),
  "the preflight script only reads",
);
assert(/is_spatial/.test(preflight) && /has_via/.test(preflight) && /has_proximity/.test(preflight), "the preflight says which steps are already applied");
assert(/NEZACÍNAJTE ODKUD UŽ BYLO/.test(preflight), "the preflight warns not to restart from the beginning");

// Preflight běží PŘED jakoukoli migrací, takže se nesmí dotazovat na sloupce,
// které ještě nemusí existovat — dotaz by skončil „column does not exist“
// a kontrola by selhala právě tehdy, když je nejvíc potřeba.
// Sloupce se zjišťují přes information_schema, ne přímým čtením dat.
// Sloupce, ktere na ciste databazi jeste nemusi existovat.
const missingColumns = ["route_line", "via_latitudes", "via_longitudes", "bbox_min_lat", "bbox_max_lat", "bbox_min_lng", "bbox_max_lng"];

// Komentare oddelime radek po radku, bez regularniho vyrazu.
const codeLines = preflight.split("\n");
const sqlLines = codeLines.filter((line) => line.trim().indexOf("--") !== 0);

// Název sloupce v uvozovkách (v `in (...)`) je bezpečný — takhle se katalog
// ptá na existenci sloupce, ne čte jeho hodnoty. Vadá je přímý přístup
// k datům mimo information_schema.
const QUOTE = String.fromCharCode(39);

for (const column of missingColumns) {
  const asQuotedName = QUOTE + column + QUOTE;
  const offending = sqlLines.filter((line) => {
    if (!line.toLowerCase().includes(column)) return false;
    if (line.toLowerCase().includes("information_schema")) return false;
    if (line.includes(asQuotedName)) return false;
    return true;
  });
  assert.deepStrictEqual(offending, [], `the preflight never reads ${column} directly, so it works on a clean database`);
}
assert(/new_columns_present/.test(preflight), "the preflight reports how many new columns already exist");

// ── Zastávky jsou zřetelné ─────────────────────────────────────────────────
const step4 = readBundle("step_4_150000_enable_postgis.sql");
assert(/ZASTÁVKA/.test(step4), "the PostGIS step is marked as a stopping point");
assert(/ZASTAVTE celé nasazení/.test(step4), "it says to stop the rollout if PostGIS is unavailable");

const readme = readBundle("README.md");
assert(/NEUPRAVUJTE JE RUČNĚ/.test(readme), "the bundle is marked as generated");
assert(/spatial_cleanup/.test(readme) && /jednosměrný/.test(readme), "the README explains that the cleanup is excluded because it is one-way");
assert(/výsledek tam je popsaný|po každém kroku|po řadě/i.test(readme), "the README requires checking the output after each step");

// ── Oprávnění jsou kontrolována po každém kroku, kde RPC přepisujeme ──────
for (const { name, content } of stepFiles) {
  if (name.startsWith("step_1") || name.startsWith("step_2") || name.startsWith("step_3") || name.startsWith("step_6")) {
    assert(/routine_privileges/.test(content), `${name} verifies execute privileges after redefining the RPC`);
    assert(/service_role/.test(content), `${name} names service_role as the only allowed grantee`);
  }
}

// ── Balíček nesmí být součástí běžného nasazování ───────────────────────────
assert(!read("scripts/run-regressions.mjs").includes("build-sql-editor-bundle"), "the generator is not part of the regression runner");
assert(read("scripts/run-regressions.mjs").includes("sql-editor-bundle-regression"), "the bundle regression is registered");

// ── Balíček je synchronizovaný s migracemi ─────────────────────────────────
// Až na konci: bezpečnostní kontroly výše musí běžet vždy. Kdyby tato kontrola
// selhala dřív, překryla by chybu, kterou má odhalit.
try {
  const check = execFileSync(process.execPath, ["scripts/build-sql-editor-bundle.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert(/synchronizovaný/i.test(check), "the SQL Editor bundle matches the migrations (run the generator)");
} catch (error) {
  const detail = error.stdout || error.message || String(error);
  console.error("Balíček není synchronizovaný s migracemi. Spusťte node scripts/build-sql-editor-bundle.mjs");
  assert.fail(detail);
}

// ── Oprávnění: vlastník ≠ nebezpečná role ───────────────────────────────────
// `postgres` je vlastníkem funkce, takže EXECUTE má vždy a jeho přítomnost je
// správná. Nepřítomnost `anon` a `authenticated` je to, co chrání soukromí.
// Zadání nesmí zaměnit tyto dvě věci — jinak by operátor na správném výstupu
// viděl "něco je špatně" a zastavil, nebo naopak přehlédl skutečný problém.
for (const { name, content } of stepFiles) {
  if (!/routine_privileges/.test(content)) continue;
  assert(/'postgres'|vlastník/i.test(content), `${name} explains that postgres is the function owner`);
  assert(/NEJSOU|NE/.test(content) || /anon/.test(content), `${name} names the roles that must be absent`);
  assert(!/očekáváno je JEDEN řádek se service_role/i.test(content), `${name} does not claim only one row is expected`);
}

assert(/'postgres' \+ 'service_role' = v pořádku|'postgres' \+ 'service_role'/.test(preflight), "the preflight says postgres plus service_role is correct");
assert(/anon nebo authenticated/.test(preflight), "the preflight says anon or authenticated means stop");

console.log("ALL SQL EDITOR BUNDLE REGRESSION CHECKS PASSED");