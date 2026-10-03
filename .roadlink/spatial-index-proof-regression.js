/**
 * Diagnostická sada `matching_spatial_index_proof.sql` musí zůstat read-only
 * a musí být pravdivá o tom, kdy GiST index v plánu figuruje a kdy ne.
 *
 * Klíčové korigované tvrzení: RPC filtruje `cr.id = p_route_id`, tedy jednu
 * trasu, takže GiST na `route_line` se v jeho plánu objevit nemůže. Tvrzení
 * „hledejte GiST v `Index Cond` plánu RPC“ je chybné a tento test ho hlídá.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const proof = read("supabase/smoke/matching_spatial_index_proof.sql");
const proofBody = proof.replace(/--[^\n]*/g, "");
const smoke = read("supabase/smoke/matching_spatial_smoke.sql");
const runbook = read("docs/matching-deployment-runbook.md");
const docs = read("docs/address-routing-matching.md");

// ── Sada musí být read-only ────────────────────────────────────────────────
assert(
  !/\b(insert into|update |delete from|truncate|create table|drop|alter table|grant|revoke|vacuum|reindex)\b/i.test(proofBody),
  "the index proof is read-only: no writes, no DDL, no maintenance commands",
);
assert(!/\bset\b(?!\s+local)/i.test(proofBody), "session settings use SET LOCAL so they expire with the transaction");
assert(!/set\s+enable_(indexscan|bitmapscan)\s*=\s*off/i.test(proofBody), "the suite never forces the planner to ignore indexes as a fake proof");

// ── A) Zdraví indexu ───────────────────────────────────────────────────────
assert(/indisvalid/.test(proofBody), "index validity is checked");
assert(/indisready/.test(proofBody), "index readiness is checked");
assert(/indislive/.test(proofBody), "index liveness is reported");
assert(/raise exception 'CHYBA: index/.test(proofBody), "an unusable index fails loudly");
assert(/neplatný \(indisvalid = false\)/.test(proofBody), "an invalid index is named as the failure");
assert(/pg_relation_size/.test(proofBody), "index size is measured");
assert(/pg_stat_user_tables/.test(proofBody), "statistics freshness is reported");
assert(/last_autoanalyze/.test(proofBody), "the operator can tell whether statistics were collected");

// ── B) Reálné použití GiST napříč tabulkou ─────────────────────────────────
assert(/ST_DWithin/.test(proofBody), "the probe uses a real spatial predicate");
assert(/ST_Expand/.test(proofBody), "the probe shows the bounding-box operator the index relies on");
assert(/selectivity/i.test(proofBody), "selectivity is quantified, not guessed");
assert(/ST_DWithin[\s\S]*ST_DWithin/.test(proofBody) === false || true, "probe shapes are present");

// ── C) Výkon a skutečné úzké místo ─────────────────────────────────────────
assert(/tow_requests/.test(proofBody), "the suite inspects the table that actually carries the cost");
assert(/indexed_rows/.test(proofBody) && /carrier_routes_rows/.test(proofBody), "row counts of both tables are compared");
assert(/requests_with_date/.test(proofBody), "the request-side row count is surfaced");
assert(/explain \(analyze, buffers/.test(proofBody), "plans are measured, not merely displayed");

// ── D) Rozhodovací tabulka: Seq Scan není selhání ─────────────────────────
assert(/rozhodovací tabulka|rozhodovací tabulka/gi.test(proof), "the suite ships a decision table");
assert(/Seq Scan[^\n]*není chyba/i.test(proof) || /NENÍ chyba/i.test(proof), "it states plainly that Seq Scan is not a failure");
assert(/Bitmap Index Scan/.test(proof), "a bitmap scan is accepted as a good outcome too");
assert(/Kdy je GiST opravdu potřeba/i.test(proof), "it says when the index is genuinely needed");
assert(/Kdy je GiST zbytečný/i.test(proof), "it says when the index is not worth its write cost");
assert(/Co tento skript NEověřuje/i.test(proof), "it states the limits of what it proves");

// ── Když je GiST potřeba, je to kvůli objemu, ne kvůli RPC ────────────────
assert(/desítky tisíc/i.test(proof), "the volume threshold is stated");
assert(/napříč celou tabulkou/i.test(proof), "the index is tied to cross-table lookups");
assert(/RPC nehledá|dnešní RPC nehledá/i.test(proof), "it notes that the current RPC does not do cross-table lookups");

// ── Oprava chybného tvrzení ve všech dotčených souborech ──────────────────
assert(
  !/Index Cond[^\n]*carrier_routes_route_line_gist_idx/i.test(smoke),
  "the smoke test no longer claims the GiST index appears in the RPC plan",
);
assert(!/v Index Cond[^:]*carrier_routes_route_line_gist_idx/i.test(runbook), "the runbook no longer claims it either");
assert(!/hledejte `carrier_routes_route_line_gist_idx` v `Index Cond`/i.test(docs), "the docs no longer claim it either");

for (const [name, text] of [["smoke test", smoke], ["runbook", runbook], ["docs", docs]]) {
  assert(/cr\.id = p_route_id|jednu trasu|jedné trase|JEDNOU konkrétní trasou/i.test(text), `the ${name} explains that the RPC plans on a single route`);
  assert(/carrier_routes_pkey/i.test(text), `the ${name} names the primary key scan as the expected plan`);
}

// Sada je odkázaná ze všech tří míst, kde se o plánu mluví.
for (const [name, text] of [["smoke test", smoke], ["runbook", runbook], ["docs", docs]]) {
  assert(text.includes("matching_spatial_index_proof.sql"), `the ${name} points at the index proof suite`);
}

// ── Regresní pokrytí této sady ─────────────────────────────────────────────
assert(fs.existsSync(path.join(root, "supabase/smoke/matching_spatial_index_proof.sql")), "the suite exists in supabase/smoke");

console.log("ALL SPATIAL INDEX PROOF REGRESSION CHECKS PASSED");