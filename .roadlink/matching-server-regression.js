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

assert(/\[functions\.google-route-matches\][\s\S]*verify_jwt = true/.test(config));
assert(/resolveUserId\(token\)/.test(index));
assert(/SUPABASE_SERVICE_ROLE_KEY/.test(index));
assert(/get_route_matching_candidates_internal/.test(index));
assert(/p_driver_id: identity\.userId/.test(index));
assert(/for \(const candidate of candidates\)[\s\S]*consumeGoogleRoutesRateLimit\(token\)[\s\S]*fetch\(MATCHING_COMPUTE_URL/.test(index), "each Google call consumes its own limiter slot");
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

console.log("ALL MATCHING SERVER DRAFT CHECKS PASSED");
