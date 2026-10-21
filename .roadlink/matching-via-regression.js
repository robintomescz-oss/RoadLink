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

function candidate(overrides = {}) {
  return logic.normalizeCandidate({
    route_id: "route-1",
    route_origin_place_id: "route-origin",
    route_destination_place_id: "route-destination",
    route_distance_meters: 200000,
    route_duration_seconds: 7200,
    max_deviation_km: 20,
    request_id: "request-1",
    request_origin_place_id: "request-origin",
    request_destination_place_id: "request-destination",
    ...overrides,
  });
}

function withVia(via, requestPickup, requestDropoff, overrides = {}) {
  return logic.normalizeCandidate({
    route_id: "route-1",
    route_origin_place_id: "A",
    route_destination_place_id: "B",
    route_via_place_ids: via,
    route_distance_meters: 500000,
    route_duration_seconds: 18000,
    max_deviation_km: 20,
    request_id: "request-1",
    request_origin_place_id: requestPickup,
    request_destination_place_id: requestDropoff,
    ...overrides,
  });
}

// --- 1. Prime trasa zachova dosavadni chovani: jedina varianta, stejne poradi ---
const direct = candidate();
assert(direct, "direct candidate normalizes");
assert.deepStrictEqual(direct.route_via_place_ids, [], "missing via column defaults to a direct route");
const directVariants = logic.enumerateInsertionVariants(direct);
assert.strictEqual(directVariants.length, 1, "direct route keeps exactly one insertion variant (no extra API calls)");
assert.deepStrictEqual(directVariants[0].sequence, ["route-origin", "request-origin", "request-destination", "route-destination"]);
const directBody = logic.buildVariantRouteBody(directVariants[0].sequence);
assert.deepStrictEqual(directBody.intermediates, [{ placeId: "request-origin" }, { placeId: "request-destination" }]);
assert.strictEqual(directBody.optimizeWaypointOrder, false, "Google must not reorder stops");

// --- 2./3./4./5./6. Cela planovana trasa, poradi via, nakladka pred vykladkou ---
const viaCandidate = withVia(["V1", "V2"], "X", "Y");
assert(viaCandidate);
const basePoints = logic.buildRoutePlanningPoints(viaCandidate);
assert.deepStrictEqual(basePoints, ["A", "V1", "V2", "B"]);
const variants = logic.enumerateInsertionVariants(viaCandidate);
assert.strictEqual(variants.length, 15, "(n+1)(n+2)/2 admissible insertions for a 2-via route");
const seenKeys = new Set();
for (const variant of variants) {
  assert(!seenKeys.has(variant.key), "variants are unique");
  seenKeys.add(variant.key);
  const seq = variant.sequence;
  assert.strictEqual(new Set(seq).size, seq.length, "no duplicate place id in a variant");
  assert(seq.indexOf("X") < seq.indexOf("Y"), "pickup always precedes dropoff");
  const order = ["A", "V1", "V2", "B"].map((id) => seq.indexOf(id));
  assert(order.every((index) => index >= 0), "every original point is present");
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepStrictEqual(order, sorted, "original via order is preserved");
}
const adjacentVariants = variants.filter((v) => Math.abs(v.sequence.indexOf("X") - v.sequence.indexOf("Y")) === 1);
const separatedVariants = variants.filter((v) => Math.abs(v.sequence.indexOf("X") - v.sequence.indexOf("Y")) > 1);
assert(adjacentVariants.length > 0, "same-segment insertion is available");
assert(separatedVariants.length > 0, "different-segment insertion is available");
assert(variants.some((v) => {
  const seq = v.sequence;
  return seq.indexOf("A") < seq.indexOf("X") && seq.indexOf("X") < seq.indexOf("Y") && seq.indexOf("Y") < seq.indexOf("V1");
}), "insertion between origin and the first via is available");
assert(variants.some((v) => {
  const seq = v.sequence;
  return seq.indexOf("V1") < seq.indexOf("X") && seq.indexOf("X") < seq.indexOf("Y") && seq.indexOf("Y") < seq.indexOf("V2");
}), "insertion between two via points is available");

// --- Nakladka/vykladka v pocatku, cili nebo prujezdnim bode ---
const pickupAtOrigin = withVia(["V1"], "A", "Y");
const pickupAtOriginVariants = logic.enumerateInsertionVariants(pickupAtOrigin);
assert(pickupAtOriginVariants.length > 0);
assert(pickupAtOriginVariants.every((v) => v.sequence.filter((id) => id === "A").length === 1), "pickup at origin is not duplicated");
assert(pickupAtOriginVariants.every((v) => v.sequence.indexOf("A") < v.sequence.indexOf("Y")), "dropoff stays after pickup");

const dropoffAtDestination = withVia(["V1"], "X", "B");
assert(dropoffAtDestination);
const dropoffAtDestVariants = logic.enumerateInsertionVariants(dropoffAtDestination);
assert(dropoffAtDestVariants.length > 0);
assert(dropoffAtDestVariants.every((v) => v.sequence.filter((id) => id === "B").length === 1), "dropoff at destination is not duplicated");
assert(dropoffAtDestVariants.every((v) => v.sequence.indexOf("X") < v.sequence.indexOf("B")), "pickup precedes dropoff at destination");

const bothOnRoute = withVia(["X", "Y"], "X", "Y");
assert(bothOnRoute);
const bothOnRouteVariants = logic.enumerateInsertionVariants(bothOnRoute);
assert.strictEqual(bothOnRouteVariants.length, 1, "both request points already on the route give a single zero-detour variant");
assert.strictEqual(bothOnRouteVariants[0].zeroDetour, true, "zero detour needs no Google call");
assert.deepStrictEqual(bothOnRouteVariants[0].sequence, ["A", "X", "Y", "B"]);

// --- 12. Duplicitni/totozne body nezpusobi neplatne poradi ani zbytecne vypocty ---
assert.deepStrictEqual(logic.enumerateInsertionVariants(withVia(["V1"], "X", "X")), [], "identical pickup and dropoff yields no variant");
const pickupAtVia = withVia(["V1", "V2"], "V1", "Y");
const pickupAtViaVariants = logic.enumerateInsertionVariants(pickupAtVia);
assert(pickupAtViaVariants.length > 0);
assert(pickupAtViaVariants.every((v) => v.sequence.filter((id) => id === "V1").length === 1), "pickup equal to a via point is not duplicated");
assert(pickupAtViaVariants.every((v) => v.sequence.indexOf("V1") < v.sequence.indexOf("Y")), "dropoff is inserted after the pickup via point");
const dropoffBeforePickup = withVia(["V1"], "V1", "A");
assert.deepStrictEqual(logic.enumerateInsertionVariants(dropoffBeforePickup), [], "dropoff before pickup along the route is impossible");

// --- 7. Vyber nejlepsi pripustne varianty a deterministicke rozhodnuti pri shode ---
function evaluated(sequenceKey, distanceMeters, durationSeconds) {
  return {
    variant: { sequence: sequenceKey, key: sequenceKey.join(">"), zeroDetour: false },
    match: { requestId: "request-1", detourDistanceMeters: distanceMeters, detourDurationSeconds: durationSeconds, score: 1, reasons: [] },
  };
}
const best = logic.selectBestVariantMatch([
  evaluated(["a", "b"], 5000, 600),
  evaluated(["a", "c"], 3000, 1200),
  evaluated(["a", "d"], 5000, 300),
]);
assert.strictEqual(best.variant.key, "a>c", "smallest detour distance wins");
const tieDistance = logic.selectBestVariantMatch([
  evaluated(["a", "b"], 5000, 600),
  evaluated(["a", "d"], 5000, 300),
]);
assert.strictEqual(tieDistance.variant.key, "a>d", "distance tie breaks on shorter duration");
const tieBoth = logic.selectBestVariantMatch([
  evaluated(["a", "z"], 5000, 300),
  evaluated(["a", "b"], 5000, 300),
]);
assert.strictEqual(tieBoth.variant.key, "a>b", "full tie breaks deterministically on variant key");
const repeat = logic.selectBestVariantMatch([
  evaluated(["a", "z"], 5000, 300),
  evaluated(["a", "b"], 5000, 300),
]);
assert.strictEqual(repeat.variant.key, tieBoth.variant.key, "selection is deterministic");
assert.strictEqual(logic.selectBestVariantMatch([]), null, "no evaluated variant yields no match");

// --- 2. Zajizdka: porovnani se zakladni trasou, male zaporne rozdily, nesrovnatelne udaje ---
const directDetour = logic.computeVariantDetour(direct, { distanceMeters: 218000, durationSeconds: 8700 });
assert.deepStrictEqual(directDetour, { detourDistanceMeters: 18000, detourDurationSeconds: 1500 });
const roundingDetour = logic.computeVariantDetour(direct, { distanceMeters: 199500, durationSeconds: 7200 });
assert.deepStrictEqual(roundingDetour, { detourDistanceMeters: 0, detourDurationSeconds: 0 }, "small negative rounding collapses to zero");
assert.strictEqual(
  logic.computeVariantDetour(direct, { distanceMeters: 180000, durationSeconds: 7000 }),
  null,
  "materially shorter variant is incomparable and rejected",
);
assert.strictEqual(logic.computeVariantDetour(direct, null), null, "missing metrics are rejected");
assert.strictEqual(logic.normalizeVariantComputation({ routes: [] }), null, "empty Google response yields no computation");
assert.strictEqual(logic.normalizeVariantComputation({ routes: [{ distanceMeters: -1, duration: "10s" }] }), null, "negative distance rejected");
assert.strictEqual(logic.normalizeVariantComputation({ routes: [{ distanceMeters: 10, duration: "nope" }] }), null, "invalid duration rejected");

// --- 8. Zajizdka tesne pod limitem, na limitu a nad limitem ---
const limitCandidate = withVia(["V1"], "X", "Y", { max_deviation_km: 20 });
assert(logic.isWithinDeviation({ detourDistanceMeters: 19999 }, limitCandidate));
assert(logic.isWithinDeviation({ detourDistanceMeters: 20000 }, limitCandidate), "exactly at the limit is still a match");
assert(!logic.isWithinDeviation({ detourDistanceMeters: 20001 }, limitCandidate), "over the limit is rejected");
const noTolerance = withVia(["V1"], "X", "Y", { max_deviation_km: null });
assert.strictEqual(logic.resolveMaxDeviationKm(noTolerance), 20, "missing tolerance keeps the existing default");
assert(logic.isWithinDeviation({ detourDistanceMeters: 19999 }, noTolerance));
assert(!logic.isWithinDeviation({ detourDistanceMeters: 25000 }, noTolerance));

// --- 11. Chybejici nebo neplatne udaje ---
assert.strictEqual(logic.normalizeCandidate({ route_id: "r" }), null, "incomplete candidate row is rejected");
assert(
  logic.normalizeCandidate({
    route_id: "r",
    route_origin_place_id: "A",
    route_destination_place_id: "B",
    route_distance_meters: 1000,
    route_duration_seconds: 60,
    max_deviation_km: 10,
    request_id: "q",
    request_origin_place_id: "X",
    request_destination_place_id: "Y",
    route_via_place_ids: ["A"],
  }) === null,
  "via point equal to the route origin is rejected",
);
assert(
  logic.normalizeCandidate({
    route_id: "r",
    route_origin_place_id: "A",
    route_destination_place_id: "B",
    route_distance_meters: 1000,
    route_duration_seconds: 60,
    max_deviation_km: 10,
    request_id: "q",
    request_origin_place_id: "X",
    request_destination_place_id: "Y",
    route_via_place_ids: ["V1", "V1"],
  }) === null,
  "duplicate via points are rejected",
);
assert(
  logic.normalizeCandidate({
    route_id: "r",
    route_origin_place_id: "A",
    route_destination_place_id: "B",
    route_distance_meters: 1000,
    route_duration_seconds: 60,
    max_deviation_km: 10,
    request_id: "q",
    request_origin_place_id: "X",
    request_destination_place_id: "Y",
    route_via_place_ids: ["V1", "V2", "V3", "V4"],
  }) === null,
  "more via points than the DB limit are rejected",
);

// --- 10. Popravka pobliz vzdaleneho prujezdniho bodu neni vyrazena predvyberem ---
const viaMigration = read("supabase/migrations/20261005120000_matching_includes_via_routes.sql");
assert(/route_via_place_ids/i.test(viaMigration), "new preselection returns via points");
assert(!/st_distance|st_dwithin|bounding|bbox|haversine|geograph/i.test(viaMigration), "preselection adds no bounding box that could drop requests near a via point");
assert(/cr\.via_place_ids/i.test(viaMigration), "preselection selects via routes");
assert(!/coalesce\(cardinality\(cr\.via_place_ids\), 0\) = 0/i.test(viaMigration), "preselection no longer drops via routes");

// --- Kompletni planovana trasa a bezpecny vystup ---
const viaBody = logic.buildVariantRouteBody(["A", "X", "V1", "Y", "B"]);
assert.deepStrictEqual(viaBody.origin, { placeId: "A" });
assert.deepStrictEqual(viaBody.destination, { placeId: "B" });
assert.deepStrictEqual(viaBody.intermediates, [{ placeId: "X" }, { placeId: "V1" }, { placeId: "Y" }], "vias and inserted points keep their exact order");
assert.strictEqual(viaBody.optimizeWaypointOrder, false);
const match = logic.normalizeMatchingMetrics({ routes: [{ distanceMeters: 518000, duration: "9600s" }] }, direct);
assert(match);
assert(!Object.keys(match).some((key) => /place|address|lat|lng|via/i.test(key)), "match output exposes no private place data");

console.log("ALL MATCHING VIA REGRESSION CHECKS PASSED");
