/**
 * Regresní test serverového rate limitu pro `google-routes` (migrace 0016):
 *  - statické kontroly SQL: atomicita, auth.uid(), oprávnění, žádné DML navíc,
 *  - konzistence limitů mezi migrací a Edge Function,
 *  - model bucketů (minutové i denní okno) spouštěný se stejnými limity,
 *  - simulace souběhu včetně ukázky, proč nestačí SELECT-then-UPDATE,
 *  - migrace 0015 zůstává beze změny a žádný skript migrace neaplikuje.
 *
 * Testy nic neaplikují, nevolají Supabase ani databázi — jen čtou soubory,
 * transpilují produkční moduly a modelují stejnou logiku nad čistou funkcí.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

function loadTsModule(relativePath, stubs = {}) {
  const filename = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { /* TS sibling below */ }
      try { return loadTsModule(path.relative(root, resolved), stubs); } catch (_) { return {}; }
    }
    return require(request);
  };

  Function('require', 'module', 'exports', '__filename', '__dirname', 'Deno', output)(
    localRequire, module, module.exports, filename, path.dirname(filename), stubs.Deno
  );
  return module.exports;
}

const MIGRATION_PATH = 'supabase/migrations/0016_google_routes_rate_limit.sql';
const migration = read(MIGRATION_PATH);
const migrationSql = migration.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const rateLimitSource = read('supabase/functions/google-routes/rateLimit.ts');
const rateLimit = loadTsModule('supabase/functions/google-routes/rateLimit.ts', {
  'npm:@supabase/supabase-js@2': { createClient: () => ({ rpc: async () => ({ data: null, error: null }) }) },
  Deno: { env: { get: () => undefined } },
});

// ── 1. Migrace: pořadové číslo, soubor a tabulka ────────────────────────────
const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations'))
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
const lastMigration = migrationFiles[migrationFiles.length - 1];
assert(lastMigration === '0016_google_routes_rate_limit.sql', 'migration 0016 is the newest forward-only migration');
const previousNumbers = migrationFiles.map((name) => Number(name.slice(0, 4)));
assert(previousNumbers.every((value, index) => index === 0 || value === previousNumbers[index - 1] + 1), 'migration numbering stays gapless');

assert(migration.includes('create table if not exists public.google_routes_rate_limit_buckets'), 'migration 0016 creates the internal rate limit table');
for (const column of ['user_id uuid primary key', 'minute_bucket_start timestamptz not null', 'minute_request_count integer not null', 'day_bucket_start date not null', 'day_request_count integer not null', 'updated_at timestamptz not null']) {
  assert(migration.includes(column), `rate limit table has ${column.split(' ')[0]} with the expected type`);
}
assert(/minute_request_count >= 0/.test(migration) && /day_request_count >= 0/.test(migration), 'rate limit counters cannot go negative');
assert(!/\bbucket_type\b/.test(migrationSql), 'the limit uses one row per user with two windows (no cross-row drift)');

// ── 2. Migrace: žádný přístup klienta ───────────────────────────────────────
assert(migration.includes('alter table public.google_routes_rate_limit_buckets enable row level security'), 'RLS is enabled on the rate limit table');
assert(!/\bcreate policy\b/i.test(migrationSql), 'the rate limit table has no RLS policy (deny by default)');
assert(migration.includes('revoke all privileges on table public.google_routes_rate_limit_buckets from anon'), 'anon has no table privileges');
assert(migration.includes('revoke all privileges on table public.google_routes_rate_limit_buckets from authenticated'), 'authenticated has no direct table privileges');
assert(migration.includes('revoke all privileges on table public.google_routes_rate_limit_buckets from public'), 'PUBLIC has no table privileges');
assert(!/grant [^;]* on table public\.google_routes_rate_limit_buckets/i.test(migrationSql), 'the rate limit table is never granted to any client role');

// ── 3. Migrace: RPC je bezpečná a atomická ──────────────────────────────────
assert(migration.includes('create or replace function public.consume_google_routes_rate_limit()'), 'the RPC takes no arguments (no user id from the client)');
assert(!/consume_google_routes_rate_limit\([^)]*p_user/i.test(migrationSql), 'the RPC has no user parameter');
assert(migration.includes('returns table (allowed boolean, retry_after_seconds integer)'), 'the RPC returns only the minimal result');
assert(migration.includes('language plpgsql') && migration.includes('security definer'), 'the RPC is SECURITY DEFINER');
assert(migration.includes("set search_path = ''"), 'the RPC pins an empty search_path');
assert(migration.includes('auth.uid()'), 'the RPC derives the identity from auth.uid()');
assert(/if v_user_id is null then/.test(migration) && /errcode = '28000'/.test(migration), 'the RPC refuses an anonymous caller');

const functionBody = /as \$\$([\s\S]*?)\$\$;/.exec(migration);
assert(Boolean(functionBody), 'the RPC body is dollar-quoted');
const body = functionBody[1];
const atomicWrites = body.match(/insert into public\.google_routes_rate_limit_buckets/g) || [];
assert(atomicWrites.length === 1, 'the RPC performs exactly one write statement (single atomic upsert)');
assert(/on conflict \(user_id\) do update/.test(body), 'the RPC uses INSERT ... ON CONFLICT DO UPDATE');
assert(/where \(b\.minute_bucket_start <> v_minute_start or b\.minute_request_count < v_minute_limit\)/.test(body), 'the minute limit is enforced inside the same statement');
assert(/and \(b\.day_bucket_start <> v_day_start or b\.day_request_count < v_day_limit\)/.test(body), 'the daily limit is enforced inside the same statement');
assert(!/\bfor update\b/i.test(body), 'the RPC does not rely on SELECT ... FOR UPDATE');
assert(!/^\s*update public\./im.test(body), 'the RPC has no standalone UPDATE statement (no read-then-write race)');
assert(!/\bselect .* into .* from public\.google_routes_rate_limit_buckets/is.test(body.split('if v_minute_count is not null')[0]), 'the decision path performs no separate read before the write');

assert(migration.includes('revoke all on function public.consume_google_routes_rate_limit() from public'), 'PUBLIC cannot execute the RPC');
assert(migration.includes('revoke all on function public.consume_google_routes_rate_limit() from anon'), 'anon cannot execute the RPC');
assert(migration.includes('grant execute on function public.consume_google_routes_rate_limit() to authenticated'), 'only authenticated can execute the RPC');
assert(!/grant execute on function public\.consume_google_routes_rate_limit\(\) to [^;]*anon/i.test(migrationSql), 'anon never receives execute on the RPC');

// ── 4. Migrace: žádné destruktivní ani mimorozsahové změny ─────────────────
for (const forbidden of [/\btruncate\b/i, /\bdelete from\b/i, /\bdrop \b/i, /\balter table public\.(?!google_routes_rate_limit_buckets)/i]) {
  assert(!forbidden.test(migrationSql), `migration 0016 contains no forbidden statement (${forbidden.source})`);
}
assert(!/^\s*insert into public\.(?!google_routes)/im.test(migrationSql), 'migration 0016 inserts no data outside the limiter table');
assert(!/get_public_marketplace/.test(migrationSql), 'migration 0016 does not touch the public marketplace RPCs');
assert(!/\bselect \*/i.test(migrationSql), 'migration 0016 uses no SELECT *');
assert((migration.match(/\$\$/g) || []).length === 2, 'migration 0016 keeps dollar quoting balanced');
assert((migration.match(/\bbegin;/gi) || []).length === 1 && (migration.match(/\bcommit;/gi) || []).length === 1, 'migration 0016 keeps a single transaction');
assert(!/\bpg_cron\b/.test(migrationSql), 'migration 0016 creates no dependency on a non-existent cron');
assert(/Úklid/.test(migration) && /updated_at/.test(migration), 'migration 0016 documents future cleanup of old buckets');

// ── 5. Konzistence limitů mezi migrací a Edge Function ─────────────────────
const sqlMinuteLimit = Number(/v_minute_limit constant integer := (\d+)/.exec(migration)[1]);
const sqlDayLimit = Number(/v_day_limit constant integer := (\d+)/.exec(migration)[1]);
assert(sqlMinuteLimit === 10, 'the database enforces 10 accepted attempts per minute window');
assert(sqlDayLimit === 100, 'the database enforces 100 accepted attempts per UTC day');
assert(rateLimit.MINUTE_LIMIT === sqlMinuteLimit, 'the Edge Function minute limit matches the migration');
assert(rateLimit.DAY_LIMIT === sqlDayLimit, 'the Edge Function daily limit matches the migration');
assert(rateLimit.RATE_LIMIT_RPC === 'consume_google_routes_rate_limit', 'the Edge Function calls the migration RPC name');
assert(!/\.rpc\([^)]*(userId|user_id)/.test(rateLimitSource), 'the client never passes a user id to the limiter RPC');
assert(rateLimitSource.includes('Authorization: `Bearer ${accessToken}`'), 'the limiter RPC runs with the caller token so auth.uid() resolves');

// ── 6. Normalizace retryAfterSeconds ────────────────────────────────────────
assert(rateLimit.normalizeRetryAfterSeconds(30) === 30, 'a sane retry delay is kept');
assert(rateLimit.normalizeRetryAfterSeconds('30') === 30, 'a numeric string retry delay is accepted');
assert(rateLimit.normalizeRetryAfterSeconds(0) === 60, 'a zero retry delay falls back to the default');
assert(rateLimit.normalizeRetryAfterSeconds(-10) === 60, 'a negative retry delay falls back to the default');
assert(rateLimit.normalizeRetryAfterSeconds('abc') === 60, 'an unparsable retry delay falls back to the default');
assert(rateLimit.normalizeRetryAfterSeconds(undefined) === 60, 'a missing retry delay falls back to the default');
assert(rateLimit.normalizeRetryAfterSeconds(10 ** 9) === 86400, 'an absurd retry delay is clamped to one day');
assert(rateLimit.normalizeRetryAfterSeconds(0.2) === 1, 'a sub-second retry delay rounds up to one second');

// ── 7. Model bucketů: stejné limity jako v SQL ──────────────────────────────
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Atomický model: přečte stav a zapíše v jednom kroku (jako jediný upsert). */
function createStore() {
  return new Map();
}

function consume(store, userId, nowMs, limits = { minute: sqlMinuteLimit, day: sqlDayLimit }) {
  const minuteStart = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const current = store.get(userId) || null;

  const minuteOk = !current || current.minuteStart !== minuteStart || current.minuteCount < limits.minute;
  const dayOk = !current || current.dayStart !== dayStart || current.dayCount < limits.day;

  if (!minuteOk || !dayOk) {
    const retryAfterSeconds = current && current.dayStart === dayStart && !dayOk
      ? Math.max(1, Math.ceil((dayStart + DAY_MS - nowMs) / 1000))
      : Math.max(1, Math.ceil((minuteStart + MINUTE_MS - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  store.set(userId, {
    minuteStart,
    minuteCount: current && current.minuteStart === minuteStart ? current.minuteCount + 1 : 1,
    dayStart,
    dayCount: current && current.dayStart === dayStart ? current.dayCount + 1 : 1,
  });
  return { allowed: true, retryAfterSeconds: 0 };
}

// 7a. Minutové okno
{
  const store = createStore();
  const t0 = Date.UTC(2026, 8, 30, 12, 0, 5);
  const results = [];
  for (let i = 0; i < sqlMinuteLimit; i += 1) results.push(consume(store, 'u1', t0).allowed);
  assert(results.every(Boolean), 'the first 10 attempts in a minute are accepted');
  const blocked = consume(store, 'u1', t0);
  assert(blocked.allowed === false, 'the 11th attempt in the same minute is rejected');
  assert(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60, 'a blocked minute returns a retry delay within the minute');
  assert(store.get('u1').minuteCount === 10, 'a rejected attempt does not increment the counter');

  const nextMinute = Math.floor(t0 / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  assert(consume(store, 'u1', nextMinute).allowed === true, 'a new minute window starts fresh');
  assert(store.get('u1').minuteCount === 1, 'the minute counter resets in the new window');
}

// 7b. Denní okno (UTC) — rozložené po dni, aby nezasáhlo minutový limit
{
  const store = createStore();
  const dayStart = Date.UTC(2026, 8, 30, 0, 0, 0);
  let accepted = 0;
  for (let i = 0; i < sqlDayLimit; i += 1) {
    const now = dayStart + i * MINUTE_MS; // jedna žádost za minutu
    if (consume(store, 'u2', now).allowed) accepted += 1;
  }
  assert(accepted === sqlDayLimit, 'the daily window accepts exactly 100 attempts spread over the day');
  const blocked = consume(store, 'u2', dayStart + sqlDayLimit * MINUTE_MS);
  assert(blocked.allowed === false, 'the 101st attempt of the UTC day is rejected');
  assert(blocked.retryAfterSeconds > 60, 'a blocked day returns a retry delay pointing past the current minute');
  assert(blocked.retryAfterSeconds <= DAY_MS / 1000, 'a blocked day never asks for more than a day');
  assert(store.get('u2').dayCount === sqlDayLimit, 'a rejected attempt leaves the daily counter untouched');

  const nextDay = dayStart + DAY_MS;
  assert(consume(store, 'u2', nextDay).allowed === true, 'a new UTC day starts fresh');
  assert(store.get('u2').dayCount === 1, 'the daily counter resets in the new day');
}

// 7c. Dlouhý běh: limity se nikdy nepřekročí ani těsně u hranice dne
{
  const store = createStore();
  const start = Date.UTC(2026, 8, 30, 23, 55, 0);
  const acceptedPerWindow = new Map();
  let acceptedTotal = 0;
  let rejected = 0;
  for (let i = 0; i < 3000; i += 1) {
    const now = start + i * 1000;
    const decision = consume(store, 'u3', now);
    if (!decision.allowed) { rejected += 1; continue; }
    acceptedTotal += 1;
    const minuteKey = Math.floor(now / MINUTE_MS);
    acceptedPerWindow.set(minuteKey, (acceptedPerWindow.get(minuteKey) || 0) + 1);
  }
  assert(rejected > 0 && acceptedTotal > 0, 'a long burst is partially rejected');
  assert([...acceptedPerWindow.values()].every((count) => count <= sqlMinuteLimit), 'no minute window ever exceeds the limit');
  assert(store.get('u3').minuteCount <= sqlMinuteLimit, 'the stored minute counter never exceeds the limit');
  assert(store.get('u3').dayCount <= sqlDayLimit, 'the stored daily counter never exceeds the limit');
}

// 7d. Souběh: s atomickým zápisem limit drží
{
  const store = createStore();
  const t = Date.UTC(2026, 8, 30, 12, 0, 30);
  let accepted = 0;
  for (let i = 0; i < 40; i += 1) if (consume(store, 'u4', t).allowed) accepted += 1;
  assert(accepted === sqlMinuteLimit, '40 interleaved requests accept exactly the limit, never more');
}

// 7e. Souběh: ukázka, proč nestačí přečíst a pak zapsat
{
  const t = Date.UTC(2026, 8, 30, 12, 0, 30);
  const minuteStart = Math.floor(t / MINUTE_MS) * MINUTE_MS;
  const snapshot = { minuteStart, minuteCount: 9, dayStart: Math.floor(t / DAY_MS) * DAY_MS, dayCount: 20 };

  // Obě "vlákna" vidí stejný stav 9/10 a obě se rozhodnou zapsat 10.
  const decideFromSnapshot = (state) => state.minuteCount < sqlMinuteLimit;
  const writes = [decideFromSnapshot(snapshot), decideFromSnapshot(snapshot)];
  assert(writes.every(Boolean), 'a non-atomic read-then-write would admit an 11th request in the same minute');
  assert(writes.length + snapshot.minuteCount > sqlMinuteLimit, 'this is exactly the race the single-statement upsert prevents');
}

// ── 8. Migrace 0015 zůstává beze změny a neaplikovaná ──────────────────────
const metricsMigration = read('supabase/migrations/0015_verified_route_metrics.sql');
assert(metricsMigration.includes('tow_requests_route_metrics_all_or_none') && metricsMigration.includes('carrier_routes_route_metrics_all_or_none'), 'migration 0015 still holds its all-or-none constraints');
assert(!/rate_limit|rate limit/i.test(metricsMigration), 'migration 0015 was not repurposed for rate limiting');
assert(migration.includes('0015'), 'migration 0016 documents that 0015 stays untouched');

let gitAvailable = true;
let metricsUnchanged = false;
try {
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'supabase/migrations/0015_verified_route_metrics.sql'], { cwd: root });
  metricsUnchanged = true;
} catch (error) {
  gitAvailable = error && error.status === 1 ? true : false;
  metricsUnchanged = false;
}
assert(!gitAvailable || metricsUnchanged, 'migration 0015 is unmodified against HEAD');

const packageJson = JSON.parse(read('package.json'));
const scripts = Object.values(packageJson.scripts || {}).join(' ');
assert(!/supabase (db push|migration up|migration repair)/.test(scripts), 'no npm script applies migrations');
assert(!/\bpsql\b/.test(scripts), 'no npm script runs psql against the database');
const testRlsScript = read('scripts/test-rls-e2e.mjs');
assert(!/db push|migration up/.test(testRlsScript), 'the RLS test script applies no migration');

// ── 9. Nákladová ochrana je zdokumentovaná ─────────────────────────────────
const docs = read('docs/address-routing-matching.md');
assert(/denní kvótu/.test(docs), 'the docs require a Google Cloud daily quota before deploying');
assert(/rozpočtové upozornění/.test(docs), 'the docs require a budget alert');
assert(/není náhradou za Google Cloud kvótu/.test(docs), 'the docs state the app limit is not a substitute for the Google quota');
assert(/500 požadavků Compute Routes za den/.test(docs), 'the docs recommend an initial 500 requests/day test quota');
assert(/Places API \(New\), Routes API\)/.test(docs) || /API klíč/.test(docs), 'the docs require a key restricted to the needed Google APIs');

// ── 10. Statické brány pro živý integrační harness ─────────────────────────
// Harness sám nic nevolá, dokud se nespustí ručně, proto ho chráníme staticky:
// nesmí se spustit z běžného runneru, bez potvrzovacího přepínače nesmí volat
// síť, nesmí obsahovat secrets, nesmí sahat na bucket tabulku ani Edge Function
// a denní limit nesmí vyčerpávat živými voláními.
const HARNESS_PATH = '.roadlink/google-routes-rate-limit-integration.mjs';
const HARNESS_RPC = 'consume_google_routes_rate_limit';
const harness = read(HARNESS_PATH);

function readHarnessClassificationFixtures() {
  const script = [
    "import { classifyRetryAfterSeconds, RETRY_AFTER_KIND, ERROR_PRECONDITION_UNMET } from './.roadlink/google-routes-rate-limit-integration.mjs';",
    "const inputs = [1, 60, 61, 86400, 0, -1, 'abc', 86401];",
    "const classified = inputs.map((value) => ({ value, result: classifyRetryAfterSeconds(value) }));",
    "console.log(JSON.stringify({ kinds: RETRY_AFTER_KIND, preconditionExit: ERROR_PRECONDITION_UNMET, classified }));",
  ].join('\n');
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' }));
}

const harnessRetryFixtures = readHarnessClassificationFixtures();
const harnessClass = new Map(harnessRetryFixtures.classified.map((entry) => [String(entry.value), entry.result]));
assert(harnessRetryFixtures.preconditionExit === 4, 'the harness exposes a distinct nonzero exit code for unmet minute-test preconditions');
assert(harnessClass.get('1').kind === 'minute' && harnessClass.get('1').valid === true, 'retry_after_seconds=1 is a valid minute retry');
assert(harnessClass.get('60').kind === 'minute' && harnessClass.get('60').valid === true, 'retry_after_seconds=60 is a valid minute retry');
assert(harnessClass.get('61').kind === 'daily' && harnessClass.get('61').valid === true, 'retry_after_seconds=61 is a valid daily-limit precondition blocker');
assert(harnessClass.get('86400').kind === 'daily' && harnessClass.get('86400').valid === true, 'retry_after_seconds=86400 is a valid daily-limit precondition blocker');
assert(harnessClass.get('0').kind === 'invalid' && harnessClass.get('0').valid === false, 'retry_after_seconds=0 is an implementation failure');
assert(harnessClass.get('-1').kind === 'invalid' && harnessClass.get('-1').valid === false, 'negative retry_after_seconds is an implementation failure');
assert(harnessClass.get('abc').kind === 'invalid' && harnessClass.get('abc').valid === false, 'non-numeric retry_after_seconds is an implementation failure');
assert(harnessClass.get('86401').kind === 'invalid' && harnessClass.get('86401').valid === false, 'retry_after_seconds above one day is an implementation failure');

// 10a. Nespouští se automaticky z regresního runneru.
const runner = read('scripts/run-regressions.mjs');
assert(!runner.includes('google-routes-rate-limit-integration'), 'the live harness is never wired into the regression runner');

// 10b. Bez potvrzovacího přepínače nesmí sáhnout na síť.
assert(harness.includes('--confirm-live-rate-limit-test'), 'the harness requires an explicit confirmation flag');
assert(/if \(!confirmed\)/.test(harness), 'the harness has a hard guard for the confirmation flag');
const guardAt = harness.indexOf('if (!confirmed)');
const fetchDefinitionAt = harness.indexOf('fetch(');
const mainStartAt = harness.indexOf('async function main()');
const directMainCallAt = harness.indexOf('main().catch');
assert(
  guardAt >= 0 && fetchDefinitionAt >= 0 && mainStartAt >= 0 && directMainCallAt > guardAt && directMainCallAt > mainStartAt,
  'the live main path sits behind the confirmation guard',
);
assert((harness.match(/fetch\(/g) || []).length === 1, 'the harness has exactly one network call site');

// 10c. Žádné hardcoded secrets, URL projektu, JWT ani privilegované role.
assert(!/https?:\/\/[a-z0-9]+\.supabase\.co/i.test(harness), 'the harness hardcodes no Supabase project URL');
assert(!/googleapis\.com/i.test(harness), 'the harness never targets a Google endpoint');
assert(!/eyJ[A-Za-z0-9_-]{10,}/.test(harness), 'the harness embeds no JWT literal');
assert(!/[^\s@]+@[^\s@]+\.[^\s@]+/.test(harness), 'the harness embeds no e-mail address');
assert(!/service[_-]?role/i.test(harness), 'the harness never mentions a privileged Supabase role key');
assert(!/process\.env\.\w*(PASSWORD|SECRET_KEY)/i.test(harness), 'the harness reads no password or secret-key env var');

// 10d. Žádné mutace ani přímý přístup k interní tabulce.
for (const forbidden of [/\binsert\b/i, /\bupdate\b/i, /\bdelete\b/i, /\btruncate\b/i]) {
  assert(!forbidden.test(harness), `the harness contains no mutation keyword (${forbidden.source})`);
}
assert(!/google_routes_rate_limit_buckets/.test(harness), 'the harness never touches the internal bucket table');
assert(!/rest\/v1\/(?!rpc)/.test(harness), 'the harness only talks to the RPC endpoint, never to a table endpoint');
assert((harness.match(/\/rpc\//g) || []).length === 1, 'the harness uses a single RPC endpoint');

// 10e. Nikdy nevolá Edge Function `google-routes` ani jinou funkci.
assert(!/functions\/v1|functions\.invoke|\/functions\//.test(harness), 'the harness never invokes an Edge Function');
assert(harness.includes(HARNESS_RPC), `the harness calls only the approved RPC (${HARNESS_RPC})`);

// 10f. Souběh přes Promise.all a rozumný počet volání.
assert(/Promise\.all/.test(harness), 'the harness fires its burst with Promise.all');
assert(/CONCURRENT_CALLS = 12/.test(harness), 'the harness sends 12 concurrent calls');
assert(new RegExp(`MINUTE_LIMIT = ${sqlMinuteLimit}`).test(harness), 'the harness asserts the same minute limit as the migration');
assert(new RegExp(`DAY_LIMIT = ${sqlDayLimit}`).test(harness), 'the harness documents the same daily limit as the migration');

// 10g. Denní limit se nikdy nevyčerpává živými voláními.
assert(!/for \([^)]*DAY_LIMIT|Array\.from\([^)]*DAY_LIMIT[^)]*\)[^;]*callRateLimit/s.test(harness), 'the harness never loops the daily limit with live calls');
assert(harness.includes('se živě netestuje') || /netestuje/i.test(harness), 'the harness states the daily limit is verified statically');

// 10h. Citlivé runtime proměnné se nikdy nelogují.
assert(/process\.env\.ROADLINK_SUPABASE_URL/.test(harness), 'the harness reads the project URL from runtime env');
assert(/process\.env\.ROADLINK_TEST_ACCESS_TOKEN/.test(harness), 'the harness reads a short-lived access token from runtime env');
assert(!/console\.(log|error|warn)\([^)]*\b(accessToken|anonKey|supabaseUrl)\b/.test(harness), 'the harness never logs token, key or URL variables');
assert(!/console\.(log|error|warn)\([^)]*\$\{accessToken\}/.test(harness), 'the harness never interpolates the access token into a log line');

// 10i. Skript je trackovatelný (allowlist v .gitignore).
const gitignore = read('.gitignore');
assert(gitignore.includes('!.roadlink/google-routes-rate-limit-integration.mjs'), 'the harness is explicitly allowlisted for tracking');

console.log('\nALL GOOGLE ROUTES RATE LIMIT REGRESSION TESTS PASSED');
