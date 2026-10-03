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

const logic = loadTs("supabase/functions/google-route-matches/matchingRequest.ts", {
  "../google-routes/routeRequest.ts": {
    normalizePlaceId: (value) => (typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null),
    parseDurationSeconds: (value) => (typeof value === "string" && /^\d+s$/.test(value) ? Number(value.slice(0, -1)) : null),
  },
});

// Trasa A -> V1 -> V2 -> B, vsechny souradnice vyplnene.
function viaCandidate(pickup, dropoff, overrides = {}) {
  return logic.normalizeCandidate({
    route_id: "route-1",
    route_origin_place_id: "A",
    route_destination_place_id: "B",
    route_via_place_ids: ["V1", "V2"],
    route_origin_lat: 50.0, route_origin_lng: 14.0,
    route_destination_lat: 48.5, route_destination_lng: 17.0,
    route_via_latitudes: [49.5, 49.0], route_via_longitudes: [15.0, 16.0],
    route_distance_meters: 500000,
    route_duration_seconds: 18000,
    max_deviation_km: 20,
    request_id: "request-1",
    request_origin_place_id: "X",
    request_destination_place_id: "Y",
    request_pickup_lat: pickup.lat, request_pickup_lng: pickup.lng,
    request_destination_lat: dropoff.lat, request_destination_lng: dropoff.lng,
    ...overrides,
  });
}

// --- Parsovani souradnic ---
const candidate = viaCandidate({ lat: 49.02, lng: 16.05 }, { lat: 49.03, lng: 16.1 });
assert(candidate);
assert.strictEqual(candidate.route_origin_lat, 50.0);
assert.deepStrictEqual(candidate.route_via_latitudes, [49.5, 49.0]);
assert.deepStrictEqual(candidate.route_via_longitudes, [15.0, 16.0]);
assert.strictEqual(candidate.request_pickup_lat, 49.02);
const badCoords = viaCandidate({ lat: 49.02, lng: 16.05 }, { lat: 49.03, lng: 16.1 }, { route_via_latitudes: [999, 49.0] });
assert(badCoords, "candidate with an out-of-range coordinate stays valid");
assert.strictEqual(badCoords.route_via_latitudes, null, "out-of-range coordinate array is dropped");
const shortCoords = viaCandidate({ lat: 49.02, lng: 16.05 }, { lat: 49.03, lng: 16.1 }, { route_via_longitudes: [15.0] });
assert.strictEqual(shortCoords.route_via_longitudes, null, "coordinate array with a wrong length is dropped");

// --- Haversine ---
const prague = { latitude: 50.08, longitude: 14.42 };
const brno = { latitude: 49.19, longitude: 16.61 };
const pragueBrno = logic.haversineMeters(prague, brno);
assert(pragueBrno > 170000 && pragueBrno < 210000, `Prague-Brno is roughly 185 km, got ${Math.round(pragueBrno)}`);
assert.strictEqual(logic.haversineMeters(prague, prague), 0);
assert(logic.haversineMeters({ latitude: 50, longitude: 14 }, { latitude: 50, longitude: 14.1 }) > 6800, "0.1 deg east is ~7 km at this latitude");

// --- Mapa souradnic a chybejici data ---
const map = logic.buildRouteCoordinateMap(candidate);
assert(map, "complete coordinates build a map");
assert.deepStrictEqual(map["V1"], { latitude: 49.5, longitude: 15.0 });
assert.deepStrictEqual(map["X"], { latitude: 49.02, longitude: 16.05 });
assert.strictEqual(logic.buildRouteCoordinateMap({ ...candidate, route_via_latitudes: null }), null, "missing via coordinates disable the coordinate path");
assert.strictEqual(logic.buildRouteCoordinateMap({ ...candidate, request_pickup_lat: null }), null, "missing request coordinates disable the coordinate path");

// --- Razeni variant podle souradnic: nejmensi odhad vyhraje ---
const base = ["A", "V1", "V2", "B"];
const variants = logic.enumerateInsertionVariants(candidate);
const ranked = logic.rankVariantsByCoordinates(map, base, variants);
assert.strictEqual(ranked.length, variants.length);
const approximations = variants.map((variant) => logic.approximateVariantDetourByCoordinates(map, base, variant.sequence).detourDistanceMeters);
const bestApprox = Math.min(...approximations);
const chosenApprox = logic.approximateVariantDetourByCoordinates(map, base, ranked[0].sequence).detourDistanceMeters;
assert.strictEqual(chosenApprox, bestApprox, "coordinate ranking puts the smallest approximate detour first");
assert(chosenApprox < 10000, `the request next to a via point has a small detour, got ${Math.round(chosenApprox)} m`);
const insertion = ranked[0].sequence.filter((id) => id === "X" || id === "Y");
assert.deepStrictEqual(insertion, ["X", "Y"], "pickup and dropoff keep their order");
assert(ranked.slice(0, logic.MAX_EXACT_VARIANTS_PER_CANDIDATE).includes(ranked[0]), "bounded exact budget starts with the best coordinate variant");

// --- Polohovy predvyber kandidatu je v SQL ---
const geoMigration = read("supabase/migrations/20261005140000_matching_sql_geo_preselection.sql");
assert(/add column if not exists bbox_min_lat double precision/i.test(geoMigration), "route stores a bounding box of the whole planned route");
assert(/create or replace function public\.assign_carrier_route_bbox\(\)/i.test(geoMigration), "the bounding box is derived by a trigger, never by hand");
assert(/create trigger carrier_routes_bbox_assign/i.test(geoMigration), "the bounding box trigger is installed on insert and update");
assert(/roadlink_haversine_meters/i.test(geoMigration), "SQL computes great-circle distance");
assert(/c_pickup_distance_m \+ e\.c_dropoff_distance_m as route_proximity_meters/i.test(geoMigration), "SQL returns the distance of the candidate from the route");
assert(/order by[\s\S]*c_pickup_distance_m \+ e\.c_dropoff_distance_m/i.test(geoMigration), "candidates are ordered by distance to the route, before date");
assert(/e\.c_bbox_min_lat is null[\s\S]*e\.c_bbox_min_lng is null/i.test(geoMigration), "candidates without coordinates are never filtered out");
assert(/c_bbox_min_lat - e\.c_margin_lat/i.test(geoMigration), "the bounding box is expanded by the allowed deviation before filtering");
assert(/create index if not exists carrier_routes_bbox_lat_idx/i.test(geoMigration) && /create index if not exists carrier_routes_bbox_lng_idx/i.test(geoMigration), "bounding box columns are indexed");
assert(/security definer/i.test(geoMigration) && /set search_path = ''/i.test(geoMigration), "geo preselection keeps the internal RPC hardening");
assert(/grant execute[\s\S]*to service_role/i.test(geoMigration) && !/grant execute[\s\S]*to (anon|authenticated)/i.test(geoMigration), "geo RPC grants execute only to service_role");
assert(!/\b(delete|truncate|drop table)\b/i.test(geoMigration), "geo migration destroys no data");
assert(!/postgis|create extension/i.test(geoMigration), "geo preselection does not require a new database extension");

const index = read("supabase/functions/google-route-matches/index.ts");
assert(/p_limit: MAX_MATCH_CANDIDATES/.test(index), "Edge Function asks only for the preselected candidates");
assert(!/MAX_CANDIDATE_FETCH/.test(index), "Edge Function no longer fetches a wide candidate window");
assert(!/selectGeoPreselectedCandidates|candidateProximityMeters/.test(index), "candidate preselection happens in SQL, not in TypeScript");
assert(/rankVariantsByCoordinates/.test(index), "Edge Function still ranks variants by stored coordinates");
assert(!/console\.(log|error|warn)\([^\n]*\b(token|userId|placeId|lat|lng|body|coordinate)\b/i.test(index), "coordinate logs never leak private identifiers");
const match = logic.normalizeMatchingMetrics({ routes: [{ distanceMeters: 518000, duration: "18600s" }] }, candidate);
assert(match && !Object.keys(match).some((key) => /place|address|lat|lng|via|coordinate/i.test(key)), "match output still exposes no coordinates");

const publicFeed = read("supabase/migrations/20261003090000_remove_via_places_from_public_feed.sql");
assert(!/via_latitudes|via_longitudes|bbox_|from_lat|to_lat/i.test(publicFeed), "coordinates and the bounding box stay out of the public feed");

console.log("ALL MATCHING COORDINATES REGRESSION CHECKS PASSED");