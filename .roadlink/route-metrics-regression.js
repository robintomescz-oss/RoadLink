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

/** Testovací placeholdery pro prostředí — žádná z hodnot není skutečný klíč. */
const STUB_GOOGLE_MAPS = 'unit-test-placeholder';
const STUB_SUPABASE_URL = 'https://unit-test.supabase.co';
const STUB_SUPABASE_ROLE = 'unit-test-role-placeholder';
const DENO_ENV = {
  GOOGLE_MAPS_SERVER_API_KEY: STUB_GOOGLE_MAPS,
  SUPABASE_URL: STUB_SUPABASE_URL,
  SUPABASE_ANON_KEY: STUB_SUPABASE_ROLE,
};

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';
const TEST_BEARER_VALUE = 'unit-test-bearer-value';
const AUTHORIZATION = `Bearer ${TEST_BEARER_VALUE}`;

const okRoutesResponse = () => new Response(
  JSON.stringify({ routes: [{ distanceMeters: 15000, duration: '900s' }] }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

/** Požadavek s platnou autentizací; přes `headers` jde ověřit i 401. */
function postRequest(body, headers = {}) {
  return new Request('https://example.test/google-routes', {
    method: 'POST',
    headers: { authorization: AUTHORIZATION, ...headers },
    body,
  });
}

/**
 * Načte Edge Function `google-routes` s podstrčeným Deno, fetch a console.
 * Moduly requestAuth/rateLimit/userIdentity se načítají skutečné — podstrčený
 * je jen Supabase klient, takže se testuje opravdová logika, ne její kopie.
 */
function loadEdgeEntry({ fetchImpl = async () => okRoutesResponse(), getUser, rpc, envOverrides } = {}) {
  const logs = [];
  const calls = { identity: [], rateLimit: [], fetch: [] };

  const deno = {
    serve: (handler) => { deno.handler = handler; },
    env: {
      get: (name) => (envOverrides && Object.prototype.hasOwnProperty.call(envOverrides, name)
        ? envOverrides[name]
        : DENO_ENV[name]),
    },
  };
  const capturingConsole = {
    log: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const supabaseStub = {
    createClient: () => ({
      auth: {
        getUser: async (token) => (getUser
          ? getUser(token)
          : { data: { user: { id: TEST_USER_ID } }, error: null }),
      },
      rpc: async (name) => (rpc
        ? rpc(name)
        : { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }),
    }),
  };
  const sharedStubs = {
    'npm:@supabase/supabase-js@2': supabaseStub,
    Deno: deno,
    console: capturingConsole,
  };

  const routeRequestModule = loadTsModule('supabase/functions/google-routes/routeRequest.ts');
  const requestAuthModule = loadTsModule('supabase/functions/google-routes/requestAuth.ts');
  const rateLimitModule = loadTsModule('supabase/functions/google-routes/rateLimit.ts', sharedStubs);
  const userIdentityModule = loadTsModule('supabase/functions/google-routes/userIdentity.ts', sharedStubs);

  const rateLimitProxy = {
    ...rateLimitModule,
    consumeGoogleRoutesRateLimit: async (token) => {
      calls.rateLimit.push(token);
      return rateLimitModule.consumeGoogleRoutesRateLimit(token);
    },
  };
  const userIdentityProxy = {
    ...userIdentityModule,
    resolveUserId: async (token) => {
      calls.identity.push(token);
      return userIdentityModule.resolveUserId(token);
    },
  };

  const fetchSpy = async (url, init) => {
    calls.fetch.push({ url, init });
    return fetchImpl(url, init);
  };

  loadTsModule('supabase/functions/google-routes/index.ts', {
    './routeRequest.ts': routeRequestModule,
    './routeRequest': routeRequestModule,
    './requestAuth.ts': requestAuthModule,
    './requestAuth': requestAuthModule,
    './rateLimit.ts': rateLimitProxy,
    './rateLimit': rateLimitProxy,
    './userIdentity.ts': userIdentityProxy,
    './userIdentity': userIdentityProxy,
    Deno: deno,
    fetch: fetchSpy,
    console: capturingConsole,
  });

  return { handler: deno.handler, logs, calls, rateLimitModule, userIdentityModule, requestAuthModule };
}

const edge = loadTsModule('supabase/functions/google-routes/routeRequest.ts');
const requestAuth = loadTsModule('supabase/functions/google-routes/requestAuth.ts');
const client = loadTsModule('lib/routeMetrics.ts', {
  './supabase': { supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } },
});

// ── 0. Autentizační pomůcky (čisté) ─────────────────────────────────────────
assert(requestAuth.AUTH_FAILURE.status === 401 && requestAuth.AUTH_FAILURE.code === 'unauthorized', 'the shared auth failure is 401 unauthorized');
assert(requestAuth.parseBearerToken('Bearer abc.def-ghi') === 'abc.def-ghi', 'a bearer token is extracted from the header');
assert(requestAuth.parseBearerToken('bearer abc') === 'abc', 'the bearer scheme is case-insensitive');
assert(requestAuth.parseBearerToken('Bearer    abc') === 'abc', 'extra spaces after the scheme are tolerated');
assert(requestAuth.parseBearerToken('Bearer') === null, 'a header without a token is rejected');
assert(requestAuth.parseBearerToken('Bearer ') === null, 'an empty token is rejected');
assert(requestAuth.parseBearerToken('Bearer abc def') === null, 'a token with whitespace inside is rejected');
assert(requestAuth.parseBearerToken('Token abc') === null, 'a non-bearer scheme is rejected');
assert(requestAuth.parseBearerToken('abc') === null, 'a bare token without a scheme is rejected');
assert(requestAuth.parseBearerToken(undefined) === null, 'a missing header is rejected');
assert(requestAuth.parseBearerToken(null) === null, 'a null header is rejected');
assert(requestAuth.parseBearerToken(`Bearer ${'a'.repeat(4097)}`) === null, 'an over-long token is rejected');
assert(requestAuth.parseBearerToken(`Bearer ${'a'.repeat(4096)}`) === `Bearer ${'a'.repeat(4096)}`.slice(7), 'a token at the length limit is accepted');

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

// ── 2b. Průjezdní body (via) ────────────────────────────────────────────────
const withVia = edge.validateRouteRequest({
  originPlaceId: 'ChIJfrom',
  destinationPlaceId: 'ChIJto',
  viaPlaceIds: ['ChIJplzen', 'ChIJklatovy'],
});
assert(withVia.ok === true, 'a route with via points passes validation');
assert(
  Array.isArray(withVia.value.viaPlaceIds) && withVia.value.viaPlaceIds.length === 2,
  'validated request carries the via place IDs',
);
assert(
  edge.MAX_VIA_PLACES === 3,
  'the via limit is three points',
);

const noVia = edge.validateRouteRequest({ originPlaceId: 'ChIJfrom', destinationPlaceId: 'ChIJto' });
assert(noVia.ok === true, 'a route without via points still passes validation');
assert(!noVia.value.viaPlaceIds || noVia.value.viaPlaceIds.length === 0, 'a route without via points has none');

assert(
  edge.validateRouteRequest({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb', viaPlaceIds: 'not-an-array' }).ok === false,
  'a non-array via value is rejected',
);
assert(
  edge.validateRouteRequest({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb', viaPlaceIds: ['has space'] }).ok === false,
  'a via point that is not a valid place ID is rejected',
);
assert(
  edge.validateRouteRequest({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb', viaPlaceIds: ['ok1', 'ok2', 'ok3', 'ok4'] }).ok === false,
  'more than three via points are rejected',
);
assert(
  edge.validateRouteRequest({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb', viaPlaceIds: ['ChIJa'] }).ok === false,
  'a via point identical to the origin is rejected',
);
assert(
  edge.validateRouteRequest({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb', viaPlaceIds: ['ChIJb'] }).ok === false,
  'a via point identical to the destination is rejected',
);
assert(
  edge.validateRouteRequest({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb', viaPlaceIds: ['dup', 'dup'] }).ok === false,
  'a duplicated via point is rejected',
);

// ── 3. Pevné tělo volání Google ─────────────────────────────────────────────
const body = edge.buildComputeRoutesBody({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb' });
assert(body.origin.placeId === 'ChIJa' && body.destination.placeId === 'ChIJb', 'compute routes body uses the two place IDs');
assert(body.travelMode === 'DRIVE' && body.routingPreference === 'TRAFFIC_UNAWARE' && body.units === 'METRIC', 'compute routes body is fixed by the server');
assert(!JSON.stringify(body).includes('http'), 'client cannot influence the Google URL through the body');
assert(!('intermediates' in body), 'a direct route sends no intermediates at all');

const bodyWithVia = edge.buildComputeRoutesBody({
  originPlaceId: 'ChIJfrom',
  destinationPlaceId: 'ChIJto',
  viaPlaceIds: ['ChIJplzen'],
});
assert(
  Array.isArray(bodyWithVia.intermediates) && bodyWithVia.intermediates.length === 1
    && bodyWithVia.intermediates[0].placeId === 'ChIJplzen',
  'via points are sent as Google intermediates',
);
assert(
  bodyWithVia.optimizeWaypointOrder === false,
  'waypoint order is never optimized, so the driver keeps the chosen order',
);
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

const KNOWN_ERROR_CODES = ['invalid_request', 'unauthorized', 'auth_unavailable', 'no_route', 'rate_limited', 'rate_limit_unavailable', 'upstream_unavailable'];
const descriptions = [...KNOWN_ERROR_CODES, 'unknown'].map((code) => client.describeRouteMetricsError(code));
assert(descriptions.every((text) => typeof text === 'string' && text.length > 10), 'every error code has a user-facing description');
assert(descriptions.every((text) => !/google|api|status|http|jwt|bearer/i.test(text)), 'user-facing texts never mention the provider, transport or token details');
const protocolDescriptions = KNOWN_ERROR_CODES.map((code) => client.describeRouteMetricsError(code));
assert(new Set(protocolDescriptions).size === KNOWN_ERROR_CODES.length, 'the seven protocol error codes have distinct user-facing descriptions');
const authUnavailableText = client.describeRouteMetricsError('auth_unavailable');
assert(authUnavailableText === 'Ověření přihlášení je dočasně nedostupné. Zkuste to prosím znovu.', 'the auth_unavailable text explains the outage in Czech');
assert(!/odhlaste|přihlaste se|znovu se přihlaste/i.test(authUnavailableText), 'the auth_unavailable text never pushes the user to sign in again');
assert(client.describeRouteMetricsError('unknown') === client.describeRouteMetricsError('upstream_unavailable'), 'unknown codes fall back to the generic description');

assert(client.parseRouteMetricsResponse({ error: { code: 'unauthorized' } }).code === 'unauthorized', 'client surfaces the unauthorized code');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limit_unavailable' } }).code === 'rate_limit_unavailable', 'client surfaces the rate_limit_unavailable code');
assert(client.parseRouteMetricsResponse({ error: { code: 'auth_unavailable' } }).code === 'auth_unavailable', 'client surfaces the auth_unavailable code');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited', retryAfterSeconds: 30 } }).retryAfterSeconds === 30, 'client surfaces a sane retry delay');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited', retryAfterSeconds: '30' } }).retryAfterSeconds === 30, 'client accepts a numeric string retry delay');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited', retryAfterSeconds: -5 } }).retryAfterSeconds === undefined, 'client drops a negative retry delay');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited', retryAfterSeconds: 'abc' } }).retryAfterSeconds === undefined, 'client drops an unparsable retry delay');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited', retryAfterSeconds: 10 ** 9 } }).retryAfterSeconds === 86400, 'client clamps an absurd retry delay');
assert(client.parseRouteMetricsResponse({ error: { code: 'rate_limited' } }).retryAfterSeconds === undefined, 'client omits the retry delay when the server sends none');

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
const orderedChecks = [
  ['readJsonBody(request)', 'method and JSON body'],
  ['parseBearerToken(', 'authorization header'],
  ['resolveUserId(', 'server-side user verification'],
  ['validateRouteRequest(', 'place ID validation'],
  ['consumeGoogleRoutesRateLimit(', 'atomic rate limit'],
  ['await computeRoutes(', 'Google Routes call'],
];
let previousIndex = -1;
let orderOk = true;
for (const [needle] of orderedChecks) {
  const index = edgeEntry.indexOf(needle);
  if (index <= previousIndex) orderOk = false;
  previousIndex = index;
}
assert(orderOk, `edge function runs the checks in the required order (${orderedChecks.map(([, label]) => label).join(' -> ')})`);
assert(edgeEntry.includes('from "./requestAuth.ts"') && edgeEntry.includes('from "./userIdentity.ts"') && edgeEntry.includes('from "./rateLimit.ts"'), 'edge function wires the auth and rate limit modules');
assert(edgeEntry.includes('if (!identity.ok)') && edgeEntry.includes('if (!accessToken)'), 'edge function rejects callers without a verified identity');
assert(edgeEntry.includes('if (!decision.ok)') && edgeEntry.includes('if (!decision.allowed)'), 'edge function distinguishes a failing limiter from an exhausted limit');
assert(edgeEntry.includes('source: "roadlink_rate_limit"') && edgeEntry.includes('source: "google_upstream"'), 'local and upstream rate limits are logged with distinct sources');
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
    else if (/\.(ts|tsx)$/.test(entry.name) && /routeMetrics|google-routes/.test(read(rel)) && rel !== 'lib/routeMetrics.ts') wiredFiles.push(rel);
  }
}
walk('screens');
walk('components');
walk('hooks');
walk('contexts');
assert(wiredFiles.length >= 2, `route metrics client is wired into at least two files: ${wiredFiles.join(', ')}`);
assert(wiredFiles.some(f => f.endsWith('screens/Transport/CreateRequestScreen.tsx')), 'request form wiring missing');
assert(wiredFiles.some(f => f.endsWith('screens/Transport/RouteFormRoute.tsx')), 'capacity form wiring missing');

// ── 11. Edge Function handler: HTTP chování (Deno a fetch podstrčené) ───────
// Sekce 11 je asynchronní, proto běží v tomto obalu (CommonJS s require neumí
// top-level await). Synchronní sekce 12 se spouští před ní.
async function runHandlerChecks() {
const validBody = JSON.stringify({ originPlaceId: 'ChIJa', destinationPlaceId: 'ChIJb' });

// 11a. Platný požadavek
{
  let calledUrl = null;
  let calledInit = null;
  const { handler, logs } = loadEdgeEntry({
    fetchImpl: async (url, init) => { calledUrl = url; calledInit = init; return okRoutesResponse(); },
  });
  assert(typeof handler === 'function', 'google-routes registers a Deno request handler');
  const response = await handler(postRequest(validBody));
  assert(response.status === 200, 'a valid request returns HTTP 200');
  const payload = await response.json();
  assert(JSON.stringify(payload) === JSON.stringify({ route: { distanceMeters: 15000, durationSeconds: 900 } }), 'a valid request returns only normalized metrics');
  assert(!JSON.stringify(payload).includes('ChIJ'), 'response carries no place IDs');
  assert(calledUrl === edge.ROUTES_COMPUTE_URL, 'handler calls the fixed Google endpoint (client cannot choose it)');
  assert(calledInit.headers['X-Goog-Api-Key'] === STUB_GOOGLE_MAPS, 'handler sends the server-side key');
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
  const response = await handler(postRequest(clientInput));
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
  const response = await handler(postRequest(JSON.stringify({ originPlaceId: 'has space', destinationPlaceId: 'ChIJb' })));
  assert(response.status === 400, 'invalid place IDs in a valid JSON body return HTTP 400');
  const payload = await response.json();
  assert(payload.error.code === 'invalid_request', 'invalid place IDs map to invalid_request');
}

// 11d. OPTIONS a ostatní metody → 405 (shodné s google-places)
for (const method of ['OPTIONS', 'GET', 'PUT', 'DELETE']) {
  const { handler } = loadEdgeEntry({ fetchImpl: async () => okRoutesResponse() });
  const response = await handler(new Request('https://example.test/google-routes', {
    method,
    headers: { authorization: AUTHORIZATION },
  }));
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
  const response = await handler(postRequest(validBody));
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
  const response = await handler(postRequest(validBody));
  assert(response.status === 404, 'a response without routes maps to HTTP 404');
  assert((await response.json()).error.code === 'no_route', 'a response without routes maps to no_route');
}
{
  const { handler, logs } = loadEdgeEntry({
    fetchImpl: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; },
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 502, 'a timed-out Google call maps to HTTP 502');
  assert((await response.json()).error.code === 'upstream_unavailable', 'a timed-out Google call maps to upstream_unavailable');
  assert(!JSON.stringify(logs).includes('ChIJ'), 'timeout logs contain no place IDs');
}
{
  const { handler } = loadEdgeEntry({
    fetchImpl: async () => new Response('{"error":"quota"}', { status: 429 }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 429 && (await response.json()).error.code === 'rate_limited', 'Google 429 maps to rate_limited');
}

// 11f. Autentizace: Google se nesmí zavolat bez ověřené identity
{
  const { handler, logs, calls } = loadEdgeEntry();
  const response = await handler(new Request('https://example.test/google-routes', { method: 'POST', body: validBody }));
  assert(response.status === 401, 'a request without an Authorization header returns HTTP 401');
  assert((await response.json()).error.code === 'unauthorized', 'a missing token maps to unauthorized');
  assert(calls.fetch.length === 0, 'Google is never called without authorization');
  assert(!JSON.stringify(logs).includes('Bearer'), 'a rejected request never logs the authorization header');
}
{
  const { handler, calls } = loadEdgeEntry();
  const response = await handler(postRequest(validBody, { authorization: 'Basic dW5pdDp0ZXN0' }));
  assert(response.status === 401, 'a non-Bearer authorization scheme returns HTTP 401');
  assert(calls.fetch.length === 0, 'Google is never called for a non-Bearer scheme');
}
{
  const { handler, calls } = loadEdgeEntry();
  const response = await handler(postRequest(validBody, { authorization: 'Bearer    ' }));
  assert(response.status === 401, 'an empty bearer token returns HTTP 401');
  assert(calls.fetch.length === 0, 'Google is never called for an empty bearer token');
}
// Neplatný, expirovaný a zrušený token = problém s přihlášením → 401 unauthorized
{
  const { handler, calls, logs } = loadEdgeEntry({
    getUser: async () => ({ data: { user: null }, error: { status: 401, message: 'invalid JWT: signature is invalid' } }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 401, 'an invalid token returns HTTP 401');
  const payload = await response.json();
  assert(payload.error.code === 'unauthorized', 'an invalid token maps to unauthorized');
  assert(!JSON.stringify(payload).includes('signature is invalid'), 'the Auth error message is never forwarded to the client');
  assert(calls.fetch.length === 0, 'Google is never called for an invalid token');
  assert(calls.rateLimit.length === 0, 'the rate limiter is never consulted for an invalid token');
  const serialized = JSON.stringify(logs);
  assert(!serialized.includes(TEST_BEARER_VALUE), 'an invalid token is never logged');
  assert(!serialized.includes('signature is invalid'), 'the Auth error detail is never logged');
}
{
  const { handler, calls, logs } = loadEdgeEntry({
    getUser: async () => ({ data: { user: null }, error: { status: 401, message: 'JWT expired' } }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 401, 'an expired token returns HTTP 401');
  assert((await response.json()).error.code === 'unauthorized', 'an expired token maps to unauthorized');
  assert(calls.rateLimit.length === 0 && calls.fetch.length === 0, 'an expired token never reaches the limiter or Google');
  assert(!JSON.stringify(logs).includes('JWT expired'), 'an expired token is never logged verbatim');
}
{
  const { handler, calls } = loadEdgeEntry({
    getUser: async () => ({ data: { user: null }, error: { status: 403, message: 'User from sub claim in JWT does not exist' } }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 401, 'a revoked token returns HTTP 401');
  assert((await response.json()).error.code === 'unauthorized', 'a revoked token maps to unauthorized');
  assert(calls.fetch.length === 0 && calls.rateLimit.length === 0, 'a revoked token never reaches the limiter or Google');
}
{
  const { handler, calls } = loadEdgeEntry({ getUser: async () => ({ data: { user: {} }, error: null }) });
  const response = await handler(postRequest(validBody));
  assert(response.status === 401, 'a user object without an id is rejected');
  assert(calls.fetch.length === 0, 'Google is never called for a user without an id');
}

// Výpadek Auth služby = nedostupnost → 503 auth_unavailable
{
  const { handler, calls, logs } = loadEdgeEntry({
    getUser: async () => ({ data: { user: null }, error: { status: 500, message: 'Internal server error' } }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'an Auth 500 returns HTTP 503');
  const payload = await response.json();
  assert(payload.error.code === 'auth_unavailable', 'an Auth 500 maps to auth_unavailable');
  assert(!JSON.stringify(payload).includes('Internal server error'), 'an Auth 500 detail is never forwarded to the client');
  assert(calls.fetch.length === 0 && calls.rateLimit.length === 0, 'an Auth outage never reaches the limiter or Google');
  assert(!JSON.stringify(logs).includes('Internal server error'), 'an Auth 500 detail is never logged');
  assert(JSON.stringify(logs).includes('supabase_auth'), 'an Auth outage is logged with a distinct source');
}
{
  const { handler, calls } = loadEdgeEntry({
    getUser: async () => ({ data: { user: null }, error: { status: 503, message: 'Service Unavailable' } }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'an Auth 503 returns HTTP 503');
  assert((await response.json()).error.code === 'auth_unavailable', 'an Auth 503 maps to auth_unavailable');
  assert(calls.fetch.length === 0, 'Google is never called when Auth is unavailable');
}
{
  const { handler, calls, logs } = loadEdgeEntry({
    getUser: async () => { throw new Error('auth upstream exploded'); },
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'an Auth network exception returns HTTP 503');
  assert((await response.json()).error.code === 'auth_unavailable', 'an Auth network exception maps to auth_unavailable');
  assert(calls.fetch.length === 0 && calls.rateLimit.length === 0, 'an Auth network exception never reaches the limiter or Google');
  const serialized = JSON.stringify(logs);
  assert(!serialized.includes(TEST_BEARER_VALUE), 'an Auth network exception never logs the access token');
  assert(!serialized.includes('auth upstream exploded'), 'an Auth network exception never logs the upstream message');
}
{
  const { handler, calls } = loadEdgeEntry({
    getUser: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; },
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'an Auth timeout returns HTTP 503');
  assert((await response.json()).error.code === 'auth_unavailable', 'an Auth timeout maps to auth_unavailable');
  assert(calls.fetch.length === 0 && calls.rateLimit.length === 0, 'an Auth timeout never reaches the limiter or Google');
}
{
  const { handler, calls } = loadEdgeEntry({
    getUser: async () => ({ data: { user: null }, error: { message: 'invalid claim: missing sub claim' } }),
  });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'an ambiguous Auth error fails closed as HTTP 503');
  assert((await response.json()).error.code === 'auth_unavailable', 'an ambiguous Auth error maps to auth_unavailable');
  assert(calls.fetch.length === 0 && calls.rateLimit.length === 0, 'an ambiguous Auth error never reaches the limiter or Google');
}
{
  const { handler, calls } = loadEdgeEntry({ envOverrides: { SUPABASE_URL: undefined } });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'missing Auth configuration returns HTTP 503, not 401');
  assert((await response.json()).error.code === 'auth_unavailable', 'missing Auth configuration maps to auth_unavailable');
  assert(calls.fetch.length === 0 && calls.rateLimit.length === 0, 'missing Auth configuration never reaches the limiter or Google');
}
{
  const forgedBody = JSON.stringify({
    originPlaceId: 'ChIJa',
    destinationPlaceId: 'ChIJb',
    userId: 'forged-user-id',
    user_id: 'forged-user-id',
    uid: 'forged-user-id',
  });
  const { handler, calls } = loadEdgeEntry();
  const response = await handler(postRequest(forgedBody));
  assert(response.status === 200, 'a forged user id in the body does not block a valid request');
  assert(calls.identity.length === 1 && calls.identity[0] === TEST_BEARER_VALUE, 'identity is resolved from the bearer token only');
  assert(calls.rateLimit.length === 1 && calls.rateLimit[0] === TEST_BEARER_VALUE, 'the rate limiter receives the token, never a body user id');
  assert(!JSON.stringify(calls).includes('forged-user-id'), 'a forged body user id never reaches identity or rate limit');
}

// 11g. Rate limit: pořadí kontrol, fail-closed a rozlišená diagnostika
{
  const { handler, calls } = loadEdgeEntry();
  const response = await handler(postRequest(validBody));
  assert(response.status === 200, 'an allowed request reaches Google');
  assert(calls.rateLimit.length === 1, 'the rate limiter is consulted exactly once per request');
  assert(calls.fetch.length === 1, 'an allowed request calls Google exactly once');
}
{
  const { handler, calls } = loadEdgeEntry();
  const response = await handler(postRequest(JSON.stringify({ originPlaceId: 'bad place', destinationPlaceId: 'ChIJb' })));
  assert(response.status === 400, 'invalid place IDs still return HTTP 400');
  assert(calls.rateLimit.length === 0, 'an invalid request never consumes a rate limit slot');
  assert(calls.fetch.length === 0, 'an invalid request never reaches Google');
}
{
  const { handler, calls } = loadEdgeEntry({ rpc: async () => ({ data: [{ allowed: false, retry_after_seconds: 17 }], error: null }) });
  const response = await handler(postRequest(validBody));
  assert(response.status === 429, 'an exhausted local limit returns HTTP 429');
  const payload = await response.json();
  assert(payload.error.code === 'rate_limited', 'an exhausted local limit maps to rate_limited');
  assert(payload.error.retryAfterSeconds === 17, 'the local limit returns the retry delay computed by the database');
  assert(calls.fetch.length === 0, 'Google is never called when the local limit is exhausted');
}
{
  const { handler } = loadEdgeEntry({ rpc: async () => ({ data: [{ allowed: false, retry_after_seconds: 10 ** 9 }], error: null }) });
  const response = await handler(postRequest(validBody));
  assert((await response.json()).error.retryAfterSeconds === 86400, 'an absurd retry delay from the database is clamped');
}
{
  const { handler } = loadEdgeEntry({ rpc: async () => ({ data: [{ allowed: false, retry_after_seconds: -3 }], error: null }) });
  const response = await handler(postRequest(validBody));
  assert((await response.json()).error.retryAfterSeconds === 60, 'an invalid retry delay falls back to the safe default');
}
{
  const { handler, calls, logs } = loadEdgeEntry({ rpc: async () => ({ error: { message: 'rpc exploded with detail' } }) });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'a failing rate limiter returns HTTP 503');
  assert((await response.json()).error.code === 'rate_limit_unavailable', 'a failing rate limiter maps to rate_limit_unavailable');
  assert(calls.fetch.length === 0, 'Google is never called when the rate limiter fails (fail closed)');
  assert(JSON.stringify(logs).includes('roadlink_rate_limit'), 'a limiter failure is logged with a distinct source');
  assert(!JSON.stringify(logs).includes('rpc exploded with detail'), 'a limiter failure never leaks the database message');
}
{
  const { handler, calls } = loadEdgeEntry({ rpc: async () => ({ data: null, error: null }) });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'an unexpected limiter payload fails closed');
  assert(calls.fetch.length === 0, 'Google is never called on an unexpected limiter payload');
}
{
  const { handler, calls } = loadEdgeEntry({ rpc: async () => { throw new Error('limiter network down'); } });
  const response = await handler(postRequest(validBody));
  assert(response.status === 503, 'a thrown limiter error fails closed');
  assert(calls.fetch.length === 0, 'Google is never called when the limiter throws');
}
{
  const { handler, logs } = loadEdgeEntry({ fetchImpl: async () => new Response('quota exceeded', { status: 429 }) });
  const response = await handler(postRequest(validBody));
  assert(response.status === 429, 'a Google 429 still returns HTTP 429');
  const payload = await response.json();
  assert(payload.error.code === 'rate_limited', 'a Google 429 maps to rate_limited for the client');
  assert(payload.error.retryAfterSeconds === undefined, 'a Google 429 carries no RoadLink retry delay');
  const serialized = JSON.stringify(logs);
  assert(serialized.includes('google_upstream') && !serialized.includes('roadlink_rate_limit'), 'a Google 429 is logged as upstream, not as the local limit');
  assert(!serialized.includes('quota exceeded'), 'the Google error body is never logged');
}
{
  const { handler, logs } = loadEdgeEntry({ rpc: async () => ({ data: [{ allowed: false, retry_after_seconds: 5 }], error: null }) });
  await handler(postRequest(validBody));
  const serialized = JSON.stringify(logs);
  assert(!serialized.includes(TEST_BEARER_VALUE) && !serialized.includes('ChIJ') && !serialized.includes(TEST_USER_ID), 'no log line contains a token, place ID or user id');
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
