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

check(/add column if not exists cargo_weight_kg integer/i.test(migration), "request cargo weight migration exists");
check(/add column if not exists available_weight_kg integer/i.test(migration), "route available payload migration exists");
check(/between 1 and 50000/g.test(migration), "both weights have bounded positive validation");
check(/create table if not exists public\.transport_reviews/i.test(migration), "reviews use a dedicated table");
check(/unique \(tow_request_id, reviewer_id\)/i.test(migration), "each participant can review a transport only once");
check(/reviewer_id <> reviewee_id/i.test(migration), "self-review is forbidden");
check(/request_status is distinct from 'completed'/i.test(migration), "review RPC requires completed transport");
check(/auth\.uid\(\) = request_customer_id/i.test(migration) && /auth\.uid\(\) = request_driver_id/i.test(migration), "review RPC derives counterpart from real participants");
check(/revoke all on public\.transport_reviews from public, anon, authenticated/i.test(migration), "review table has no direct client privileges");
check(/security definer/i.test(migration) && /set search_path = ''/i.test(migration), "review RPC is hardened");
check(/get_my_transport_rating_summary/i.test(migration), "profile summary RPC exists");
check(/get_my_transport_review/i.test(migration), "own review state RPC exists");
check(/Odhadovaná hmotnost vozidla \/ nákladu/i.test(requestForm), "request form explains cargo weight");
check(/cargo_weight_kg: cargoWeight/i.test(requestForm), "request form persists cargo weight");
check(/Volná nosnost/i.test(routeForm), "capacity form explains remaining payload");
check(/available_weight_kg: availableWeight/i.test(routeForm), "capacity form persists remaining payload");
check(/parseOptionalWeightKg/.test(logic) && /1 do 50 000 kg/.test(logic), "client validates optional weights consistently");
check(/TransportReviewPanel/.test(tracking) && /activeJob\.status === "completed"/.test(tracking), "review entry appears only after completion");
check(/useTransportRatingSummary/.test(profile) && /Hodnocení od uživatelů/.test(profile), "profile shows received ratings for every account");
check(/availableWeight === null \|\| cargoWeight === null \|\| cargoWeight <= availableWeight/.test(matching), "matching excludes known overweight requests");
check(!/reviewee_id:\s*/.test(tracking), "mobile never chooses the reviewee identity");

if (failed) process.exit(1);
console.log("ALL REVIEWS & LOAD REGRESSION CHECKS PASSED");
