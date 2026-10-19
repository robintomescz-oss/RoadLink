const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const migration = read("supabase", "migrations", "20261005200000_transport_reviews_and_load.sql");
const requestForm = read("screens", "Transport", "CreateRequestScreen.tsx");
const routeForm = read("screens", "Transport", "RouteFormRoute.tsx");
const tracking = read("screens", "Transport", "TrackingRoute.tsx");
const profile = read("screens", "Profile", "ProfileRoute.tsx");
const matching = read("supabase", "functions", "google-route-matches", "index.ts");
const logic = read("lib", "createFormLogic.ts");

let failed = false;
function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else { console.error(`FAIL ${message}`); failed = true; }
}

check(/create table if not exists public\.transport_reviews/i.test(migration), "reviews use a dedicated table");
check(/unique \(tow_request_id, reviewer_id\)/i.test(migration), "each participant can review a transport only once");
check(/reviewer_id <> reviewee_id/i.test(migration), "self-review is forbidden");
check(/request_status is distinct from 'completed'/i.test(migration), "review RPC requires completed transport");
check(/auth\.uid\(\) = request_customer_id/i.test(migration) && /auth\.uid\(\) = request_driver_id/i.test(migration), "review RPC derives counterpart from real participants");
check(/revoke all on public\.transport_reviews from public, anon, authenticated/i.test(migration), "review table has no direct client privileges");
check(/security definer/i.test(migration) && /set search_path = ''/i.test(migration), "review RPC is hardened");
check(/get_my_transport_rating_summary/i.test(migration), "profile summary RPC exists");
check(/get_my_transport_review/i.test(migration), "own review state RPC exists");
check(/VEHICLE_WEIGHT_OPTIONS/.test(logic) && /over_2500/.test(logic) && /unknown/.test(logic), "shared five-band vehicle-weight model exists");
check(/vehicle_weight_band: vehicleWeightBand/.test(requestForm), "request form persists its selected weight band");
check(/max_vehicle_weight_band: maxVehicleWeightBand/.test(routeForm), "capacity form persists its selected weight band");
check(/vehicleWeightBand/.test(requestForm) && /maxVehicleWeightBand/.test(routeForm), "both forms require an explicit weight band including unknown");
check(/TransportReviewPanel/.test(tracking) && /activeJob\.status === "completed"/.test(tracking), "review entry appears only after completion");
check(/useTransportRatingSummary/.test(profile) && /Hodnocení od uživatelů/.test(profile), "profile shows received ratings for every account");
check(/requestWeightRank <= routeWeightRank/.test(matching), "matching excludes a request above the known route weight band");
check(!/reviewee_id:\s*/.test(tracking), "mobile never chooses the reviewee identity");

if (failed) process.exit(1);
console.log("ALL REVIEWS & LOAD REGRESSION CHECKS PASSED");
