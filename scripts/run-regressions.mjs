import { spawnSync } from "node:child_process";

const regressionScripts = [
  ".roadlink/address-routing-regression.js",
  ".roadlink/back-handler-regression.js",
  ".roadlink/route-metrics-regression.js",
  ".roadlink/route-preview-regression.js",
  ".roadlink/matching-v1-regression.js",
  ".roadlink/matching-server-regression.js",
  ".roadlink/rate-limit-regression.js",
  ".roadlink/google-auth-regression.js",
  ".roadlink/sos-regression.js",
  ".roadlink/form-creation-tests.js",
  ".roadlink/navigation-payload-regression.js",
  ".roadlink/post-native-fix-regression.js",
  ".roadlink/profile-vehicle-regression.js",
  ".roadlink/bottom-nav-regression.js",
  ".roadlink/personal-vehicles-regression.js",
  ".roadlink/public-market-regression.js",
  ".roadlink/transport-confirmation-regression.js",
];

for (const script of regressionScripts) {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("ALL ROADLINK REGRESSION SUITES PASSED");
