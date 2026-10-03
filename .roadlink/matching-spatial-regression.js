const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const extensionMigration = read("supabase/migrations/20261005150000_enable_postgis.sql");
const geometryMigration = read("supabase/migrations/20261005160000_carrier_route_spatial_line.sql");
const rpcMigration = read("supabase/migrations/20261005170000_matching_spatial_preselection.sql");
const bboxMigration = read("supabase/migrations/20261005140000_matching_sql_geo_preselection.sql");
const bboxFixMigration = read("supabase/migrations/20261005145000_matching_bbox_without_via.sql");
const cleanupMigration = read("supabase/migrations/20261005180000_matching_spatial_cleanup.sql");
const cleanupBody = cleanupMigration.replace(/--[^\n]*/g, "");

// Kontroly nad SQL běží na kódu BEZ KOMENTÁŘŮ. Migrace tu chybu výslovně
// popisuje v komentáři (doslova uvádí chybný výraz jako příklad toho, co se
// opravuje), takže hledání v surovém textu by našlo právě vysvětlení.
const code = (sql) => sql.replace(/--[^\n]*/g, "");
const extensionCode = code(extensionMigration);

// ── Krok 1: extension ───────────────────────────────────────────────────────
assert(/create extension if not exists postgis schema extensions/i.test(extensionMigration), "PostGIS is enabled idempotently into the extensions schema");
assert(/from pg_extension where extname = 'postgis'/i.test(extensionMigration), "the migration verifies PostGIS is actually installed");
assert(
  !/to_regtype\('extensions\.geography linestring'\)/i.test(extensionCode),
  "the migration does not parse a space-separated typmod through regtype input, which is a syntax error rather than a type check",
);
assert(/pg_type t/i.test(extensionCode) && /typname = 'geography'/i.test(extensionCode), "the migration verifies the geography type through the catalog");
assert(/st_dwithin/i.test(extensionCode), "the migration verifies the spatial functions the later steps actually call");

// Přetížení funkcí nesmí být záměněna za počet existujících funkcí.
// ST_MakePoint má v PostGIS pět variant (2D, 3D, 4D, s měřítkem) a
// ST_DWithin/ST_Distance existují pro geometry i geography. Kontrola, která
// porovnává `count(*) = 4`, by nikdy neplatila a operátora by zbytečně
// zastavila na funkční instalaci.
const bundle = read("supabase/sql-editor/step_5_150000_enable_postgis.sql");
assert(
  !/count\(\*\)\s*=\s*4/i.test(bundle),
  "the spatial function check counts distinct names, not overloads — otherwise it can never pass",
);
assert(/count\(distinct p\.proname\)/i.test(bundle), "the spatial function check compares distinct function names");
const runbookSpatial = code(read("docs/matching-deployment-runbook.md"));
assert(!/count\(\*\)\s*=\s*4/i.test(runbookSpatial), "the runbook does not compare overload counts either");
assert(/raise exception/i.test(extensionMigration), "a missing extension fails loudly instead of degrading silently");
assert(!/\b(delete|truncate|drop)\b/i.test(extensionMigration.replace(/--[^\n]*/g, "")), "enabling the extension mutates no data");

// ── Krok 2: prostorová geometrie trasy ─────────────────────────────────────
assert(/add column if not exists route_line extensions\.geography\(linestring, 4326\)/i.test(geometryMigration), "the route line is a real 4326 geography LineString");
assert(/create or replace function public\.assign_carrier_route_line\(\)/i.test(geometryMigration), "the geometry is derived by a trigger, never entered by hand");
assert(/create trigger carrier_routes_route_line_assign[\s\S]*before insert or update/i.test(geometryMigration), "the trigger covers inserts and updates");
assert(/using gist \(route_line\)/i.test(geometryMigration), "the route line has a GiST index");
assert(/extensions\.ST_MakePoint\(new\.from_lng, new\.from_lat\)/i.test(geometryMigration), "origin is written as longitude, latitude");
assert(/extensions\.ST_MakeLine\(v_points\)/i.test(geometryMigration), "the whole route becomes one line, via points included");
assert(/set search_path = ''/i.test(geometryMigration), "PostGIS functions are called with an empty search_path");
assert(/revoke all[\s\S]*from anon[\s\S]*from authenticated/i.test(geometryMigration), "the geometry trigger is closed for clients");
assert(!/\b(drop column|delete from|truncate|drop table)\b/i.test(geometryMigration), "the geometry migration destroys nothing");
assert(!/route_line\s*:=/i.test(geometryMigration.replace(/new\.route_line :=/g, "")), "only the trigger writes the geometry");

// ── PRŮJEZDNÉ BODY NEJSOU POVINNÉ ────────────────────────────────────────────
// Toto je nejsubtlnější chyba celého řetězce: triggery braly `via_latitudes IS
// NULL` jako „chybí souřadnice“, a tím považovaly trasu BEZ průjezdných bodů za
// trasu bez geometrie. Vpraxe to odebralo obdélník i geometrii většině tras, takže
// prostorový předvýběr neměl nad čím pracovat. Prázdný seznam je platný stav.
assert(/create or replace function public\.carrier_route_via_coordinates_valid/i.test(bboxFixMigration), "completeness of via points is decided in one shared place");
assert(/returns boolean/i.test(bboxFixMigration), "the helper answers a yes/no question");
assert(/coalesce\(cardinality\(p_via_place_ids\), 0\) = 0/i.test(bboxFixMigration), "an empty via list is a valid state, not missing data");
assert(/coalesce\(cardinality\(p_via_latitudes\), 0\) = 0/i.test(bboxFixMigration), "orphaned via coordinates without via points are rejected");
assert(/value <> value/i.test(bboxFixMigration), "NaN via coordinates are rejected (NaN <> NaN is true in Postgres)");
assert(/revoke all[\s\S]*carrier_route_via_coordinates_valid[\s\S]*from anon[\s\S]*from authenticated/i.test(bboxFixMigration), "the helper is closed for clients");
// `.trim()` nestačí: soubor začíná komentářem, takže `^` na trimovaném textu
// ukazuje na `--`, ne na `begin`. Proto řádkový příznak `m`.
assert(/^\s*begin;/im.test(bboxFixMigration) && /^\s*commit;\s*$/im.test(bboxFixMigration), "the fix is one explicit transaction");
assert(!/\b(delete from|drop column|drop table|truncate)\b/i.test(bboxFixMigration), "the fix destroys nothing");
assert(/set from_lat = from_lat/i.test(bboxFixMigration), "existing rows are backfilled by a no-op UPDATE, so no stored value changes");
assert(!/alter table/i.test(bboxFixMigration), "the fix adds no column — the bbox columns already exist");

const bboxFixBody = bboxFixMigration.replace(/--[^\n]*/g, "");
const bboxTrigger = bboxFixBody.match(/function public\.assign_carrier_route_bbox\(\)[\s\S]*?\$\$;/);
assert(bboxTrigger, "the fix redefines the bounding-box trigger");
assert(!/new\.via_(latitudes|longitudes) is null/i.test(bboxTrigger[0]), "the bbox trigger no longer refuses a route that has no via points");
assert(/coalesce\(new\.via_latitudes, '\{\}'::double precision\[\]\)/i.test(bboxTrigger[0]), "the bbox trigger concatenates with coalesce so an empty via list still yields a box");
// Žádný klient nesmí obdélník podstrčit a trigger nesmí přijmout cizí hodnotu:
// každý sloupec se buď vynuluje, nebo se dopočítá z `min`/`max` souřadnic.
for (const column of ["bbox_min_lat", "bbox_max_lat", "bbox_min_lng", "bbox_max_lng"]) {
  const assignments = bboxTrigger[0].match(new RegExp(`new\\.${column} := [^;]+`, "gi")) || [];
  assert.strictEqual(assignments.length, 2, `${column} is assigned exactly twice: once cleared, once computed`);
  assert(
    assignments.every((line) => /:=\s*null/i.test(line) || /:=\s*\(select (min|max)\(/i.test(line)),
    `${column} is only ever cleared or computed from the coordinates`,
  );
}

// Všechny tři odvozující triggery musí rozhodovat o úplnosti stejně. Kdyby se
// jejich podmínky rozdělily, kontroly by počítaly jinou množinu tras, ne jakou
// geometrie skutečně vzniká.
// Kontrola běží na kódu BEZ KOMENTÁŘŮ. Migrace tu chybu výslovně popisuje
// v komentáři (doslova uvádí `new.via_latitudes is null` jako příklad toho,
// co se opravuje), takže hledání v surovém textu by našlo právě vysvětlení.
for (const [label, migration] of [["bbox", bboxFixMigration], ["line", geometryMigration], ["cleanup", cleanupMigration]]) {
  const code = migration.replace(/--[^\n]*/g, "");
  assert(
    /carrier_route_via_coordinates_valid\(/i.test(code),
    `the ${label} step derives geometry through the shared helper`,
  );
  assert(
    !/assign_carrier_route_(?:bbox|line|geometry)\(\)[\s\S]{0,1500}?new\.via_latitudes is null/i.test(code),
    `the ${label} trigger does not treat missing via coordinates as missing geometry`,
  );
}

// Pořadí: helper musí existovat dřív, než ho použije krok 6.
assert(
  geometryMigration.indexOf("carrier_route_via_coordinates_valid") > -1
    && bboxFixMigration.indexOf("create or replace function public.carrier_route_via_coordinates_valid") > -1,
  "the helper is created by the step that sorts before the step that uses it",
);

// ── Krok 3: prostorový předvýběr v RPC ──────────────────────────────────────
assert(/create or replace function public\.get_route_matching_candidates_internal/i.test(rpcMigration), "the RPC is replaced without dropping (no privilege window)");
assert(!/drop function/i.test(rpcMigration), "no DROP of the internal RPC");
assert(/ST_DWithin\(\s*cr\.route_line/i.test(rpcMigration), "candidates are filtered by a spatial DWithin against the route");
assert(/ST_DWithin\([\s\S]*ST_DWithin\(/i.test(rpcMigration), "both pickup and dropoff are checked against the route");
assert(/\(greatest\(coalesce\(cr\.max_deviation_km, 20\), 0\) \+ 10\) \* 1000/i.test(rpcMigration), "the radius is the allowed deviation plus a 10 km buffer");
assert(/order by[\s\S]*ST_Distance|c_pickup_distance_m \+ c\.c_dropoff_distance_m/i.test(rpcMigration), "candidates are ordered by real distance to the route");
assert(/cr\.route_line is null\s*\n\s*or tr\.pickup_lat is null/i.test(rpcMigration), "candidates without geometry or coordinates are never filtered out");
assert(/case when c\.c_pickup_distance_m is null or c\.c_dropoff_distance_m is null then 1 else 0 end/i.test(rpcMigration), "candidates without a computed distance sort last");
assert(/c_route_id,[\s\S]*route_proximity_meters/i.test(rpcMigration), "the return type is unchanged, including route_proximity_meters");
assert(/security definer/i.test(rpcMigration) && /set search_path = ''/i.test(rpcMigration), "the RPC keeps its hardening");
assert(/grant execute[\s\S]*to service_role/i.test(rpcMigration) && !/grant execute[\s\S]*to (anon|authenticated)/i.test(rpcMigration), "execute stays service_role only");
assert(!/\b(drop column|delete from|truncate|drop table)\b/i.test(rpcMigration), "the RPC migration destroys nothing");

// ── Bezpečnost přechodu ────────────────────────────────────────────────────
assert(/bbox_min_lat/i.test(bboxMigration), "the previous bbox step stays in history for rollback");
const allSpatial = extensionMigration + geometryMigration + rpcMigration;
assert(!/drop column/i.test(allSpatial), "no spatial column is dropped, so the previous step can still be used");
const rpcBody = rpcMigration.replace(/--[^\n]*/g, "");
assert(/route_line/i.test(geometryMigration) && !/bbox/i.test(rpcBody), "the new RPC no longer depends on the bbox columns");

// ── Krok 4: úklid po ověření produkčního chodu ──────────────────────────────
//
// Kontrola pořadí: nejdřív celý blok předpokladů, teprve potom jakýkoliv DROP.
const preconditionEnd = cleanupBody.indexOf("end;\n$$;");
const firstDrop = cleanupBody.search(/\bdrop\s/i);
assert(preconditionEnd > -1, "the cleanup migration opens with a precondition block");
assert(firstDrop > preconditionEnd, "no object is dropped before the preconditions are verified");

assert(/to_regprocedure\('public\.get_route_matching_candidates_internal\(uuid,uuid,integer\)'\)/i.test(cleanupBody), "the precondition verifies the internal candidate RPC exists");
assert(/pg_get_functiondef[\s\S]*like '%bbox_%'[\s\S]*raise exception/i.test(cleanupBody), "it refuses to clean up while the RPC still reads bbox_* columns");
assert(/pg_get_functiondef[\s\S]*like '%roadlink_haversine_meters%'[\s\S]*raise exception/i.test(cleanupBody), "it refuses to clean up while the RPC still uses the haversine helper");
assert(/cr\.route_line is null/i.test(cleanupBody) && /v_missing_geometry > 0/i.test(cleanupBody), "it refuses to drop the bounding box while some complete routes lack geometry");
assert(
  /public\.carrier_route_via_coordinates_valid\(\s*cr\.via_place_ids/i.test(cleanupBody),
  "the cleanup checks exactly the routes the geometry trigger can derive — same predicate, same set",
);
assert(/amname = 'gist'/i.test(cleanupBody) && /indisvalid/i.test(cleanupBody) && /indisready/i.test(cleanupBody), "it requires a valid, ready GiST index on carrier_routes");
assert(/do \$\$[\s\S]*\$\$;/i.test(cleanupBody), "the preconditions are a single fail-loud block that aborts the whole transaction");

assert(/drop trigger if exists carrier_routes_bbox_assign on public\.carrier_routes/i.test(cleanupBody), "the bbox trigger is dropped");
assert(/drop function if exists public\.assign_carrier_route_bbox\(\)/i.test(cleanupBody), "the bbox trigger function is dropped");
assert(/drop index if exists public\.carrier_routes_bbox_lat_idx/i.test(cleanupBody) && /drop index if exists public\.carrier_routes_bbox_lng_idx/i.test(cleanupBody), "both bbox indexes are dropped");
for (const column of ["bbox_min_lat", "bbox_max_lat", "bbox_min_lng", "bbox_max_lng"]) {
  assert(new RegExp(`drop column if exists ${column}`, "i").test(cleanupBody), `the obsolete column ${column} is dropped`);
}
assert(/drop function if exists public\.roadlink_haversine_meters\(double precision, double precision, double precision, double precision\)/i.test(cleanupBody), "the haversine helper is dropped with its exact signature");

assert(/create or replace function public\.assign_carrier_route_geometry\(\)/i.test(cleanupBody), "geometry derivation gets a single clearly named source of truth");
assert(/set search_path = ''/i.test(cleanupBody), "the geometry trigger keeps an empty search_path");
assert(/extensions\.ST_MakeLine\(v_points\)/i.test(cleanupBody), "the single source of truth still builds the whole route line");
assert(/drop trigger if exists carrier_routes_route_line_assign/i.test(cleanupBody), "the previous geometry trigger is dropped");
assert(/create trigger carrier_routes_route_geometry_assign[\s\S]*before insert or update on public\.carrier_routes[\s\S]*execute function public\.assign_carrier_route_geometry\(\)/i.test(cleanupBody), "the new trigger owns inserts and updates");
assert(cleanupBody.indexOf("create trigger carrier_routes_route_geometry_assign") < cleanupBody.search(/drop function if exists public\.assign_carrier_route_line\(\)/i), "the new trigger exists before the old function is dropped");
assert(/drop function if exists public\.assign_carrier_route_line\(\)/i.test(cleanupBody), "the old geometry function is dropped");
assert(/revoke all on function public\.assign_carrier_route_geometry\(\) from (public|anon|authenticated)/i.test(cleanupBody), "the geometry trigger stays closed for clients");
assert(!/grant\s/i.test(cleanupBody), "the cleanup migration grants nothing to anybody");

// Bezpečnost: nesahá na data, na vstupní validaci ani na veřejný feed.
assert(!/delete from/i.test(cleanupBody), "the cleanup deletes no rows");
assert(!/update\s+public\.carrier_routes/i.test(cleanupBody), "the cleanup updates no routes");
assert(!/\b(drop table|truncate|drop column if exists route_line|drop column if exists via_)/i.test(cleanupBody), "the cleanup destroys no table, no geometry column and no coordinate column");
assert(!/carrier_routes_via_places_validate/i.test(cleanupBody), "input validation stays in its own trigger, untouched");
assert(!/get_route_matching_candidates_internal\(uuid,uuid,integer\)\(\)/i.test(cleanupBody), "the cleanup does not redefine the candidate RPC");
assert(!/get_public_marketplace_routes/i.test(cleanupBody), "the cleanup does not touch the public feed");
assert(!/\b(insert|update|delete)\b[^\n]*\brevoke\b/i.test(cleanupBody), "privilege changes are not mixed with data changes");

// Idempotence: každý DROP je podmíněný, celý skript je jedna transakce.
const dropStatements = cleanupBody.match(/\bdrop\s+(trigger|function|index)\b(?![^;]*\bif exists\b)[^;]*;/gi) || [];
assert.deepStrictEqual(dropStatements, [], "every drop is guarded by if exists");
assert((cleanupBody.match(/alter table public\.carrier_routes\s+drop column if exists/g) || []).length === 1, "all four bbox columns go away in one idempotent alter table");
assert(/^begin;/i.test(cleanupBody.trim()) && /commit;\s*$/i.test(cleanupBody.trim()), "the cleanup is a single explicit transaction");
assert(/návratová cesta|rollback/i.test(cleanupMigration), "the one-way nature and the rollback path are documented");

// Pořadí souborů musí odpovídat pořadí nasazení.
const names = [
  "20261005145000_matching_bbox_without_via.sql",
  "20261005150000_enable_postgis.sql",
  "20261005160000_carrier_route_spatial_line.sql",
  "20261005170000_matching_spatial_preselection.sql",
  "20261005180000_matching_spatial_cleanup.sql",
];
const sorted = [...names].sort();
assert.deepStrictEqual(names, sorted, "migration file names sort into the intended rollout order");
for (const name of names) {
  assert(fs.existsSync(path.join(root, "supabase/migrations", name)), `${name} exists`);
}

// Souřadnice ani geometrie nesmějí do veřejného trhu.
const publicFeed = read("supabase/migrations/20261003090000_remove_via_places_from_public_feed.sql");
assert(!/route_line|bbox_|via_latitudes|via_longitudes/i.test(publicFeed), "the public feed exposes no geometry or coordinates");

// ── Read-only smoke test po aplikaci prostorových kroků ────────────────────
const smoke = read("supabase/smoke/matching_spatial_smoke.sql");
const smokeBody = smoke.replace(/--[^\n]*/g, "");
assert(!/\b(insert into|update |delete from|truncate|create table|drop)\b/i.test(smokeBody), "the smoke test is read-only");
assert(!/to_regtype\('extensions\.geography linestring'\)/i.test(code(smoke)), "the smoke test avoids the invalid space-separated typmod regtype input");
assert(/st_dwithin/i.test(smoke) && /pg_type/i.test(smoke), "the smoke test verifies the spatial type and functions through the catalog");
assert(/pg_extension where extname = 'postgis'/i.test(smoke), "the smoke test verifies the extension is installed");
assert(/amname = 'gist'/i.test(smoke) && /indisvalid/i.test(smoke), "the smoke test verifies a usable GiST index");
assert(/pg_get_functiondef/i.test(smoke) && /like '%bbox_%'/i.test(smoke), "the smoke test still fails when the RPC depends on bbox columns (historical check, valid before the cleanup)");
assert(/explain \(analyze, buffers\)/i.test(smoke), "the smoke test prints the query plan");
assert(/carrier_routes_route_line_gist_idx/i.test(smoke), "the smoke test points at the GiST index inside the plan");
assert(!/Index Cond[^\n]*carrier_routes_route_line_gist_idx/i.test(smoke), "the smoke test does not claim the GiST index appears in the RPC plan");
assert(/cr\.id = p_route_id/i.test(smoke), "the smoke test explains that the RPC plans on one route");
assert(/Index Scan/i.test(smoke), "the smoke test names the primary key scan as the expected plan");
assert(/get_route_matching_candidates_internal/i.test(smoke), "the smoke test exercises the real RPC");
assert(/route_line je null/i.test(smoke), "the smoke test asserts that routes with coordinates have a geometry");
assert(/pořadí podle vzdálenosti od trasy je porušeno/i.test(smoke), "the smoke test asserts the ordering contract");
assert(/limit je/i.test(smoke), "the smoke test asserts the limit contract");

// ── Živý harness: statické bezpečnostní brány + čistá logika ───────────────
const harness = read(".roadlink/matching-spatial-integration.mjs");
assert(/--confirm-live-spatial-smoke/.test(harness), "the live harness requires an explicit confirmation flag");
assert(!read("scripts/run-regressions.mjs").includes("matching-spatial-integration"), "the live harness is never wired into the regression runner");
assert(read(".gitignore").includes("!.roadlink/matching-spatial-integration.mjs"), "the live harness is explicitly allowlisted for tracking");
assert(!/GOOGLE_MAPS_SERVER_API_KEY/i.test(harness), "the live harness never touches a Google API key");
assert(harness.includes("get_route_matching_candidates_internal"), "the live harness only calls the internal candidate RPC");

const { execFileSync } = require("node:child_process");
function readHarnessFixtures() {
  const script = [
    "import { checkCandidateRows, MAX_MATCH_CANDIDATES } from './.roadlink/matching-spatial-integration.mjs';",
    "const route = '11111111-1111-4111-8111-111111111111';",
    "const ok = [{ route_id: route, route_proximity_meters: 100 }, { route_id: route, route_proximity_meters: 900 }];",
    "const unordered = [{ route_id: route, route_proximity_meters: 900 }, { route_id: route, route_proximity_meters: 100 }];",
    "const nullFirst = [{ route_id: route, route_proximity_meters: null }, { route_id: route, route_proximity_meters: 100 }];",
    "const tooMany = Array.from({ length: MAX_MATCH_CANDIDATES + 1 }, () => ({ route_id: route, route_proximity_meters: 1 }));",
    "const foreign = [{ route_id: 'other', route_proximity_meters: 1 }];",
    "console.log(JSON.stringify({",
    "  limit: MAX_MATCH_CANDIDATES,",
    "  ok: checkCandidateRows(ok, MAX_MATCH_CANDIDATES, route),",
    "  unordered: checkCandidateRows(unordered, MAX_MATCH_CANDIDATES, route),",
    "  nullFirst: checkCandidateRows(nullFirst, MAX_MATCH_CANDIDATES, route),",
    "  tooMany: checkCandidateRows(tooMany, MAX_MATCH_CANDIDATES, route),",
    "  foreign: checkCandidateRows(foreign, MAX_MATCH_CANDIDATES, route),",
    "  notArray: checkCandidateRows('nope'),",
    "}));",
  ].join("\n");
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8" }));
}

const fixtures = readHarnessFixtures();
assert.strictEqual(fixtures.limit, 5, "the harness checks against the same candidate limit as the Edge Function");
assert.deepStrictEqual(fixtures.ok, [], "correctly ordered rows pass");
assert(fixtures.unordered.length > 0, "a descending distance is rejected");
assert(fixtures.nullFirst.length > 0, "a candidate without distance must not precede one with distance");
assert(fixtures.tooMany.some((failure) => /limit/.test(failure)), "more rows than the limit are rejected");
assert(fixtures.foreign.length > 0, "a candidate from another route is rejected");
assert.deepStrictEqual(fixtures.notArray, ["odpověď RPC není pole řádků"]);

console.log("ALL MATCHING SPATIAL REGRESSION CHECKS PASSED");