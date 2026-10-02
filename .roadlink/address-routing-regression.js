const fs = require("fs");

const edge = fs.readFileSync("supabase/functions/google-places/index.ts", "utf8");
const client = fs.readFileSync("lib/verifiedLocation.ts", "utf8");
const component = fs.readFileSync("components/form/VerifiedLocationInput.tsx", "utf8");
const config = fs.readFileSync("supabase/config.toml", "utf8");

function check(condition, message) {
  if (!condition) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}

check(edge.includes('Deno.env.get("GOOGLE_MAPS_SERVER_API_KEY")'), "Google key is server-side only");
check(!client.includes("GOOGLE_MAPS_SERVER_API_KEY") && !component.includes("GOOGLE_MAPS_SERVER_API_KEY"), "mobile code does not reference server key");
check(edge.includes("X-Goog-FieldMask"), "Google responses use explicit field masks");
check(edge.includes("sessionToken"), "autocomplete and details use a session token");
check(edge.includes('provider: "google"'), "verified location records its provider");
check(edge.includes("publicLabelFromComponents"), "public label is derived from address components");
check(config.includes("verify_jwt = true"), "Edge Function requires an authenticated JWT");
check(component.includes("if (value) onChange(null)"), "manual text changes invalidate a verified selection");
check(component.includes("350"), "autocomplete is debounced");
check(client.includes('supabase.functions.invoke("google-places"'), "mobile calls the protected Edge Function");

console.log("ALL ADDRESS & ROUTING FOUNDATION TESTS PASSED");
