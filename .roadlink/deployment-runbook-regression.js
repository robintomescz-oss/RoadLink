/**
 * Runbook pro ruční nasazení sedmi matchingových migrací musí zůstat v souladu
 * se skutečnými soubory. Test je statický: kontroluje, že runbook jmenuje
 * všechny kroky ve správném pořadí, má kontrolní dotaz po každém kroku,
 * popisuje rollback a nepropouští krok, který by měnil vzdálenou databázi
 * bez lidského rozhodnutí.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runbook = read("docs/matching-deployment-runbook.md");

const steps = [
  { file: "20261005120000_matching_includes_via_routes.sql", key: "120000" },
  { file: "20261005130000_matching_via_coordinates.sql", key: "130000" },
  { file: "20261005140000_matching_sql_geo_preselection.sql", key: "140000" },
  { file: "20261005150000_enable_postgis.sql", key: "150000" },
  { file: "20261005160000_carrier_route_spatial_line.sql", key: "160000" },
  { file: "20261005170000_matching_spatial_preselection.sql", key: "170000" },
  { file: "20261005180000_matching_spatial_cleanup.sql", key: "180000" },
];

// ── Kompletnost a pořadí ───────────────────────────────────────────────────
for (const step of steps) {
  assert(fs.existsSync(path.join(root, "supabase/migrations", step.file)), `${step.file} exists`);
  assert(runbook.includes(step.file), `the runbook names ${step.file}`);
}

const mentioned = [...new Set([...runbook.matchAll(/202610051[2-8]0000_[a-z_]+\.sql/g)].map((match) => match[0]))];
const positions = steps.map((step) => mentioned.indexOf(step.file));
for (let index = 0; index < positions.length; index += 1) {
  assert(positions[index] > -1, `step ${steps[index].key} is named in the runbook`);
  if (index > 0) {
    assert(positions[index] > positions[index - 1], `the runbook introduces ${steps[index].file} after ${steps[index - 1].file}`);
  }
}

const headings = runbook.match(/^## Krok \d+ .*$/gm) || [];
assert.strictEqual(headings.length, steps.length, "the runbook has exactly seven step headings");
for (const step of steps) {
  assert(new RegExp(`^## Krok \\d+ .*${step.key}`, "m").test(runbook), `step ${step.key} has its own heading`);
}

const applyCommands = runbook.match(/-f supabase\/migrations\/202610051[2-8]0000_[a-z_]+\.sql/g) || [];
assert.strictEqual(applyCommands.length, steps.length, "every step shows how to apply exactly one migration file");

const verificationBlocks = runbook.match(/### Kontrola po kroku \d/g) || [];
assert.strictEqual(verificationBlocks.length, steps.length, "every step has its own verification section");

// ── Kontrolní dotazy jsou skutečné dotazy ──────────────────────────────────
const fence = "`".repeat(3);
const sqlPattern = new RegExp(fence + "sql\\n([\\s\\S]*?)" + fence, "g");
const sqlBlocks = [...runbook.matchAll(sqlPattern)].map((match) => match[1]);
assert(sqlBlocks.length >= steps.length + 1, "the runbook has a baseline block, one check per step and a rollback block");
const allSql = sqlBlocks.join("\n");

for (const fragment of [
  "information_schema.columns",
  "information_schema.routine_privileges",
  "pg_get_functiondef",
  "pg_index",
  "pg_extension",
  "to_regprocedure",
]) {
  assert(allSql.includes(fragment), `the verification queries use ${fragment}`);
}
assert(/explain \(analyze, buffers\)/i.test(allSql), "the plan is checked with EXPLAIN (ANALYZE, BUFFERS)");
assert(/carrier_routes_route_line_gist_idx/.test(allSql), "the plan check points at the GiST index");
assert(/ST_NPoints/.test(allSql), "the geometry is checked for the right number of points");
assert(/ST_MakePoint|ST_NPoints/.test(allSql), "geometry is inspected with PostGIS functions");

// ── Zastávky a podmínky pokračování ────────────────────────────────────────
assert(/STOP|ZASTAVKA/i.test(runbook), "the runbook tells the operator when to stop");
assert(allSql.includes("to_regtype('extensions.geography linestring')"), "the PostGIS step verifies the LineString geography type");
assert(allSql.includes("still_bbox") && allSql.includes("still_haversine"), "step 6 proves the RPC no longer reads the transitional structures");
assert(allSql.includes("bbox_columns_left") && allSql.includes("haversine_gone"), "step 7 proves the transitional structures are gone");
assert(allSql.includes("grantee"), "the runbook checks execute privileges");
assert(runbook.includes("service_role") && runbook.includes("anon"), "the runbook names both the allowed and the forbidden role");
assert(/still_excluded/.test(allSql), "step 1 proves via routes are no longer excluded from matching");

const postgisSection = runbook.slice(runbook.indexOf("150000_enable_postgis"));
assert(/Kroky 5–7 \*\*neaplikujte\*\*/.test(postgisSection), "if PostGIS is unavailable the runbook stops the rollout instead of guessing");

// ── Rollback ───────────────────────────────────────────────────────────────
const rollbackHeading = runbook.indexOf("## Rollback celého řetězce");
assert(rollbackHeading > -1, "the runbook documents a full-chain rollback");
const rollbackSql = runbook.slice(rollbackHeading);
assert(/drop column if exists route_line/.test(rollbackSql), "the rollback removes the derived geometry column");
assert(/assign_carrier_route_geometry/.test(rollbackSql), "the rollback removes the geometry trigger function");
assert(/záložte/i.test(rollbackSql), "the rollback warns that via coordinates cannot be recomputed without Place Details");
assert(/Edge Function/i.test(rollbackSql), "the rollback warns that a deployed Edge Function must be reverted first");
assert(/20261001090000/.test(rollbackSql), "the rollback points at the previous via-excluding migration as the target state");

const headingPositions = headings.map((heading) => runbook.indexOf(heading));
for (let index = 1; index < steps.length; index += 1) {
  const section = runbook.slice(headingPositions[index], headingPositions[index + 1] ?? runbook.length);
  assert(/[Rr]ollback/.test(section), `step ${steps[index].key} states what a rollback looks like`);
}

// ── Runbook nesmí být návodem, který se dá spustit bez lidského kroku ──────
assert(/neprovádí agent/i.test(runbook), "the runbook states that the agent does not run it");
assert(!/supabase db push/.test(runbook.replace(/`supabase db push`/gi, "")), "the runbook never instructs `db push`");
const forbiddenMentions = [...runbook.matchAll(/`supabase db push`|`migration repair`|Edge Functions neprovádím/gi)].map((m) => m[0]);
assert(forbiddenMentions.length > 0, "the runbook names the operations the agent must not perform");
assert(!/-f supabase\/|supabase functions deploy/.test(runbook.slice(runbook.indexOf("neprovádím") - 200, runbook.indexOf("neprovádím") + 400)), "no runnable command sits next to the forbidden list");
assert(!/supabase functions deploy|supabase db reset/i.test(runbook), "the runbook never instructs a function deploy or a database reset");

assert(runbook.includes("**ZASTAVKA**") && runbook.includes("**POSLEDNÍ**"), "the runbook marks the blocking steps");
assert(runbook.includes("ověřeném produkčním chodu"), "the cleanup step waits for verified production traffic");
assert(runbook.includes("ON_ERROR_STOP"), "migrations are applied with an error that stops the run");

console.log("ALL DEPLOYMENT RUNBOOK REGRESSION CHECKS PASSED");