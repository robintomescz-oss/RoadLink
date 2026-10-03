/**
 * Soukromí, bezpečnost a pořadí migrací pro matching s průjezdnými body.
 *
 * Účelem je zachytit situaci, kdy by se přesné údaje o trase (adresa, place ID,
 * souřadnice, geometrie, průjezdné body) dostaly do veřejného feedu, do logů,
 * nebo kdyby migrace oslabila oprávnění. Testy jsou čistě statické — žádná
 * databáze, žádné síťové volání.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");

const migrationsDir = path.join(root, "supabase/migrations");
const viaMigrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => /^20261005[1-8][0-9]{5}_/.test(name))
  .sort();

assert.deepStrictEqual(
  viaMigrations,
  [
    "20261005120000_matching_includes_via_routes.sql",
    "20261005130000_matching_via_coordinates.sql",
    "20261005140000_matching_sql_geo_preselection.sql",
    "20261005150000_enable_postgis.sql",
    "20261005160000_carrier_route_spatial_line.sql",
    "20261005170000_matching_spatial_preselection.sql",
    "20261005180000_matching_spatial_cleanup.sql",
  ],
  "the via-matching migrations exist exactly once each and sort into the intended order",
);

// ── 1) Odpovědnost jednotlivých kroků (žádné duplicity, žádné rozpory) ──────
const roles = {
  "20261005120000_matching_includes_via_routes.sql": (body) => {
    assert(/drop function if exists public\.get_route_matching_candidates_internal/i.test(body), "the via inclusion rebuilds the RPC whose return type changes");
    assert(/route_via_place_ids/i.test(body), "the RPC hands the Edge Function the via places in order");
    assert(!/is not null and cardinality\(cr\.via_place_ids\)/i.test(body), "routes with via places are no longer excluded from matching");
  },
  "20261005130000_matching_via_coordinates.sql": (body) => {
    assert(/add column if not exists via_latitudes double precision\[\]/i.test(body), "private via latitudes are added");
    assert(/add column if not exists via_longitudes double precision\[\]/i.test(body), "private via longitudes are added");
    assert(/carrier_routes_via_places_validate/i.test(body), "the validation trigger covers the coordinate pair");
  },
  "20261005140000_matching_sql_geo_preselection.sql": (body) => {
    assert(/assign_carrier_route_bbox/i.test(body), "the transitional bbox step keeps its own trigger");
  },
  "20261005150000_enable_postgis.sql": (body) => {
    assert(/create extension if not exists postgis/i.test(body), "PostGIS is enabled in its own step so it can be stopped alone");
  },
  "20261005160000_carrier_route_spatial_line.sql": (body) => {
    assert(/add column if not exists route_line/i.test(body), "the real route geometry is added in its own step");
  },
  "20261005170000_matching_spatial_preselection.sql": (body) => {
    assert(/create or replace function public\.get_route_matching_candidates_internal/i.test(body), "the spatial preselection is the last step that redefines the RPC");
  },
  "20261005180000_matching_spatial_cleanup.sql": (body) => {
    assert(/drop column if exists bbox_min_lat/i.test(body), "the cleanup drops the transitional bbox columns");
    assert(/assign_carrier_route_geometry/i.test(body), "the cleanup leaves a single geometry source of truth");
  },
};

for (const name of viaMigrations) {
  assert(typeof roles[name] === "function", `${name} has a defined responsibility in the rollout`);
  roles[name](stripComments(read(path.join("supabase/migrations", name))));
}

// Migrace se nesmí překrývat v jedné a téže věci: geometrii odvozuje jen jeden
// trigger po uklízení, do té doby jsou v historii oba (bbox i route_line).
const cleanup = stripComments(read("supabase/migrations/20261005180000_matching_spatial_cleanup.sql"));
assert(!/create trigger carrier_routes_bbox_assign/i.test(cleanup), "the cleanup does not re-create the bbox trigger");
assert(!/create trigger carrier_routes_route_line_assign/i.test(cleanup), "the cleanup does not re-create the superseded geometry trigger");
assert(/create trigger carrier_routes_route_geometry_assign/i.test(cleanup), "the cleanup installs exactly one geometry trigger");

// ── 2) Úklid je poslední krok, dopředný a idempotentní ─────────────────────
const names = viaMigrations;
assert.strictEqual(names[names.length - 1], "20261005180000_matching_spatial_cleanup.sql", "the cleanup is the last migration in the rollout");
assert(/20261005170000/.test(cleanup) && /20261005160000/.test(cleanup), "the cleanup names the steps it depends on");

assert(/^begin;/i.test(cleanup.trim()) && /commit;\s*$/i.test(cleanup.trim()), "the cleanup is a single explicit transaction");
assert((cleanup.match(/\bdrop\b/g) || []).length > 0, "the cleanup really drops something");
const unguardedDrops = cleanup.match(/\bdrop\s+(trigger|function|index|column|table)\b(?![^;]*\bif exists\b)[^;]*;/gi) || [];
assert.deepStrictEqual(unguardedDrops, [], "every drop in the cleanup is guarded by if exists (idempotent replay)");
assert(/raise exception/i.test(cleanup), "the cleanup fails loudly instead of half-applying");
assert(cleanup.indexOf("raise exception") < cleanup.search(/\bdrop\s/i), "preconditions are verified before the first drop");
assert(!/delete from/i.test(cleanup), "the cleanup deletes no rows");
assert(!/update\s+public\.carrier_routes/i.test(cleanup), "the cleanup updates no route data");
assert(!/insert into/i.test(cleanup), "the cleanup inserts no data");
assert(!/\bgrant\b/i.test(cleanup), "the cleanup grants nothing");
assert(!/alter table[\s\S]*?row level security/i.test(cleanup), "the cleanup does not touch RLS");
assert(!/get_public_marketplace_routes/i.test(cleanup), "the cleanup does not touch the public feed");
assert(/návratová cesta|rollback/i.test(read("supabase/migrations/20261005180000_matching_spatial_cleanup.sql")), "the rollback path is documented in the file itself");

// ── 3) Žádná nová migrace nesmí oslabit oprávnění ──────────────────────────
for (const name of viaMigrations) {
  const body = stripComments(read(path.join("supabase/migrations", name)));

  assert(!/grant\s+execute[\s\S]*?\bto\s+(anon|authenticated)\b/i.test(body), `${name} never grants the matching RPC to anon or authenticated`);
  assert(!/grant\s+select[\s\S]*?\bon\s+public\.carrier_routes\b/i.test(body), `${name} never grants direct select on carrier_routes`);
  assert(!/row level security/i.test(body), `${name} does not reconfigure RLS`);
  assert(!/drop policy/i.test(body), `${name} does not drop any policy`);
  assert(!/\bgrant all\b|\bgrant select\b/i.test(body), `${name} grants no blanket table privileges`);

  // Interní RPC zůstává `security definer` s prázdným search_pathem a jen pro
  // služební roli; veřejné funkce se tím nedotýkají.
  if (/create or replace function public[.]get_route_matching_candidates_internal|drop function if exists public[.]get_route_matching_candidates_internal/i.test(body)) {
    assert(/security definer/i.test(body), `${name} keeps the internal RPC security definer`);
    assert(/set search_path = ''/i.test(body), `${name} keeps the internal RPC search_path empty`);
    assert(/revoke all on function public\.get_route_matching_candidates_internal\(uuid, uuid, integer\) from anon/i.test(body), `${name} revokes the internal RPC from anon`);
    assert(/revoke all on function public\.get_route_matching_candidates_internal\(uuid, uuid, integer\) from authenticated/i.test(body), `${name} revokes the internal RPC from authenticated`);
    assert(/grant execute on function public\.get_route_matching_candidates_internal\(uuid, uuid, integer\) to service_role/i.test(body), `${name} grants the internal RPC to service_role only`);
  }
}

// ── 4) Soukromé údaje nikdy do veřejného feedu ─────────────────────────────
const publicFeedMigrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => /public|market|feed/.test(name))
  .sort();

const feedBody = publicFeedMigrations
  .map((name) => stripComments(read(path.join("supabase/migrations", name))))
  .join("\n");
assert(!/via_latitudes|via_longitudes/.test(feedBody.replace(/grant|select \* from public\.carrier_routes/gi, "")), "public feed migrations never select via coordinates");

const feedFunction = fs
  .readdirSync(migrationsDir)
  .filter((name) => /public_marketplace/.test(name))
  .map((name) => stripComments(read(path.join("supabase/migrations", name))))
  .join("\n");
for (const forbidden of ["via_latitudes", "via_longitudes", "route_line", "bbox_min_lat", "route_via_place_ids"]) {
  const withoutFunctionName = feedFunction.replace(/get_public_marketplace_routes/gi, "");
  assert(!new RegExp(`coalesce\\([^)]*${forbidden}`, "i").test(withoutFunctionName), `the public feed never coalesces ${forbidden}`);
}

// Veřejný feed smí vracet jen bezpečné popisky oblastí.
assert(/public_label/i.test(feedFunction), "the public feed still returns public area labels");
assert(!/formatted_address|place_id\b/i.test(feedFunction.replace(/via_public_labels/gi, "")), "the public feed exposes neither exact addresses nor place IDs");

// Edge Function odpověď klientovi smí obsahovat jen bezpečná pole.
const matchingIndex = read("supabase/functions/google-route-matches/index.ts");
const clientResponse = matchingIndex.slice(matchingIndex.indexOf("reasonCodes"), matchingIndex.length);
assert(!/via_latitudes|via_longitudes|route_line|route_via_place_ids|route_via_latitudes|route_via_longitudes/.test(clientResponse), "the Edge Function response carries no private route details to the client");

// ── 5) Žádné nové logování citlivých údajů ────────────────────────────────
for (const file of [
  "supabase/functions/google-route-matches/index.ts",
  "supabase/functions/google-route-matches/matchingRequest.ts",
  "lib/createFormLogic.ts",
  "screens/Transport/RouteFormRoute.tsx",
]) {
  const source = read(file);
  const logLines = source.split("\n").filter((line) => /console\.(log|info|debug|warn|error)/.test(line));
  for (const line of logLines) {
    assert(!/placeId|place_id|latitude|longitude|formattedAddress|via\b/i.test(line), `${file} never logs addresses, place IDs, coordinates or via points`);
    assert(!/token|authorization|apikey|api_key/i.test(line), `${file} never logs tokens or keys`);
  }
}

const newLogs = read("supabase/functions/google-route-matches/index.ts")
  .split("\n")
  .filter((line) => /console\.error/.test(line));
assert(newLogs.length > 0, "upstream failures are still logged for operators");
assert(
  newLogs.every((line) => /source|status|reason/.test(line)),
  "the new logs carry only an error class, never the payload",
);

// ── 6) Živý harness zůstává pod bránou a nic netiskne ───────────────────────
const harness = read(".roadlink/matching-spatial-integration.mjs");
assert(/--confirm-live-spatial-smoke/.test(harness), "the live harness keeps its explicit confirmation flag");
assert(!read("scripts/run-regressions.mjs").includes("matching-spatial-integration"), "the live harness stays out of the regression runner");
assert(!/route_via_place_ids|route_via_latitudes/.test(harness.split("console.log")[0]), "the harness queries the RPC but prints nothing private");

console.log("ALL VIA PRIVACY AND MIGRATION ORDER CHECKS PASSED");