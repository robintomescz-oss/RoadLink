const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function requireProductionTsModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

const {
  PUBLIC_MARKETPLACE_FORBIDDEN_FIELDS,
  filterPublicRequests,
  mapPublicMarketplaceRequest,
  mapPublicMarketplaceRoute,
  publicCardAuthTarget,
  publicLabelOrFallback,
  shouldShowPublicMarketEmptyState,
  validatePublicLocationLabel,
} = requireProductionTsModule('lib/publicMarket.ts');

const request = mapPublicMarketplaceRequest({
  public_id: '11111111-1111-4111-8111-111111111111',
  item_type: 'tow_request',
  origin_label: null,
  destination_label: 'Brno',
  vehicle_type: 'Osobní automobil',
  vehicle_mobility: 'drivable',
  requested_date: '2026-10-01',
  date_to: null,
  time_preference: 'specific',
  created_at: '2026-09-21T12:00:00Z',
  status: 'open',
});
assert(request.origin_label === null && publicLabelOrFallback(request.origin_label) === 'Oblast neuvedena', 'RPC request mapping preserves null public labels and uses safe fallback');
assert(filterPublicRequests([request], '', 'brno', 'all').length === 1, 'public request filtering works on sanitized public labels');

const route = mapPublicMarketplaceRoute({
  public_id: '22222222-2222-4222-8222-222222222222',
  item_type: 'carrier_route',
  origin_label: 'Praha',
  destination_label: 'Ostrava',
  vehicle_types: ['Dodávka'],
  departure_at: '2026-10-02T12:00:00Z',
  available_spaces: 2,
  price: 1500,
  created_at: '2026-09-21T12:00:00Z',
  status: 'open',
});
assert(route.vehicle_types[0] === 'Dodávka' && route.price === 1500, 'RPC route mapping keeps only public route card fields');

for (const field of PUBLIC_MARKETPLACE_FORBIDDEN_FIELDS) {
  let blocked = false;
  try { mapPublicMarketplaceRequest({ public_id: 'x', created_at: '', [field]: 'secret' }); }
  catch (_) { blocked = true; }
  assert(blocked, `public payload rejects forbidden field ${field}`);
}

assert(validatePublicLocationLabel(' Praha ').valid === true, 'public label validation accepts trimmed city');
assert(validatePublicLocationLabel('').valid === false, 'public label validation rejects empty string');
assert(validatePublicLocationLabel('a'.repeat(81)).valid === false, 'public label validation rejects labels over 80 chars');
assert(validatePublicLocationLabel('test@example.com').valid === false, 'public label validation rejects email');
assert(validatePublicLocationLabel('https://example.com').valid === false, 'public label validation rejects URL');
assert(validatePublicLocationLabel('+420 777 123 456').valid === false, 'public label validation rejects phone-like strings');

assert(shouldShowPublicMarketEmptyState(false, null, 0) === true, 'empty state only when loaded without error and no items');
assert(shouldShowPublicMarketEmptyState(false, 'permission denied', 0) === false, 'error is not treated as empty state');
assert(publicCardAuthTarget(null) === 'login' && publicCardAuthTarget('user1') === 'authorized-detail', 'public card auth transition is explicit');

const hookSource = read('hooks/useTransportData.ts');
assert(hookSource.includes('publicRequests') && hookSource.includes('publicRoutes') && hookSource.includes('publicMarketLoading') && hookSource.includes('publicMarketError'), 'useTransportData has separate public market state');
const publicLoaderBlock = hookSource.slice(hookSource.indexOf('async function loadPublicMarketplace'), hookSource.indexOf('async function loadAuthorizedJobDetail'));
assert(publicLoaderBlock.includes('supabase.rpc("get_public_marketplace_requests"'), 'public request loader uses sanitized RPC');
assert(publicLoaderBlock.includes('supabase.rpc("get_public_marketplace_routes"'), 'public route loader uses sanitized RPC');
assert(!publicLoaderBlock.includes('setJobs(') && !publicLoaderBlock.includes('setRoutes(') && !publicLoaderBlock.includes('setOffers('), 'public loader does not write private jobs/routes/offers state');

const transportRouteSource = read('screens/Transport/TransportRoute.tsx');
assert(transportRouteSource.includes('publicCardAuthTarget(userId) === "login"'), 'public card opens login before protected detail for anonymous user');
assert(transportRouteSource.includes('loadAuthorizedJobDetail(item.public_id)'), 'logged-in public request opens protected detail by id only');
assert(transportRouteSource.includes('loadAuthorizedRouteDetail(route.public_id)'), 'logged-in public route opens protected detail by id only');

const requestFormSource = read('screens/Transport/CreateRequestScreen.tsx');
assert(requestFormSource.includes('pickup_public_label: validatedPickupPublic.value'), 'request payload contains pickup_public_label');
assert(requestFormSource.includes('destination_public_label: validatedDestinationPublic.value'), 'request payload contains destination_public_label');
assert(requestFormSource.includes('pickup_address: trimmedPickupAddress') && requestFormSource.includes('destination_address: trimmedDestination'), 'request payload preserves private precise addresses');
assert(requestFormSource.includes('Tento údaj bude viditelný veřejně.'), 'request form explains public visibility');

const routeFormSource = read('screens/Transport/RouteFormRoute.tsx');
assert(routeFormSource.includes('from_public_label: validatedFromPublic.value'), 'route payload contains from_public_label');
assert(routeFormSource.includes('to_public_label: validatedToPublic.value'), 'route payload contains to_public_label');
assert(routeFormSource.includes('from_address: fromAddress') && routeFormSource.includes('to_address: toAddress'), 'route payload preserves private precise places');
assert(routeFormSource.includes('Tento údaj bude viditelný veřejně.'), 'route form explains public visibility');

const forwardSql = read('supabase/migrations/0014_public_marketplace_feeds.sql');
assert(!/select\s+\*/i.test(forwardSql), 'forward migration has no SELECT *');
assert(!/drop\s+function\s+if\s+exists/i.test(forwardSql), 'forward migration has no DROP FUNCTION IF EXISTS');
assert(!/grant\s+select\s+on\s+(?:table\s+)?public\.(tow_requests|carrier_routes|tow_offers)/i.test(forwardSql), 'forward migration grants no SELECT on base transport tables');
assert(forwardSql.includes("set search_path = ''"), 'SECURITY DEFINER functions set empty search_path');
assert(forwardSql.includes('char_length(pickup_public_label) <= 80'), 'forward migration constrains public label length');
assert(forwardSql.includes('offset least(greatest(coalesce(p_offset, 0), 0), 10000)'), 'forward migration caps offset');
assert(!/tow_offers/i.test(forwardSql), 'tow_offers stays outside anonymous public feed');

assert(!fs.existsSync(path.join(root, 'supabase/migrations/0014_rollback.sql')), 'rollback is not in supabase/migrations');
const rollbackSql = read('supabase/rollback/0014_public_marketplace_feeds.sql');
assert(rollbackSql.includes('MANUAL ONLY / DESTRUCTIVE ROLLBACK'), 'manual rollback is clearly destructive/manual');
assert(rollbackSql.includes('permanently delete all stored public label data'), 'manual rollback warns about deleting public label data');

console.log('ALL PUBLIC MARKET REGRESSION TESTS PASSED');
