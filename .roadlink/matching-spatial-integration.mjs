#!/usr/bin/env node
/**
 * Integrační harness pro prostorový předvýběr kandidátů (migrace
 * 20261005150000 / 160000 / 170000). Skript je ZÁMĚRNĚ mimo automatický
 * regresní runner — spouští se ručně a jen s výslovným potvrzovacím přepínačem,
 * protože je jediný v repozitáři, kdo volá živou databázi.
 *
 * Co dělá (až po aplikaci všech tří prostorových migrací):
 *   1. najde otevřenou trasu s geometrií `route_line`;
 *   2. ověří, že RPC `get_route_matching_candidates_internal` vrací nejvýše
 *      `MAX_MATCH_CANDIDATES` kandidátů;
 *   3. ověří, že kandidáti jsou seřazení od nejbližšího k trase a kandidáti
 *      bez vypočtené vzdálenosti jsou až na konci;
 *   4. ověří, že cizí trasu RPC nevrátí vůbec;
 *   5. ověří, že cizího řidiče RPC neodhalí žádného kandidáta;
 *   6. nikdy nevypíše place ID, souřadnice, geometrii ani ID trasy — jen počty;
 *   7. při porušení smlouvy skončí nenulovým exit kódem.
 *
 * Plán dotazu (`EXPLAIN`) se NEověřuje zde — to je read-only smoke test
 * `supabase/smoke/matching_spatial_smoke.sql`, který se spouští ručně.
 *
 * Bezpečnostní mantinely:
 *   * Bez přepínače `--confirm-live-spatial-smoke` skončí bez jediného síťového
 *     volání (suchý běh).
 *   * Volá VÝHRADNĚ interní RPC předvýběru kandidátů. Neplatí nabídky, nemění
 *     stav poptávky ani trasy, nespouští Google API.
 *   * Nepoužívá žádný Edge Function klíč Google API; jen Supabase service_role,
 *     protože RPC je záměrně `service_role`-only.
 *   * Konfiguraci bere výhradně z runtime proměnných prostředí, které nikdy
 *     nevypisuje: ROADLINK_SUPABASE_URL, ROADLINK_SERVICE_ROLE_KEY.
 *   * Neprovádí žádné INSERT/UPDATE/DELETE a nezapisuje do žádného souboru.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

const CONFIRM_FLAG = "--confirm-live-spatial-smoke";

/** Jediná povolená RPC — vnitřní předvýběr kandidátů. */
const CANDIDATE_RPC = "get_route_matching_candidates_internal";

/** Musí odpovídat `MAX_MATCH_CANDIDATES` v matchingRequest.ts. */
export const MAX_MATCH_CANDIDATES = 5;

/** Náhodné UUID v podobě, jakou filtr route_id v RPC přijímá. */
const UNKNOWN_ROUTE_ID = "00000000-0000-4000-8000-000000000000";

export const ERROR_PRECONDITION_UNMET = 4;
export const ERROR_RPC_FAILED = 5;

/**
 * Čistá kontrola smlouvy RPC: limit, monotónní pořadí podle vzdálenosti a to,
 * že všichni kandidáti patří téže trase. Bez síťování, jde testovat izolovaně.
 *
 * @returns {string[]} seznam porušení; prázdné pole = vše v pořádku.
 */
export function checkCandidateRows(rows, limit = MAX_MATCH_CANDIDATES, expectedRouteId = null) {
  const failures = [];
  if (!Array.isArray(rows)) {
    return ["odpověď RPC není pole řádků"];
  }
  if (rows.length > limit) {
    failures.push(`RPC vrátilo ${rows.length} řádků, limit je ${limit}`);
  }

  let previous = null;
  let seenWithoutDistance = false;

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      failures.push("RPC vrátilo řádek, který není objekt");
      continue;
    }
    if (expectedRouteId && String(row.route_id ?? "") !== expectedRouteId) {
      failures.push("RPC vrátilo kandidáta k jiné trase");
    }

    const rawDistance = row.route_proximity_meters;
    const distance = typeof rawDistance === "number" ? rawDistance : Number(rawDistance);
    if (rawDistance === null || rawDistance === undefined || !Number.isFinite(distance)) {
      seenWithoutDistance = true;
      continue;
    }
    if (seenWithoutDistance) {
      failures.push("kandidát s vypočtenou vzdáleností následuje za kandidátem bez vzdálenosti");
    }
    if (previous !== null && distance < previous) {
      failures.push("pořadí podle vzdálenosti od trasy je porušeno");
    }
    previous = distance;
  }

  return failures;
}

/** Vyhledá otevřenou trasu s geometrií; vrací jen `id` a `driver_id`. */
async function findTestRoute(client) {
  const { data, error } = await client
    .from("carrier_routes")
    .select("id, driver_id")
    .eq("status", "open")
    .gt("available_spaces", 0)
    .not("route_line", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw new Error(`nepodařilo se najít testovací trasu: ${error.message}`);
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function callCandidateRpc(client, routeId, driverId) {
  const { data, error } = await client.rpc(CANDIDATE_RPC, {
    p_route_id: routeId,
    p_driver_id: driverId,
    p_limit: MAX_MATCH_CANDIDATES,
  });

  if (error) throw new Error(`RPC selhala: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

function printHelp() {
  console.log(`
Integrační test prostorového předvýběru kandidátů (READ-ONLY).

Předpoklady:
  * aplikované migrace 20261005150000, 20261005160000, 20261005170000
  * proměnné prostředí ROADLINK_SUPABASE_URL a ROADLINK_SERVICE_ROLE_KEY

Použití:
  node .roadlink/matching-spatial-integration.mjs               # suchý běh, nic neposílá
  node .roadlink/matching-spatial-integration.mjs ${CONFIRM_FLAG}

Skript nic nezapisuje: volá jen interní RPC a čte jednu trasu, aby našel
vhodného testovacího subjekt. Place ID, souřadnice ani geometrii nevypisuje.
`.trim());
}

function isDirectRun() {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

async function main() {
  const url = process.env.ROADLINK_SUPABASE_URL;
  const serviceKey = process.env.ROADLINK_SERVICE_ROLE_KEY;
  const missing = [!url && "ROADLINK_SUPABASE_URL", !serviceKey && "ROADLINK_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length > 0) {
    console.error(`CHYBA: chybí proměnné prostředí: ${missing.join(", ")}`);
    process.exit(ERROR_PRECONDITION_UNMET);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const route = await findTestRoute(client);
  if (!route) {
    console.log("PŘESKOČENO: žádná otevřená trasa s geometrií route_line. Nejdřív vytvořte trasu se souřadnicemi.");
    return;
  }

  const failures = [];
  const own = await callCandidateRpc(client, route.id, route.driver_id);
  failures.push(...checkCandidateRows(own, MAX_MATCH_CANDIDATES, route.id));
  console.log(`OK: vlastní trasa vrátila ${own.length} kandidátů (limit ${MAX_MATCH_CANDIDATES}).`);

  const foreignRoute = await callCandidateRpc(client, UNKNOWN_ROUTE_ID, route.driver_id);
  if (foreignRoute.length > 0) {
    failures.push(`RPC vrátilo ${foreignRoute.length} kandidátů pro neexistující trasu`);
  }
  console.log(`OK: neexistující trasa vrátila ${foreignRoute.length} kandidátů.`);

  const foreignDriver = await callCandidateRpc(client, route.id, UNKNOWN_ROUTE_ID);
  if (foreignDriver.length > 0) {
    failures.push(`RPC vrátilo ${foreignDriver.length} kandidátů cizímu řidiči`);
  }
  console.log(`OK: cizí řidič dostal ${foreignDriver.length} kandidátů.`);

  if (failures.length > 0) {
    console.error(`\nSELHALO ${failures.length} kontrol:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log("\nALL MATCHING SPATIAL INTEGRATION CHECKS PASSED");
}

if (isDirectRun()) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (!process.argv.includes(CONFIRM_FLAG)) {
    console.log("Nic se neodeslalo. Jde o bezpečný suchý běh.");
    console.log(`Pro živý test spusťte skript s přepínačem ${CONFIRM_FLAG}.`);
    process.exit(0);
  }

  main().catch((error) => {
    console.error(`CHYBA: neočekávaná chyba testu (${error && error.name ? error.name : "unknown"}).`);
    process.exit(ERROR_RPC_FAILED);
  });
}