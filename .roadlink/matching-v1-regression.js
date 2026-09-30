const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "lib/matchingLogic.ts");
const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
}).outputText;
const moduleBox = { exports: {} };
Function("require", "module", "exports", output)(require, moduleBox, moduleBox.exports);
const { evaluateTransportMatch, rankTransportMatches } = moduleBox.exports;

const request = {
  id: "request-1",
  status: "open",
  requestedDate: "2026-10-10",
  requestedEndDate: "2026-10-12",
  vehicleType: "Osobní automobil",
  requiredSpaces: 1,
};
const route = {
  id: "route-1",
  status: "open",
  departureAt: "2026-10-11T08:00:00.000Z",
  availableSpaces: 2,
  maxDeviationKm: 20,
  vehicleTypes: ["Osobní automobil", "Dodávka"],
};
const detour = { distanceMeters: 18000, durationSeconds: 1500 };

const eligible = evaluateTransportMatch({ request, route, detour });
assert.strictEqual(eligible.eligible, true);
assert.strictEqual(eligible.requestId, request.id);
assert.strictEqual(eligible.routeId, route.id);
assert(eligible.score > 0);
assert(eligible.reasons.some((reason) => reason.includes("termín")));
assert(eligible.reasons.some((reason) => reason.includes("vozidla")));

assert.strictEqual(evaluateTransportMatch({ request: { ...request, status: "completed" }, route, detour }).rejection, "not_open");
assert.strictEqual(evaluateTransportMatch({ request: { ...request, requestedDate: null }, route, detour }).rejection, "missing_schedule");
assert.strictEqual(evaluateTransportMatch({ request, route: { ...route, departureAt: "2026-10-14T08:00:00Z" }, detour }).rejection, "date_mismatch");
assert.strictEqual(evaluateTransportMatch({ request, route: { ...route, vehicleTypes: ["Motocykl"] }, detour }).rejection, "vehicle_mismatch");
assert.strictEqual(evaluateTransportMatch({ request, route: { ...route, availableSpaces: 0 }, detour }).rejection, "insufficient_capacity");
assert.strictEqual(evaluateTransportMatch({ request, route, detour: { distanceMeters: -1, durationSeconds: 10 } }).rejection, "invalid_detour");
assert.strictEqual(evaluateTransportMatch({ request, route: { ...route, maxDeviationKm: 10 }, detour }).rejection, "deviation_exceeded");
assert.strictEqual(evaluateTransportMatch({ request, route: { ...route, maxDeviationKm: null }, detour }).rejection, "deviation_exceeded");

const closer = evaluateTransportMatch({ request, route: { ...route, id: "route-b" }, detour: { distanceMeters: 3000, durationSeconds: 300 } });
const farther = evaluateTransportMatch({ request, route: { ...route, id: "route-a" }, detour: { distanceMeters: 9000, durationSeconds: 900 } });
const ranked = rankTransportMatches([farther, eligible, closer]);
assert.strictEqual(ranked[0].routeId, "route-b");
assert(ranked[0].score >= ranked[1].score);
assert.deepStrictEqual(rankTransportMatches([evaluateTransportMatch({ request, route: { ...route, status: "full" }, detour })]), []);

const source = fs.readFileSync(filename, "utf8");
assert(!/supabase|fetch\(|google|insert|update|delete/i.test(source), "pure matching logic must have no network or database mutation");
assert(!/customer_id|driver_id|pickup_address|destination_address|latitude|longitude/i.test(source), "matching output must not expose private identity/address fields");

console.log("ALL MATCHING V1 PURE LOGIC CHECKS PASSED");
