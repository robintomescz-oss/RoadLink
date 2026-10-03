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

function viaCandidate(pickup, dropoff) {
  return logic.normalizeCandidate({
    route_id: "route-1",
    route_origin_place_id: "A",
    route_destination_place_id: "B",
    route_via_place_ids: ["V1", "V2"],
    route_distance_meters: 500000,
    route_duration_seconds: 18000,
    max_deviation_km: 20,
    request_id: "request-1",
    request_origin_place_id: pickup,
    request_destination_place_id: dropoff,
  });
}

// --- Body pro matrix a telo pozadavku ---
const candidate = viaCandidate("X", "Y");
assert(candidate);
assert.deepStrictEqual(logic.buildMatrixPoints(candidate), ["A", "V1", "V2", "B", "X", "Y"], "matrix points add pickup and dropoff");
const pickupAtVia = viaCandidate("V1", "Y");
assert.deepStrictEqual(logic.buildMatrixPoints(pickupAtVia), ["A", "V1", "V2", "B", "Y"], "points already on the route are not duplicated");
const body = logic.buildMatchingMatrixBody(logic.buildMatrixPoints(candidate));
assert.deepStrictEqual(body.origins, ["A", "V1", "V2", "B", "X", "Y"].map((placeId) => ({ waypoint: { placeId } })));
assert.deepStrictEqual(body.destinations, body.origins, "matrix covers all point pairs");
assert.strictEqual(body.travelMode, "DRIVE");
assert.strictEqual(body.routingPreference, "TRAFFIC_UNAWARE");
assert(!("optimizeWaypointOrder" in body), "matrix never reorders waypoints");

// --- Parsovani odpovedi: platne, chybejici a neplatne elementy ---
const points = ["A", "V1", "B", "X"];
const table = logic.parseMatchingMatrix([
  { originIndex: 0, destinationIndex: 1, distanceMeters: 100000, duration: "3600s", condition: "ROUTE_EXISTS" },
  { originIndex: 1, destinationIndex: 2, distanceMeters: 60000, duration: "1800s", condition: "ROUTE_EXISTS" },
  { originIndex: 3, destinationIndex: 1, distanceMeters: 10000, duration: "600s", condition: "ROUTE_EXISTS" },
  { originIndex: 0, destinationIndex: 2, distanceMeters: 0, duration: "0s", condition: "ROUTE_NOT_FOUND" },
  { originIndex: 9, destinationIndex: 9, distanceMeters: 1000, duration: "60s" },
  { originIndex: 1, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
  { originIndex: 2, destinationIndex: 1, distanceMeters: -5, duration: "60s" },
  { originIndex: 1, destinationIndex: 3, distanceMeters: 1000, duration: "nope" },
], points);
assert(table, "usable matrix elements produce a table");
assert.deepStrictEqual(table["A>V1"], { distanceMeters: 100000, durationSeconds: 3600 });
assert.deepStrictEqual(table["X>V1"], { distanceMeters: 10000, durationSeconds: 600 });
assert.strictEqual(table["A>B"], undefined, "not-found element is dropped");
assert.strictEqual(table["B>V1"], undefined, "negative distance is dropped");
assert.strictEqual(table["V1>X"], undefined, "invalid duration is dropped");
assert.strictEqual(logic.parseMatchingMatrix([], points), null, "empty matrix yields no table");
assert.strictEqual(logic.parseMatchingMatrix(null, points), null, "missing matrix response yields no table");

// --- Hruby odhad zajizdky z matrixu ---
const approxTable = {
  "A>V1": { distanceMeters: 100000, durationSeconds: 3600 },
  "V1>B": { distanceMeters: 200000, durationSeconds: 7200 },
  "A>X": { distanceMeters: 20000, durationSeconds: 1200 },
  "X>V1": { distanceMeters: 90000, durationSeconds: 3300 },
  "V1>Y": { distanceMeters: 30000, durationSeconds: 1500 },
  "Y>B": { distanceMeters: 180000, durationSeconds: 6600 },
};
const baseApprox = logic.approximateVariantDetour(["A", "V1", "B"], ["A", "V1", "B"], approxTable);
assert.deepStrictEqual(baseApprox, { detourDistanceMeters: 0, detourDurationSeconds: 0 });
const insertBeforeVia = logic.approximateVariantDetour(["A", "V1", "B"], ["A", "X", "V1", "Y", "B"], approxTable);
assert.deepStrictEqual(insertBeforeVia, { detourDistanceMeters: 20000, detourDurationSeconds: 1800 }, "approximate detour uses point-to-point legs");
assert.strictEqual(
  logic.approximateVariantDetour(["A", "V1", "B"], ["A", "X", "V1", "Y", "B"], { "A>V1": { distanceMeters: 1, durationSeconds: 1 } }),
  null,
  "a missing leg makes the variant unrankable",
);

// --- Razeni variant podle odhadu a vybrani presne overovanych ---
const variants = logic.enumerateInsertionVariants(candidate);
assert.strictEqual(variants.length, 15);
const coord = { A: 0, V1: 100, V2: 200, B: 400, X: 130, Y: 160 };
const model = {};
for (const from of Object.keys(coord)) {
  for (const to of Object.keys(coord)) {
    const km = Math.abs(coord[from] - coord[to]);
    model[`${from}>${to}`] = { distanceMeters: km * 1000, durationSeconds: km * 60 };
  }
}
const expected = variants
  .map((variant) => ({ variant, approx: logic.approximateVariantDetour(["A", "V1", "V2", "B"], variant.sequence, model) }))
  .sort((left, right) =>
    left.approx.detourDistanceMeters - right.approx.detourDistanceMeters ||
    left.approx.detourDurationSeconds - right.approx.detourDurationSeconds ||
    left.variant.key.localeCompare(right.variant.key)
  )
  .map((item) => item.variant.key);
const ranked = logic.rankVariantsByApproximation(["A", "V1", "V2", "B"], variants, model);
assert.deepStrictEqual(ranked.map((v) => v.key), expected, "screening sorts variants by approximate detour, then duration, then key");
assert.strictEqual(logic.MAX_EXACT_VARIANTS_PER_CANDIDATE, 3);
assert(ranked.slice(0, logic.MAX_EXACT_VARIANTS_PER_CANDIDATE).includes(ranked[0]), "top exact budget starts with the best approximate variant");
// Neohodnotitelne varianty zustavaji, jen spadnou na konec.
const partiallyRanked = logic.rankVariantsByApproximation(["A", "V1", "V2", "B"], variants, { "A>V1": { distanceMeters: 1, durationSeconds: 1 } });
assert.strictEqual(partiallyRanked.length, variants.length, "ranking never drops a variant");
assert.deepStrictEqual(partiallyRanked.map((v) => v.key), variants.map((v) => v.key), "unrankable variants keep the deterministic order");

// --- Staticke kontroly Edge Function ---
const index = read("supabase/functions/google-route-matches/index.ts");
assert(/MATCHING_MATRIX_URL/.test(index), "Edge Function calls the matrix endpoint");
assert(/MAX_EXACT_VARIANTS_PER_CANDIDATE/.test(index), "Edge Function bounds exact verification");
assert(/allVariants\.length > MAX_EXACT_VARIANTS_PER_CANDIDATE/.test(index), "screening runs only when variants exceed the exact budget");
assert(!/console\.(log|error|warn)\([^\n]*(token|userId|placeId|body)/i.test(index), "matrix logs never leak private identifiers");
assert(!/\b(insert into|update|delete from)\b/i.test(index), "matching still performs no mutations");

console.log("ALL MATCHING MATRIX REGRESSION CHECKS PASSED");
