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
  "step_4_145000_bbox_without_via.sql",
  "step_5_150000_enable_postgis.sql",
  "step_6_160000_route_line.sql",
  "step_7_170000_spatial_preselection.sql",
  "README.md",
];
assert.deepStrictEqual(fs.readdirSync(bundleDir).sort(), [...expected].sort(), "the bundle contains exactly the expected files");

// ── Každý step obsahuje zdrojovou migraci beze změny ───────────────────────
const steps = expected.filter((name) => name.startsWith("step_"));
assert.strictEqual(steps.length, 7, "the bundle covers seven forward migrations");

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
  assert(/VÝSLEDek KROKU/.test(content), `${name} ends with a visible result table`);
  assert(/zavre_kontrola/.test(content), `${name} states pass or fail explicitly`);
}

// Kontrolní dotazy jsou read-only: nejsou součástí transakce zápisových kroků.
const preflight = readBundle("00_preflight_readonly.sql");
const preflightBody = preflight.replace(/--[^\n]*/g, "");
assert(
  !/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke)\b/i.test(preflightBody),
  "the preflight script only reads",
);
assert(/is_spatial/.test(preflight) && /has_via/.test(preflight) && /has_proximity/.test(preflight), "the preflight says which steps are already applied");
assert(/has_bbox/.test(preflight), "the preflight explains that bbox in the RPC is the transitional layer, not an error");
assert(/NEZACÍNAJTE OD KROKU 1|NEZACÍNAJTE ODKUD UŽ BYLO/.test(preflight), "the preflight warns not to restart from the beginning");

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
    // Název sloupce UVNITŘ ŘETĚZCE uvnitř pg_get_functiondef() je jen text
    // porovnávaný v katalogu, ne čtení dat. Je bezpečný a funguje i na čisté
    // databázi, kde sloupec ještě neexistuje.
    if (line.includes("pg_get_functiondef")) return false;
    return true;
  });
  assert.deepStrictEqual(offending, [], `the preflight never reads ${column} directly, so it works on a clean database`);
}
assert(/new_columns|sloupce_stav/.test(preflight), "the preflight reports how many new columns already exist");

// ── Zastávky jsou zřetelné ─────────────────────────────────────────────────
const step5 = readBundle("step_5_150000_enable_postgis.sql");
assert(/ZASTÁVKA/.test(step5), "the PostGIS step is marked as a stopping point");
assert(/ZASTAVTE celé nasazení/.test(step5), "it says to stop the rollout if PostGIS is unavailable");

// ── Pořadí kroků odpovídá pořadí souborů migrací ──────────────────────────
const orderInNames = steps.map((name) => Number(name.match(/step_(\d+)_(\d+)/)[2]));
assert.deepStrictEqual(
  orderInNames,
  [...orderInNames].sort((a, b) => a - b),
  "steps are numbered in the same order as their migration timestamps",
);
assert.deepStrictEqual(
  steps.map((name) => Number(name.match(/step_(\d+)_/)[1])),
  steps.map((_, index) => index + 1),
  "steps are numbered consecutively from 1",
);

// ── Kontrola smí volat jen to, co v tomto okamžiku existuje ────────────────
// Kroky se spouštějí postupně. Kontrola v kroku, který helper ještě nevytvořil,
// by skončila chybou „function does not exist“ — a to by operátor četl jako
// rozbitou databázi, přestože je všechno v pořádku.
const helperStep = steps.findIndex((name) => name.startsWith("step_4_145000"));
assert(helperStep > -1, "the bundle contains the step that creates the shared helper");
for (let index = 0; index < helperStep; index += 1) {
  const content = readBundle(steps[index]);
  assert(
    !content.includes("carrier_route_via_coordinates_valid("),
    `${steps[index]} does not call a helper that a later step still has to create`,
  );
}
// Kroky, které ODTVÁREJÍ geometrii, musí používat sdílený helper — jinak by
// každý znal úplnost souřadnic trochu jinak. PostGIS jen zapíná extension
// a geometrii neodvozuje, proto se kontrola netýká.
const geometrySteps = ["step_4_145000_bbox_without_via.sql", "step_6_160000_route_line.sql"];
for (const name of geometrySteps) {
  assert(
    readBundle(name).includes("carrier_route_via_coordinates_valid("),
    `${name} decides geometry completeness through the shared helper`,
  );
}

// ── Průjezdné body nejsou povinné — to je celý důvod nového kroku ─────────
// Dřívější trigger považoval `via_latitudes IS NULL` za chybějící údaj, a tím
// odebral geometrii VŠEM trasám bez průjezdných bodů, tedy většině tras.
for (const name of ["step_4_145000_bbox_without_via.sql", "step_6_160000_route_line.sql"]) {
  const content = readBundle(name);
  // Podmínka musí být NA TRIGGERU. Uvnitř helperu je `p_via_latitudes is not
  // null` správně — chrání větev, kde průjezdné body EXISTUJÍ, a prázdný
  // seznam opomíjí. Vadné by bylo `new.via_latitudes is null` jako podmínka
  // pro celou trasu.
  const trigger = content.match(/function public\.assign_carrier_route_(?:bbox|line)\(\)[\s\S]*?\$\$;/);
  assert(trigger, `${name} defines its geometry trigger`);
  assert(
    !/new\.via_(latitudes|longitudes) is null/i.test(trigger[0]),
    `${name} no longer treats missing via coordinates as missing geometry`,
  );
  assert(
    /carrier_route_via_coordinates_valid\(/i.test(trigger[0]),
    `${name} decides completeness through the shared helper`,
  );
}
const step4 = readBundle("step_4_145000_bbox_without_via.sql");
assert(/coalesce\(new\.via_latitudes/i.test(step4), "the bbox trigger builds points with coalesce so an empty via list still yields a box");
assert(/bez_bbox_tras_s_ukoncene/i.test(step4), "the fix step checks the count over ALL routes, not only routes with via points");

// Krok 3 je přechodná vrstva a bbox ZÁMĚRNĚ používá. Kontrola „RPC nepoužívá
// bbox“ patří až kroku 7; v kroku 3 by byla chybná a zablokovala řetězec.
const step3 = readBundle("step_3_140000_bbox_preselection.sql");
assert(!/not like '%bbox/i.test(step3), "step 3 does not assert that the RPC avoids bbox — step 3 introduces it");
assert(/rpc_uziva_bbox_pred/i.test(step3), "step 3 asserts the RPC does use the bounding box");

const readme = readBundle("README.md");
assert(/NEUPRAVUJTE JE RUČNĚ/.test(readme), "the bundle is marked as generated");
assert(/spatial_cleanup/.test(readme) && /jednosměrný/.test(readme), "the README explains that the cleanup is excluded because it is one-way");
assert(/zavre_kontrola/.test(readme) && /pokaždé čekejte na výsledek/i.test(readme), "the README requires checking the result row after each step");

// ── Oprávnění jsou kontrolována po každém kroku, kde RPC přepisujeme ──────
for (const { name, content } of stepFiles) {
  if (name.startsWith("step_1") || name.startsWith("step_2") || name.startsWith("step_3") || name.startsWith("step_7")) {
    assert(/routine_privileges/.test(content), `${name} verifies execute privileges after redefining the RPC`);
    assert(/service_role/.test(content), `${name} names service_role as the only allowed grantee`);
  }
}

// ── Balíček nesmí být součástí běžného nasazování ───────────────────────────
assert(!read("scripts/run-regressions.mjs").includes("build-sql-editor-bundle"), "the generator is not part of the regression runner");
assert(read("scripts/run-regressions.mjs").includes("sql-editor-bundle-regression"), "the bundle regression is registered");

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

assert(/vlastník funkce/.test(preflight), "the preflight explains that postgres owns the function");
assert(/anon.*authenticated|authenticated.*anon/.test(preflight), "the preflight names the roles that must not have access");
assert(/soukromi/.test(preflight), "the preflight has an explicit privacy column");

// ── Výsledek musí být VIDITELNÝ, ne v NOTICE ───────────────────────────────
// Supabase SQL Editor nezobrazuje RAISE NOTICE. Kontrola založená jen na NOTICE
// je pro operátora neviditelná: chybu by viděl, úspěch ne. Každý step proto
// musí končit SELECTem, jehož sloupec říká ANO/NE.
for (const { name, content } of stepFiles) {
  const marker = "VÝSLEDek KROKU";
  const index = content.lastIndexOf(marker);
  assert(index > -1, `${name} has a result section`);

  const tail = content.slice(index);
  const sqlTail = tail.split("\n").filter((line) => line.trim().indexOf("--") !== 0).join("\n");

  assert(/zavre_kontrola/.test(tail), `${name} ends with a zavre_kontrola column`);
  assert(/'ANO/.test(tail), `${name} says ANO when the checks pass`);
  assert(/NEPOUŠTĚJTE|NEPSOTUJTE|nepouštějte/i.test(tail), `${name} says what to do when a check fails`);

  // Závorky v shrnujícím dotazu musí být vyvážené: jinak by celý krok selhal
  // na syntaktické chybě ještě před tím, než by cokoliv zkontroloval.
  let depth = 0;
  let insideString = false;
  let sawCloseTooEarly = false;
  for (let i = 0; i < sqlTail.length; i += 1) {
    const ch = sqlTail[i];
    if (insideString) {
      if (ch === String.fromCharCode(39)) {
        if (sqlTail[i + 1] === String.fromCharCode(39)) i += 1;
        else insideString = false;
      }
    } else if (ch === String.fromCharCode(39)) insideString = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) sawCloseTooEarly = true;
    }
  }
  assert.strictEqual(depth, 0, `${name} has balanced parentheses in its result query`);
  assert(!sawCloseTooEarly, `${name} has no unmatched closing parenthesis`);
  assert(!insideString, `${name} has no unterminated string literal`);

  // Výsledný dotaz musí být poslední příkaz souboru, jinak by SQL Editor
  // zobrazil něco jiného a operátor by četl nesprávnou tabulku.
  const statements = content.split(";").map((part) => part.trim()).filter(Boolean);
  const lastStatement = statements[statements.length - 1];
  assert(/zavre_kontrola/.test(lastStatement), `${name} ends with the result query`);
}

assert(/zavre_kontrola/.test(preflight), "the preflight also ends with a visible result row");

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

console.log("ALL SQL EDITOR BUNDLE REGRESSION CHECKS PASSED");