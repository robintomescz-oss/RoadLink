const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(file, stubs = {}) {
  const filename = path.join(root, file);
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const box = { exports: {} };
  const localRequire = (request) => {
    if (stubs[request]) return stubs[request];
    throw new Error(`Unexpected import ${request}`);
  };
  Function("require", "module", "exports", output)(localRequire, box, box.exports);
  return box.exports;
}

const migration = read("supabase/migrations/0017_matching_candidate_preselection.sql");
const viaMigration = read("supabase/migrations/20261005120000_matching_includes_via_routes.sql");
const coordinatesMigration = read("supabase/migrations/20261005130000_matching_via_coordinates.sql");
const index = read("supabase/functions/google-route-matches/index.ts");
const config = read("supabase/config.toml");
const requestLogic = loadTs("supabase/functions/google-route-matches/matchingRequest.ts", {
  "../google-routes/routeRequest.ts": {
    normalizePlaceId: (value) => typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null,
    parseDurationSeconds: (value) => typeof value === "string" && /^\d+s$/.test(value) ? Number(value.slice(0, -1)) : null,
  },
});

assert(/create or replace function public\.get_route_matching_candidates_internal/i.test(migration));
assert(/security definer/i.test(migration));
assert(/set search_path = ''/i.test(migration));
assert(/cr\.driver_id = p_driver_id/i.test(migration), "route ownership is checked");
assert(/tr\.status = 'open'/i.test(migration) && /cr\.status = 'open'/i.test(migration));
assert(/cr\.available_spaces > 0/i.test(migration));
assert(/departure_at::date between tr\.requested_date and coalesce\(tr\.date_to/i.test(migration));
assert(/tr\.vehicle_type = any\(cr\.vehicle_types\)/i.test(migration));
assert(/limit least\(greatest\(coalesce\(p_limit, 5\), 1\), 5\)/i.test(migration));
assert(/revoke all[\s\S]*from anon/i.test(migration));
assert(/revoke all[\s\S]*from authenticated/i.test(migration));
assert(/grant execute[\s\S]*to service_role/i.test(migration));
assert(!/grant execute[\s\S]*to (anon|authenticated)/i.test(migration));
assert(!/\b(delete|truncate|drop table|update|insert into)\b/i.test(migration), "draft migration mutates no business data");
assert(/route_via_place_ids text\[\]/i.test(viaMigration), "matching v2 returns the carrier via points");
assert(/cr\.via_place_ids/i.test(viaMigration), "matching v2 selects the carrier via points");
assert(!/coalesce\(cardinality\(cr\.via_place_ids\), 0\) = 0/i.test(viaMigration), "matching v2 no longer excludes routes with via points");
assert(/security definer/i.test(viaMigration) && /set search_path = ''/i.test(viaMigration), "via migration keeps the internal RPC hardening");
assert(/revoke all[\s\S]*from anon/i.test(viaMigration) && /revoke all[\s\S]*from authenticated/i.test(viaMigration), "via migration revokes anon and authenticated");
assert(/grant execute[\s\S]*to service_role/i.test(viaMigration) && !/grant execute[\s\S]*to (anon|authenticated)/i.test(viaMigration), "via migration grants execute only to service_role");
assert(!/\b(delete|truncate|drop table|update|insert into)\b/i.test(viaMigration), "via migration mutates no business data");
assert(/via_latitudes double precision\[\]/i.test(coordinatesMigration) && /via_longitudes double precision\[\]/i.test(coordinatesMigration), "coordinate migration adds private via coordinate columns");
assert(/validate_carrier_route_via_places/i.test(coordinatesMigration), "coordinate migration validates the coordinate pair and range");
assert(/route_via_latitudes double precision\[\]/i.test(coordinatesMigration) && /request_pickup_lat double precision/i.test(coordinatesMigration), "matching RPC returns route and request coordinates");
assert(/limit least\(greatest\(coalesce\(p_limit, 5\), 1\), 25\)/i.test(coordinatesMigration), "matching RPC can fetch a wider candidate window");
assert(/security definer/i.test(coordinatesMigration) && /set search_path = ''/i.test(coordinatesMigration), "coordinate migration keeps the internal RPC hardening");
assert(/grant execute[\s\S]*to service_role/i.test(coordinatesMigration) && !/grant execute[\s\S]*to (anon|authenticated)/i.test(coordinatesMigration), "coordinate migration grants execute only to service_role");
assert(!/\b(delete from|truncate table|update public\.|insert into public\.|drop table)\b/i.test(coordinatesMigration), "coordinate migration mutates no business data");

assert(/\[functions\.google-route-matches\][\s\S]*verify_jwt = true/.test(config));
assert(/resolveUserId\(token\)/.test(index));
assert(/SUPABASE_SERVICE_ROLE_KEY/.test(index));
assert(/get_route_matching_candidates_internal/.test(index));
assert(/p_driver_id: identity\.userId/.test(index));
assert(/takeGoogleCall[\s\S]*consumeGoogleRoutesRateLimit\(token\)/.test(index), "every Google call goes through the shared limiter helper");
assert(/for \(const candidate of working\)[\s\S]*takeGoogleCall\(\)[\s\S]*fetch\(MATCHING_COMPUTE_URL/.test(index), "each exact route call consumes its own limiter slot");
assert(/p_limit: MAX_MATCH_CANDIDATES/.test(index), "matching asks the RPC only for preselected candidates");
assert(/buildRouteCoordinateMap\(candidate\)[\s\S]*rankVariantsByCoordinates/.test(index), "variant ranking prefers stored coordinates before the matrix");
assert(!/MAX_CANDIDATE_FETCH|selectGeoPreselectedCandidates/.test(index), "candidate preselection moved into SQL");
assert(/MATCHING_MATRIX_URL/.test(index) && /takeGoogleCall\(\)[\s\S]*fetch\(MATCHING_MATRIX_URL/.test(index), "the matrix screening also consumes a limiter slot");
assert(!/console\.(log|error|warn)\([^\n]*(token|userId|placeId|body)/i.test(index));
assert(/matches\.sort\(\(a, b\) => b\.score - a\.score/.test(index));

assert.deepStrictEqual(requestLogic.validateMatchingRequest({ routeId: "123e4567-e89b-12d3-a456-426614174000" }), { routeId: "123e4567-e89b-12d3-a456-426614174000" });
assert.strictEqual(requestLogic.validateMatchingRequest({ routeId: "not-a-uuid" }), null);
assert.strictEqual(requestLogic.validateMatchingRequest({ routeId: "------------------------------------" }), null);

const candidate = requestLogic.normalizeCandidate({
  route_id: "route-1",
  route_origin_place_id: "route-origin",
  route_destination_place_id: "route-destination",
  route_distance_meters: 200000,
  route_duration_seconds: 7200,
  max_deviation_km: "20",
  request_id: "request-1",
  request_origin_place_id: "request-origin",
  request_destination_place_id: "request-destination",
});
assert(candidate);
assert.strictEqual(candidate.max_deviation_km, 20, "Postgres numeric text is normalized");

// Nevyplněná maximální odchylka se nesmí chovat jako 0 km (odfiltruje vše),
// ale použije výchozí toleranci +/- DEFAULT_MAX_DEVIATION_KM.
const noDeviationCandidate = requestLogic.normalizeCandidate({
  route_id: "route-1",
  route_origin_place_id: "route-origin",
  route_destination_place_id: "route-destination",
  route_distance_meters: 200000,
  route_duration_seconds: 7200,
  max_deviation_km: null,
  request_id: "request-1",
  request_origin_place_id: "request-origin",
  request_destination_place_id: "request-destination",
});
assert(noDeviationCandidate);
assert.strictEqual(
  requestLogic.resolveMaxDeviationKm(noDeviationCandidate),
  requestLogic.DEFAULT_MAX_DEVIATION_KM,
  "a missing max_deviation_km falls back to the default tolerance",
);
assert.strictEqual(
  requestLogic.resolveMaxDeviationKm(candidate),
  20,
  "an explicit max_deviation_km overrides the default",
);
assert.strictEqual(requestLogic.DEFAULT_MAX_DEVIATION_KM, 20, "default tolerance is 20 km");
// Práh musí tolerovat odchylku i tehdy, když trasa nemá kam se "vrátit" (0 m základ).
assert.strictEqual(
  requestLogic.isWithinDeviation({ detourDistanceMeters: 19999 }, candidate),
  true,
  "19 999 m under the explicit 20 km limit is a match",
);
assert.strictEqual(
  requestLogic.isWithinDeviation({ detourDistanceMeters: 20001 }, candidate),
  false,
  "20 001 m over the explicit 20 km limit is not a match",
);
assert.strictEqual(
  requestLogic.isWithinDeviation({ detourDistanceMeters: 19999 }, noDeviationCandidate),
  true,
  "default tolerance accepts a detour below 20 km",
);
assert.strictEqual(
  requestLogic.isWithinDeviation({ detourDistanceMeters: 25000 }, noDeviationCandidate),
  false,
  "default tolerance still rejects a detour above 20 km",
);
assert.deepStrictEqual(requestLogic.buildMatchingRouteBody(candidate).intermediates, [
  { placeId: "request-origin" },
  { placeId: "request-destination" },
]);
const metrics = requestLogic.normalizeMatchingMetrics({ routes: [{ distanceMeters: 218000, duration: "8700s" }] }, candidate);
assert.strictEqual(metrics.detourDistanceMeters, 18000);
assert.strictEqual(metrics.detourDurationSeconds, 1500);
assert(metrics.score > 0);
assert(metrics.reasons.some((reason) => reason.includes("+18 km")));
assert(!Object.keys(metrics).some((key) => /place|address|lat|lng/i.test(key)));

const routeMatchesClient = loadTs("lib/routeMatches.ts", {
  "./supabase": { supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } },
});
const parsedMatch = routeMatchesClient.parseRouteMatch(metrics);
assert(parsedMatch, "mobile accepts the safe matching response");
assert.strictEqual(routeMatchesClient.routeMatchSummary(parsedMatch), "Skóre 72 · +18 km / 25 min");
assert.strictEqual(routeMatchesClient.parseRouteMatch({ ...metrics, reasons: ["x".repeat(101)] }), null, "oversized server reason is rejected");
assert.strictEqual(routeMatchesClient.parseRouteMatch({ ...metrics, requestId: null }), null, "missing request id is rejected");

const routeDetail = read("screens/Transport/RouteDetailRoute.tsx");
assert(/activeRoute\.driverId === userId[\s\S]*DOPORUČENÉ SHODY/.test(routeDetail), "matching UI is shown only in the owner branch");
assert(/fetchRouteMatches\(activeRouteId\)/.test(routeDetail));
assert(/Nabídka se nikdy neodešle automaticky/.test(routeDetail));
assert(!/Automatické shody zatím fungují jen pro přímé trasy bez průjezdních bodů/.test(routeDetail), "via routes are no longer excluded in the matching UI");
assert(/včetně průjezdních bodů/.test(routeDetail), "owner sees that matching uses the full planned route");
assert(/loadAuthorizedJobDetail\(match\.requestId\)/.test(routeDetail));
assert(!/submitInterest\(match\.requestId\)/.test(routeDetail), "opening a match performs no mutation");

console.log("ALL MATCHING SERVER DRAFT CHECKS PASSED");
