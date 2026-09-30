#!/usr/bin/env node
/**
 * Integrační harness pro serverový rate limit funkcí pro výpočet trasy
 * (migrace 0016). Skript je ZÁMĚRNĚ mimo automatický regresní runner — spouští
 * se jen ručně a jen s výslovným potvrzovacím přepínačem, protože jako jediný
 * v repozitáři provádí živá síťová volání.
 *
 * Co dělá (až po aplikaci migrace 0016):
 *   1. ověří, že anonymní volání limiteru je odmítnuto;
 *   2. spustí 12 souběžných autentizovaných volání RPC ve stejném minutovém okně;
 *   3. potvrdí, že povolených odpovědí není nikdy více než 10;
 *   4. potvrdí, že odmítnutá volání vrací bezpečný `retry_after_seconds`;
 *   5. nikdy nezobrazí token ani ID uživatele (jen počty a HTTP statusy);
 *   6. při porušení limitu skončí nenulovým exit kódem.
 *
 * Bezpečnostní mantinely:
 *   * Bez přepínače `--confirm-live-rate-limit-test` skončí bez jakéhokoli
 *     síťového volání.
 *   * Volá VÝHRADNĚ RPC `consume_google_routes_rate_limit` přes PostgREST.
 *   * Nikdy nevolá funkci pro výpočet trasy ani Google API.
 *   * Nepoužívá žádný privilegovaný klíč, nečte `.env` a nezapisuje do žádného souboru.
 *   * Nečte ani nemění interní tabulku bucketů a nikdy ji neresetuje.
 *   * Konfiguraci bere výhradně z runtime proměnných prostředí, které nikdy
 *     nevypisuje: ROADLINK_SUPABASE_URL, ROADLINK_SUPABASE_ANON_KEY,
 *     ROADLINK_TEST_ACCESS_TOKEN (krátkodobý access token jednoho testovacího
 *     uživatele — nikdy heslo).
 *   * Denní limit 100 se NIKDY netestuje živými voláními; zůstává ověřený
 *     staticky (viz .roadlink/rate-limit-regression.js).
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

const CONFIRM_FLAG = "--confirm-live-rate-limit-test";

/** Jediná povolená RPC — serverový limiter RoadLinku. */
const RATE_LIMIT_RPC = "consume_google_routes_rate_limit";

/** Stejné limity jako v migraci 0016; minutový se ověřuje živě, denní jen staticky. */
const MINUTE_LIMIT = 10;
const DAY_LIMIT = 100;

/** Kolik souběžných volání se posílá (musí stačit k překročení minutového limitu). */
const CONCURRENT_CALLS = 12;

/** Do kolika sekund po hranici minuty považujeme okno ještě za „čerstvé“. */
const FRESH_MINUTE_MAX_MS = 2500;

const ERROR_TOO_EARLY = 3;
export const ERROR_PRECONDITION_UNMET = 4;

export const RETRY_AFTER_KIND = Object.freeze({
  MINUTE: "minute",
  DAILY: "daily",
  INVALID: "invalid",
});

export function classifyRetryAfterSeconds(value) {
  if (!Number.isInteger(value)) {
    return { valid: false, kind: RETRY_AFTER_KIND.INVALID };
  }
  if (value >= 1 && value <= 60) {
    return { valid: true, kind: RETRY_AFTER_KIND.MINUTE };
  }
  if (value >= 61 && value <= 86400) {
    return { valid: true, kind: RETRY_AFTER_KIND.DAILY };
  }
  return { valid: false, kind: RETRY_AFTER_KIND.INVALID };
}

function printHelp() {
  console.log(
    [
      "Integrační harness serverového rate limitu (RPC limiteru pro výpočet trasy).",
      "",
      "Použití:",
      `  node .roadlink/google-routes-rate-limit-integration.mjs ${CONFIRM_FLAG}`,
      "  node .roadlink/google-routes-rate-limit-integration.mjs --help",
      "",
      "Bez potvrzovacího přepínače skript neprovede žádné síťové volání.",
      "",
      "Vyžadované runtime proměnné prostředí (nikdy se nevypisují):",
      "  ROADLINK_SUPABASE_URL        URL projektu (např. https://<ref>.supabase.co)",
      "  ROADLINK_SUPABASE_ANON_KEY   publishable/anon klíč (nikdy privilegovaný klíč)",
      "  ROADLINK_TEST_ACCESS_TOKEN   krátkodobý access token jednoho testovacího uživatele",
      "",
      "Co skript dělá:",
      "  * anonymní volání limiteru musí selhat;",
      "  * 12 souběžných autentizovaných volání ve stejném minutovém okně;",
      `  * povolených odpovědí nikdy více než ${MINUTE_LIMIT};`,
      "  * odmítnutá volání musí vrátit bezpečný retry_after_seconds;",
      "  * nenulový exit kód při porušení limitu.",
      "",
      `Denní limit ${DAY_LIMIT} se živě netestuje — zůstává ověřený staticky.`,
    ].join("\n"),
  );
}

function failUsage(message) {
  console.error(`CHYBA: ${message}`);
  console.error("Spusťte s --help pro nápovědu.");
  process.exit(2);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
const args = process.argv.slice(2);
const wantsHelp = args.includes("--help") || args.includes("-h");
const confirmed = args.includes(CONFIRM_FLAG);

let supabaseUrl = "";
let anonKey = "";
let accessToken = "";
let rpcEndpoint = "";

function initializeRuntimeConfig() {
  supabaseUrl = process.env.ROADLINK_SUPABASE_URL;
  anonKey = process.env.ROADLINK_SUPABASE_ANON_KEY;
  accessToken = process.env.ROADLINK_TEST_ACCESS_TOKEN;

  const missing = [
    ["ROADLINK_SUPABASE_URL", supabaseUrl],
    ["ROADLINK_SUPABASE_ANON_KEY", anonKey],
    ["ROADLINK_TEST_ACCESS_TOKEN", accessToken],
  ]
    .filter(([, value]) => typeof value !== "string" || value.trim() === "")
    .map(([name]) => name);

  if (missing.length > 0) {
    failUsage(`chybí runtime proměnné prostředí: ${missing.join(", ")}`);
  }

  rpcEndpoint = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${RATE_LIMIT_RPC}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Zavolá limiter RPC. Když `token` chybí, jde o anonymní volání (musí selhat).
 * Nikdy nevypisuje tělo odpovědi ani hlavičky — jen HTTP status.
 */
async function callRateLimit(token) {
  const headers = {
    "content-type": "application/json",
    apikey: anonKey,
  };
  if (typeof token === "string" && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(rpcEndpoint, {
    method: "POST",
    headers,
    body: "{}",
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { status: response.status, ok: response.ok, payload };
}

/** Z odpovědi PostgREST vytáhne jen bezpečné rozhodnutí (allowed + retry). */
function parseDecision(result) {
  const row = Array.isArray(result.payload) ? result.payload[0] : result.payload;
  if (!row || typeof row !== "object") return null;
  const record = row;
  if (typeof record.allowed !== "boolean") return null;
  const retry = record.retry_after_seconds;
  const retryAfterSeconds = typeof retry === "number" ? retry : null;
  return { allowed: record.allowed, retryAfterSeconds };
}

const failures = [];

function check(condition, label) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures.push(label);
  }
}

async function main() {
  console.log("Integrační test serverového rate limitu (RPC limiteru).");
  console.log(`Očekávaný minutový limit: ${MINUTE_LIMIT}. Denní limit ${DAY_LIMIT} se živě netestuje.`);
  console.log(
    "Upozornění: přesně 10 povolených odpovědí lze očekávat jen v čerstvém minutovém bucketu.",
  );

  // 1. Anonymní volání musí být odmítnuto (RPC má execute jen pro authenticated).
  const anonymous = await callRateLimit(null);
  check(!anonymous.ok, `anonymní volání limiteru je odmítnuto (HTTP ${anonymous.status})`);

  // Počkáme na čerstvé minutové okno, aby měl test maximální šanci vidět plný limit.
  const msIntoMinute = Date.now() % 60000;
  if (msIntoMinute > FRESH_MINUTE_MAX_MS) {
    const waitMs = 60000 - msIntoMinute + 300;
    console.log(`Čekám ${Math.ceil(waitMs / 1000)} s na začátek čerstvé minuty...`);
    return sleep(waitMs).then(runBurst);
  }
  return runBurst();
}

async function runBurst() {
  // 2. Dvanáct souběžných autentizovaných volání ve stejném minutovém okně.
  const results = await Promise.all(
    Array.from({ length: CONCURRENT_CALLS }, () => callRateLimit(accessToken)),
  );

  const httpErrors = results.filter((result) => !result.ok);
  if (httpErrors.length > 0) {
    console.error(
      `CHYBA: ${httpErrors.length} z ${CONCURRENT_CALLS} volání RPC neuspělo (HTTP ${httpErrors
        .map((result) => result.status)
        .join(", ")}). Byla aplikována migrace 0016?`,
    );
    process.exit(ERROR_TOO_EARLY);
  }

  const decisions = results.map(parseDecision);
  const parsed = decisions.filter((decision) => decision !== null);
  check(
    parsed.length === CONCURRENT_CALLS,
    `všech ${CONCURRENT_CALLS} volání vrátilo očekávaný tvar odpovědi`,
  );

  const allowed = parsed.filter((decision) => decision.allowed).length;
  const rejected = parsed.filter((decision) => decision.allowed === false).length;

  // 3. Nikdy nesmí být povoleno více než minutový limit.
  check(allowed <= MINUTE_LIMIT, `povolených volání nepřekročilo limit (${allowed} <= ${MINUTE_LIMIT})`);

  // 4. Odmítnutá volání musí vrátit bezpečný retry_after_seconds.
  //    1–60 s = očekávaný minutový limit (normální průběh testu)
  //    61–86 400 s = denní limit testovacího účtu = BLOKUJÍCÍ PŘEDPOKLAD, ne chyba
  //    mimo rozsah / nečíselné = SKUTEČNÁ chyba implementace
  const rejectedDecisions = parsed.filter((decision) => decision.allowed === false);
  const retryClassifications = rejectedDecisions.map((decision) => ({
    retryAfterSeconds: decision.retryAfterSeconds,
    classification: classifyRetryAfterSeconds(decision.retryAfterSeconds),
  }));
  const invalidRetries = retryClassifications.filter((entry) => !entry.classification.valid);
  const dailyRetries = retryClassifications.filter(
    (entry) => entry.classification.kind === RETRY_AFTER_KIND.DAILY,
  );

  check(
    rejected === 0 || invalidRetries.length === 0,
    "odmítnutá volání vrací bezpečný retry_after_seconds v rozsahu 1–86 400 s",
  );

  if (dailyRetries.length > 0 && invalidRetries.length === 0) {
    // Denní limit testovacího účtu NENÍ chyba limiteru. Vypisujeme pouze
    // obecné hlášení: žádná hodnota retry_after_seconds, žádný token,
    // žádné user ID a žádná část odpovědi serveru. Žádné další síťové
    // volání se nespouští — burst už proběhl, rozhodnutí se jen vyhodnotí.
    console.warn(
      "PODMÍNKA NESPLNĚNA: nejsou splněné předpoklady pro minutový test — " +
        "testovací účet je na denním limitu. Minutový limit se živě nevyhodnocuje.",
    );
    process.exit(ERROR_PRECONDITION_UNMET);
  }

  check(allowed + rejected === parsed.length, "každé volání bylo buď povoleno, nebo odmítnuto");

  // 5. Informativní souhrn — jen počty, nikdy token ani ID uživatele.
  console.log(`Povoleno: ${allowed}, odmítnuto: ${rejected}.`);

  if (allowed === MINUTE_LIMIT) {
    check(rejected === CONCURRENT_CALLS - MINUTE_LIMIT, `souběh odmítl přesně ${CONCURRENT_CALLS - MINUTE_LIMIT} volání navíc`);
  } else {
    console.warn(
      `VAROVÁNÍ: povoleno jen ${allowed} z ${MINUTE_LIMIT}. Bucket nebyl čerstvý ` +
        "(uživatel už v této minutě volal, nebo doběhl na denní limit). " +
        "Pro plný výsledek spusťte test znovu na začátku nové minuty.",
    );
  }

  if (failures.length > 0) {
    console.error(`\nSELHALO ${failures.length} kontrol:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log("\nALL GOOGLE ROUTES RATE LIMIT INTEGRATION CHECKS PASSED");
  process.exit(0);
}

if (isDirectRun) {
  if (wantsHelp) {
    printHelp();
    process.exit(0);
  }

  if (!confirmed) {
    console.log("Nic se neodeslalo. Jde o bezpečný suchý běh.");
    console.log(`Pro živý test spusťte skript s přepínačem ${CONFIRM_FLAG}.`);
    process.exit(0);
  }

  initializeRuntimeConfig();

  main().catch((error) => {
    console.error(`CHYBA: neočekávaná chyba testu (${error && error.name ? error.name : "unknown"}).`);
    process.exit(1);
  });
}
