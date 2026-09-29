/**
 * Regresní test Google Routes (část B):
 *  - validace požadavku na Edge Function `google-routes`,
 *  - normalizace vzdálenosti a doby trasy,
 *  - odmítnutí neplatných place ID,
 *  - sanitizace chyb (žádný text z Google ke klientovi),
 *  - klientský kontrakt lib/routeMetrics.ts (dnes nezapojený do formulářů),
 *  - kontrola, že soukromé sloupce z migrace 0015 neuniknou do veřejného trhu.
 *
 * Testy běží nad skutečnými produkčními TS moduly (transpile + require),
 * ne nad kopiemi logiky. Nic nevolá síť, Supabase ani databázi.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

/**
 * Načte TS modul jako CommonJS. Umí i TS sourozence bez přípony (.ts import)
 * a umí podstrčit globální Deno/fetch/console, aby šla testovat i Edge Function
 * bez sítě a bez reálného klíče.
 */
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

  Function('require', 'module', 'exports', '__filename', '__dirname', 'Deno', 'fetch', 'console', output)(
    localRequire, module, module.exports, filename, path.dirname(filename),
    stubs.Deno, stubs.fetch, stubs.console
  );
  return module.exports;
}

/** Načte Edge Function `google-routes` s podstrčeným Deno, fetch a console. */
function loadEdgeEntry({ fetchImpl }) {
  const logs = [];
  const deno = {
    serve: (handler) => { deno.handler = handler; },
    env: { get: (name) => (name === 'GOOGLE_MAPS_SERVER_API_KEY' ? 'unit-test-placeholder' : undefined) },
  };
  const capturingConsole = {
    log: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const routeRequestModule = loadTsModule('supabase/functions/google-routes/routeRequest.ts');
  loadTsModule('supabase/functions/google-routes/index.ts', {
    './routeRequest.ts': routeRequestModule,
    './routeRequest': routeRequestModule,
    Deno: deno,
    fetch: fetchImpl,
    console: capturingConsole,
  });
  return { handler: deno.handler, logs };
}

const edge = loadTsModule('supabase/functions/google-routes/routeRequest.ts');
const client = loadTsModule('lib/routeMetrics.ts', {
  './supabase': { supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } },
});

// ── 1. Validace place ID ────────────────────────────────────────────────────
assert(edge.normalizePlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4') === 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'valid Google place ID is accepted');
assert(edge.normalizePlaceId('  ChIJabc-123_x.y  ') === 'ChIJabc-123_x.y', 'place ID is trimmed');
assert(edge.normalizePlaceId('') === null, 'empty place ID is rejected');
assert(edge.normalizePlaceId('   ') === null, 'whitespace-only place ID is rejected');
assert(edge.normalizePlaceId('ChIJ with space') === null, 'place ID with whitespace inside is rejected');
assert(edge.normalizePlaceId('ChIJ/../etc/passwd') === null, 'place ID with path characters is rejected');
assert(edge.normalizePlaceId("ChIJ' OR 1=1--") === null, 'place ID with SQL metacharacters is rejected');
assert(edge.normalizePlaceId(12345) === null, 'non-string place ID is rejected');
assert(edge.normalizePlaceId(null) === null, 'null place ID is rejected');
assert(edge.normalizePlaceId('a'.repeat(256)) === null, 'over-long place ID is rejected instead of truncated');
assert(edge.normalizePlaceId('a'.repeat(255)) === 'a'.repeat(255), 'place ID at the length limit is accepted');

// ── 2. Validace požadavku ───────────────────────────────────────────────────
const valid = edge.validateRouteRequest({ originPlaceId: 'ChIJorigin-1', destinationPlaceId: 'ChIJdestination-2' });
assert(valid.ok === true, 'valid request passes validation');
assert(valid.value.originPlaceId === 'ChIJorigin-1' && valid.value.destinationPlaceId === 'ChIJdestination-2', 'validated request carries only the two place IDs');

for (const [label, body] of [
  ['missing body', undefined],
  ['null body', null],
  ['string body', 'ChIJx'],
  ['array body', ['ChIJx']],
  ['empty object', {}],
  ['missing destination', { originPlaceId: 'ChIJa' }],
  ['missing origin', { destinationPlaceId: 'ChIJb' }],
  ['blank origin', { originPlaceId: '   ', destinationPlaceId: 'ChIJb' }],
  ['invalid destination', { originPlaceId: 'ChIJa', destinationPlaceId: 'has space' }],
]) {
  const result = edge.validateRouteRequest(body);
  assert(result.ok === false && result.code === 'invalid_request' && result.status === 400, `invalid request is rejected (${label})`);
}

const samePlace = edge.validateRouteRequest({ originPlaceId: 'ChIJsame', destinationPlaceId: 'ChIJsame' });
assert(samePlace.ok === false && samePlace.code === 'invalid_request', 'identical origin and destination is rejected');

// ── 3. Pevné tělo volání Google ─────────────────────────────────────────────
const body = edge.buildComputeRoutesBody({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb' });
assert(body.origin.placeId === 'ChIJa' && body.destination.placeId === 'ChIJb', 'compute routes body uses the two place IDs');
assert(body.travelMode === 'DRIVE' && body.routingPreference === 'TRAFFIC_UNAWARE' && body.units === 'METRIC', 'compute routes body is fixed by the server');
assert(!JSON.stringify(body).includes('http'), 'client cannot influence the Google URL through the body');
assert(edge.ROUTES_FIELD_MASK === 'routes.distanceMeters,routes.duration', 'field mask requests only distance and duration');
assert(!edge.ROUTES_FIELD_MASK.includes('polyline'), 'field mask never requests route geometry');
assert(edge.ROUTES_COMPUTE_URL.startsWith('https://routes.googleapis.com/'), 'compute routes URL is a fixed Google endpoint');
assert(edge.ROUTES_TIMEOUT_MS > 0 && edge.ROUTES_TIMEOUT_MS <= 15000, 'routes timeout is present and reasonable');

// ── 4. Normalizace vzdálenosti a doby ───────────────────────────────────────
assert(edge.parseDurationSeconds('1234s') === 1234, 'duration "1234s" is parsed to seconds');
assert(edge.parseDurationSeconds('12.6s') === 13, 'fractional duration is rounded');
assert(edge.parseDurationSeconds(42) === 42, 'numeric duration is accepted as seconds');
assert(edge.parseDurationSeconds('abc') === null, 'unparsable duration is rejected');
assert(edge.parseDurationSeconds('') === null, 'empty duration is rejected');
assert(edge.parseDurationSeconds('-5s') === null, 'negative duration is rejected');
assert(edge.parseDurationSeconds(undefined) === null, 'missing duration is rejected');

const metrics = edge.normalizeRouteMetrics({ routes: [{ distanceMeters: 12345, duration: '1234s' }] });
assert(metrics && metrics.distanceMeters === 12345 && metrics.durationSeconds === 1234, 'route metrics are normalized');
assert(edge.normalizeRouteMetrics({ routes: [{ distanceMeters: 100.7, duration: '60s' }] }).distanceMeters === 101, 'distance is rounded to whole meters');
assert(edge.normalizeRouteMetrics({ routes: [] }) === null, 'empty routes array yields no metrics');
assert(edge.normalizeRouteMetrics({}) === null, 'response without routes yields no metrics');
assert(edge.normalizeRouteMetrics(null) === null, 'null response yields no metrics');
assert(edge.normalizeRouteMetrics({ routes: [{ distanceMeters: -1, duration: '10s' }] }) === null, 'negative distance yields no metrics');
assert(edge.normalizeRouteMetrics({ routes: [{ distanceMeters: 100 }] }) === null, 'missing duration yields no metrics');
assert(edge.normalizeRouteMetrics({ routes: [{ distanceMeters: '100', duration: '10s' }] }) === null, 'non-numeric distance yields no metrics');
const normalized = edge.normalizeRouteMetrics({ routes: [{ distanceMeters: 5, duration: '9s', polyline: { encodedPolyline: 'secret' }, legs: [{ startLocation: { latLng: { latitude: 50 } } }] }] });
assert(JSON.stringify(normalized) === JSON.stringify({ distanceMeters: 5, durationSeconds: 9 }), 'normalization drops geometry, addresses and any extra Google fields');

// ── 5. Sanitizace chyb ──────────────────────────────────────────────────────
const errorCases = [
  [400, 400, 'invalid_request'],
  [404, 404, 'no_route'],
  [429, 429, 'rate_limited'],
  [401, 502, 'upstream_unavailable'],
  [403, 502, 'upstream_unavailable'],
  [500, 502, 'upstream_unavailable'],
  [503, 502, 'upstream_unavailable'],
];
for (const [googleStatus, expectedStatus, expectedCode] of errorCases) {
  const safe = edge.sanitizeRouteError(googleStatus);
  assert(safe.status === expectedStatus && safe.code === expectedCode, `Google status ${googleStatus} maps to ${expectedCode}`);
  assert(typeof safe.message === 'string' && safe.message.length > 0, `safe message exists for ${expectedCode}`);
  assert(!/google|api key|http/i.test(safe.message), `safe message for ${expectedCode} leaks no provider internals`);
}

// ── 6. Klientský kontrakt ───────────────────────────────────────────────────
const okResponse = client.parseRouteMetricsResponse({ route: { distanceMeters: 1500, durationSeconds: 120 } });
assert(okResponse.ok === true && okResponse.metrics.distanceMeters === 1500 && okResponse.metrics.durationSeconds === 120, 'client parses a valid route payload');
assert(client.parseRouteMetricsResponse({ route: { distanceMeters: '1500', durationSeconds: 120 } }).ok === false, 'client rejects non-numeric distance');
assert(client.parseRouteMetricsResponse({ route: { distanceMeters: 1500 } }).ok === false, 'client rejects payload without duration');
assert(client.parseRouteMetricsResponse({ error: { code: 'no_route' } }).code === 'no_route', 'client surfaces the no_route code');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited' } }).code === 'rate_limited', 'client surfaces the rate_limited code');
assert(client.parseRouteMetricsResponse({ error: { code: 'DROP TABLE' } }).code === 'unknown', 'client never trusts an unknown error code');
assert(client.parseRouteMetricsResponse(null).ok === false, 'client handles an empty payload');
assert(client.ROUTE_METRICS_FUNCTION === 'google-routes', 'client calls the protected google-routes function');

const descriptions = ['invalid_request', 'no_route', 'rate_limited', 'upstream_unavailable', 'unknown']
  .map((code) => client.describeRouteMetricsError(code));
assert(descriptions.every((text) => typeof text === 'string' && text.length > 10), 'every error code has a user-facing description');
assert(descriptions.every((text) => !/google|api|status|http/i.test(text)), 'user-facing texts never mention the provider or transport details');
const protocolDescriptions = ['invalid_request', 'no_route', 'rate_limited', 'upstream_unavailable'].map((code) => client.describeRouteMetricsError(code));
assert(new Set(protocolDescriptions).size === 4, 'the four protocol error codes have distinct user-facing descriptions');
assert(client.describeRouteMetricsError('unknown') === client.describeRouteMetricsError('upstream_unavailable'), 'unknown codes fall back to the generic description');

// ── 7. Edge Function: klíč, logy, timeout (zdrojová kontrola) ───────────────
const edgeEntry = read('supabase/functions/google-routes/index.ts');
const config = read('supabase/config.toml');
const clientSource = read('lib/routeMetrics.ts');
const placesSource = read('supabase/functions/google-places/index.ts');

assert(edgeEntry.includes('Deno.env.get("GOOGLE_MAPS_SERVER_API_KEY")'), 'routes function reads the Google key from a server secret');
assert(!/AIza[0-9A-Za-z_-]{10,}/.test(edgeEntry + clientSource), 'no hardcoded Google API key anywhere');
assert(!clientSource.includes('GOOGLE_MAPS_SERVER_API_KEY'), 'mobile code never references the server key');
assert(!clientSource.includes('googleapis.com'), 'mobile code never calls Google directly');
assert(edgeEntry.includes('X-Goog-Api-Key') && edgeEntry.includes('"X-Goog-FieldMask": ROUTES_FIELD_MASK'), 'routes function sends the key and field mask as headers');
assert(edgeEntry.includes('AbortSignal.timeout(ROUTES_TIMEOUT_MS)'), 'routes call has an explicit timeout');
assert(edgeEntry.includes('request.method !== "POST"'), 'routes function only accepts POST');
assert(!/console\.(log|error)\([^)]*(apiKey|placeId|body|address)/i.test(edgeEntry), 'routes function never logs the key, place IDs, bodies or addresses');
assert(edgeEntry.includes('sanitizeRouteError') && edgeEntry.includes('normalizeRouteMetrics'), 'routes function uses the tested pure logic');
assert(config.includes('[functions.google-routes]'), 'google-routes is registered in supabase/config.toml');
assert(/\[functions\.google-routes\][\s\S]*?verify_jwt = true/.test(config), 'google-routes requires an authenticated JWT');
assert(placesSource.includes('places:autocomplete') && placesSource.includes('GOOGLE_MAPS_SERVER_API_KEY'), 'existing google-places function is unchanged');
assert(!edgeEntry.includes('apiKey}') && !edgeEntry.includes('placeId}'), 'routes function never interpolates secrets into logs');

// ── 8. Migrace 0015: soukromé sloupce, žádná DML, žádné RLS změny ───────────
const migration = read('supabase/migrations/0015_verified_route_metrics.sql');
// Kontroly dopadù se dìvají jen na skuteèné SQL – komentáøe migraci jen dokumentují.
const migrationSql = migration.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const privateColumns = ['origin_place_id', 'destination_place_id', 'route_distance_meters', 'route_duration_seconds'];
for (const column of privateColumns) {
  assert(migration.includes(`add column if not exists ${column}`), `migration 0015 adds ${column}`);
}
assert((migration.match(/add column if not exists/g) || []).length === 8, 'migration 0015 adds all four columns to both tables');
assert(migration.includes('alter table public.tow_requests') && migration.includes('alter table public.carrier_routes'), 'migration 0015 covers requests and free capacity');
assert(!/add column if not exists \w+ (text|integer)\s+not null/i.test(migrationSql), 'all new columns stay nullable for backward compatibility (NOT NULL appears only inside CHECK expressions)');
assert(!/\b(truncate|delete|drop|update|insert)\b/i.test(migrationSql), 'migration 0015 contains no TRUNCATE/DELETE/DROP/UPDATE/INSERT');
assert(!/\bcreate (or replace )?function\b/i.test(migrationSql), 'migration 0015 creates no RPC');
assert(!/\b(policy|enable row level security|grant|revoke|alter default privileges)\b/i.test(migrationSql), 'migration 0015 changes no RLS or grants');
assert(!migrationSql.includes('get_public_marketplace'), 'migration 0015 does not touch public marketplace RPCs');
assert(!migrationSql.includes('polyline'), 'migration 0015 stores no route geometry (documented as intentionally skipped)');
assert(!migrationSql.includes('security definer'), 'migration 0015 adds no SECURITY DEFINER surface');

// ── 9. Veřejná expozice: nové soukromé sloupce nikdy neodejdou na trh ──────
const publicMarketSource = read('lib/publicMarket.ts');
for (const column of privateColumns) {
  assert(publicMarketSource.includes(`"${column}"`), `publicMarket forbids ${column}`);
}
const publicMarket = loadTsModule('lib/publicMarket.ts');
for (const column of privateColumns) {
  let leaked = false;
  try {
    publicMarket.mapPublicMarketplaceRequest({
      public_id: 'x',
      created_at: '',
      origin_label: 'Praha',
      destination_label: 'Brno',
      [column]: 'private-value',
    });
  } catch (_) { leaked = true; }
  assert(leaked, `public marketplace mapping rejects a row exposing ${column}`);
}

const publicRpc = read('supabase/migrations/0014_public_marketplace_feeds.sql');
for (const column of privateColumns) {
  assert(!publicRpc.includes(column), `public marketplace RPC never selects ${column}`);
}
assert(!/select\s+\*/i.test(publicRpc), 'public marketplace RPCs use explicit column lists, not SELECT *');
assert(publicRpc.includes('revoke all on function public.get_public_marketplace_requests') && publicRpc.includes('grant execute on function public.get_public_marketplace_requests(integer, integer) to anon, authenticated'), 'public marketplace RPCs keep explicit execute grants');

// ── 10. Klient zatím není zapojen do produkčních formulářů ──────────────────
const wiredFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(entry.name) && /routeMetrics|google-routes/.test(read(rel)) && rel !== 'lib/routeMetrics.ts') wiredFiles.push(rel);
  }
}
walk('screens');
walk('components');
walk('hooks');
walk('contexts');
assert(wiredFiles.length === 0, 'route metrics client is not wired into any screen, component, hook or context yet');
assert(!read('screens/Transport/CreateRequestScreen.tsx').includes('route_distance_meters'), 'request form payload is unchanged (no route metrics yet)');
assert(!read('screens/Transport/RouteFormRoute.tsx').includes('route_distance_meters'), 'capacity form payload is unchanged (no route metrics yet)');

// ── 11. Edge Function handler: HTTP chování (Deno a fetch podstrčené) ───────
// Sekce 11 je asynchronní, proto běží v tomto obalu (CommonJS s require neumí
// top-level await). Synchronní sekce 12 se spouští před ní.
async function runHandlerChecks() {
const okRoutesResponse = () => new Response(
  JSON.stringify({ routes: [{ distanceMeters: 15000, duration: '900s' }] }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);
const validBody = JSON.stringify({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb' });

// 11a. Platný požadavek
{
  let calledUrl = null;
  let calledInit = null;
  const { handler, logs } = loadEdgeEntry({
    fetchImpl: async (url, init) => { calledUrl = url; calledInit = init; return okRoutesResponse(); },
  });
  assert(typeof handler === 'function', 'google-routes registers a Deno request handler');
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: validBody }));
  assert(response.status === 200, 'a valid request returns HTTP 200');
  const payload = await response.json();
  assert(JSON.stringify(payload) === JSON.stringify({ route: { distanceMeters: 15000, durationSeconds: 900 } }), 'a valid request returns only normalized metrics');
  assert(!JSON.stringify(payload).includes('ChIJ'), 'response carries no place IDs');
  assert(calledUrl === edge.ROUTES_COMPUTE_URL, 'handler calls the fixed Google endpoint (client cannot choose it)');
  assert(calledInit.headers['X-Goog-Api-Key'] === 'unit-test-placeholder', 'handler sends the server-side key');
  assert(calledInit.headers['X-Goog-FieldMask'] === edge.ROUTES_FIELD_MASK, 'handler sends the fixed field mask');
  assert(!JSON.stringify(logs).includes('unit-test-placeholder'), 'logs never contain the server key');
  assert(!JSON.stringify(logs).includes('ChIJ'), 'logs never contain place IDs');
}

// 11b. Neplatné JSON tělo → 400 invalid_request (nikdy 502 upstream_unavailable)
{
  const clientInput = '{ "originPlaceId": "ChIJ-leak-me", "destinationPlaceId": ';
  let fetchCalled = false;
  const { handler, logs } = loadEdgeEntry({
    fetchImpl: async () => { fetchCalled = true; return okRoutesResponse(); },
  });
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: clientInput }));
  assert(response.status === 400, 'malformed JSON returns HTTP 400');
  const payload = await response.json();
  assert(payload.error && payload.error.code === 'invalid_request', 'malformed JSON maps to invalid_request');
  assert(response.status !== 502 && payload.error.code !== 'upstream_unavailable', 'malformed JSON is never mapped to 502 upstream_unavailable');
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes('ChIJ-leak-me') && !serialized.includes('originPlaceId'), 'malformed JSON response echoes no client input');
  assert(!JSON.stringify(logs).includes('ChIJ-leak-me') && !JSON.stringify(logs).includes('originPlaceId'), 'malformed JSON logs contain no client input');
  assert(fetchCalled === false, 'malformed JSON never reaches Google');
}

// 11c. Neplatný obsah (validní JSON, neplatná place ID) → 400
{
  const { handler } = loadEdgeEntry({ fetchImpl: async () => okRoutesResponse() });
  const response = await handler(new Request('https://example.test/google-routes', {
    method: 'POST',
    body: JSON.stringify({ originPlaceId: 'has space', destinationPlaceId: 'ChIJb' }),
  }));
  assert(response.status === 400, 'invalid place IDs in a valid JSON body return HTTP 400');
  const payload = await response.json();
  assert(payload.error.code === 'invalid_request', 'invalid place IDs map to invalid_request');
}

// 11d. OPTIONS a ostatní metody → 405 (shodné s google-places)
for (const method of ['OPTIONS', 'GET', 'PUT', 'DELETE']) {
  const { handler } = loadEdgeEntry({ fetchImpl: async () => okRoutesResponse() });
  const response = await handler(new Request('https://example.test/google-routes', { method }));
  assert(response.status === 405, `${method} is rejected with HTTP 405 (same pattern as google-places)`);
}
assert(!/['"]OPTIONS['"]/.test(placesSource), 'google-places handles no OPTIONS branch (parity reference)');
assert(!/['"]OPTIONS['"]/.test(edgeEntry), 'google-routes adds no OPTIONS branch without a matching pattern in google-places');
assert(placesSource.includes('if (request.method !== "POST")') && edgeEntry.includes('if (request.method !== "POST")'), 'both functions accept POST only');

// 11e. Chyby Google: 502 / 404 no_route / timeout, bez úniku těla odpovědi
{
  const { handler, logs } = loadEdgeEntry({
    fetchImpl: async () => new Response('{"error":{"message":"secret upstream detail"}}', { status: 500 }),
  });
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: validBody }));
  assert(response.status === 502, 'Google 5xx maps to HTTP 502');
  const payload = await response.json();
  assert(payload.error.code === 'upstream_unavailable', 'Google 5xx maps to upstream_unavailable');
  assert(!JSON.stringify(payload).includes('secret upstream detail'), 'upstream error body is never forwarded to the client');
  assert(!JSON.stringify(logs).includes('secret upstream detail'), 'upstream error body is never logged');
}
{
  const { handler } = loadEdgeEntry({
    fetchImpl: async () => new Response(JSON.stringify({ routes: [] }), { status: 200 }),
  });
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: validBody }));
  assert(response.status === 404, 'a response without routes maps to HTTP 404');
  assert((await response.json()).error.code === 'no_route', 'a response without routes maps to no_route');
}
{
  const { handler, logs } = loadEdgeEntry({
    fetchImpl: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; },
  });
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: validBody }));
  assert(response.status === 502, 'a timed-out Google call maps to HTTP 502');
  assert((await response.json()).error.code === 'upstream_unavailable', 'a timed-out Google call maps to upstream_unavailable');
  assert(!JSON.stringify(logs).includes('ChIJ'), 'timeout logs contain no place IDs');
}
{
  const { handler } = loadEdgeEntry({
    fetchImpl: async () => new Response('{"error":"quota"}', { status: 429 }),
  });
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: validBody }));
  assert(response.status === 429 && (await response.json()).error.code === 'rate_limited', 'Google 429 maps to rate_limited');
}

}

// ── 12. Migrace 0015: čtveřice metrik je buď celá NULL, nebo celá vyplněná ──
function migrationAllOrNonePredicate(constraintName) {
  const match = new RegExp(`add constraint ${constraintName}\\s+check\\s*\\(([\\s\\S]*?)\\)\\s*;`).exec(migration);
  if (!match) return null;
  const js = match[1]
    .replace(/\bis not null\b/gi, '!== null')
    .replace(/\bis null\b/gi, '=== null')
    .replace(/\band\b/gi, '&&')
    .replace(/\bor\b/gi, '||');
  return new Function('row', `with (row) { return (${js}); }`);
}

const metricRows = [
  ['all four NULL (legacy rows stay valid)', { origin_place_id: null, destination_place_id: null, route_distance_meters: null, route_duration_seconds: null }, true],
  ['all four filled', { origin_place_id: 'ChIJa', destination_place_id: 'ChIJb', route_distance_meters: 15000, route_duration_seconds: 900 }, true],
  ['zero values are NOT NULL and therefore valid', { origin_place_id: 'ChIJa', destination_place_id: 'ChIJb', route_distance_meters: 0, route_duration_seconds: 0 }, true],
  ['only origin filled', { origin_place_id: 'ChIJa', destination_place_id: null, route_distance_meters: null, route_duration_seconds: null }, false],
  ['only the two place IDs filled', { origin_place_id: 'ChIJa', destination_place_id: 'ChIJb', route_distance_meters: null, route_duration_seconds: null }, false],
  ['missing duration only', { origin_place_id: 'ChIJa', destination_place_id: 'ChIJb', route_distance_meters: 15000, route_duration_seconds: null }, false],
  ['only duration filled', { origin_place_id: null, destination_place_id: null, route_distance_meters: null, route_duration_seconds: 900 }, false],
];

for (const [table, constraint, guard] of [
  ['tow_requests', 'tow_requests_route_metrics_all_or_none', "conrelid = 'public.tow_requests'::regclass"],
  ['carrier_routes', 'carrier_routes_route_metrics_all_or_none', "conrelid = 'public.carrier_routes'::regclass"],
]) {
  assert(migration.includes(`conname = '${constraint}'`) && migration.includes(guard), `migration 0015 guards the named CHECK ${constraint} through pg_constraint`);
  assert(migration.includes(`add constraint ${constraint}`), `migration 0015 adds the named table-level CHECK on ${table}`);
  const predicate = migrationAllOrNonePredicate(constraint);
  assert(typeof predicate === 'function', `migration 0015 CHECK for ${table} can be evaluated`);
  for (const [label, row, expected] of metricRows) {
    assert(predicate({ ...row }) === expected, `${table} all-or-none CHECK: ${label} is ${expected ? 'valid' : 'invalid'}`);
  }
}
assert(migration.includes('-- Pojmenovaná table-level kontrola'), 'migration 0015 documents the all-or-none rule');
assert((migration.match(/\$\$/g) || []).length === 2, 'migration 0015 keeps dollar quoting balanced (single DO block)');
assert((migration.match(/\bbegin;/gi) || []).length === 1 && (migration.match(/\bcommit;/gi) || []).length === 1, 'migration 0015 keeps exactly one transaction (begin/commit)');
assert((migration.match(/\bdo \$\$/g) || []).length === 1, 'migration 0015 uses a single guarded DO block for the named constraints');

runHandlerChecks()
  .then(() => {
    console.log('\nALL ROUTE METRICS (GOOGLE ROUTES) REGRESSION TESTS PASSED');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
