const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

const packageJson = JSON.parse(read('package.json'));
const indexSource = read('index.js');
const navigatorSource = read('navigation/AppNavigator.tsx');
const offerFormSource = read('screens/Transport/OfferFormRoute.tsx');
const routeFormSource = read('screens/Transport/RouteFormRoute.tsx');
const jobDetailSource = read('screens/Transport/JobDetailRoute.tsx');
const transportTestSource = read('.roadlink/transport-confirmation-regression.js');
const profileTestSource = read('.roadlink/profile-vehicle-regression.js');

assert(packageJson.main === 'index.js', 'package.json main je index.js');
assert(indexSource.includes('registerRootComponent(App)'), 'index.js registruje AppNavigator přes registerRootComponent(App)');
assert(indexSource.includes('"./navigation/AppNavigator"') || indexSource.includes("'./navigation/AppNavigator'"), 'index.js importuje ./navigation/AppNavigator');
assert(!/component=\{PlaceholderScreen\}/.test(navigatorSource), 'AppNavigator nepoužívá PlaceholderScreen pro žádnou dosažitelnou route');
assert(!/name="overview"/.test(navigatorSource), 'overview route není v AppNavigator');
assert(!/overview:\s*undefined/.test(read('navigation/types.ts')), 'overview není v RootStackParamList');

assert(!transportTestSource.includes('App.tsx'), 'transport-confirmation-regression netestuje App.tsx');
assert(transportTestSource.includes("requireProductionTsModule('lib/transportLifecycleLogic.ts')"), 'transport-confirmation-regression importuje produkční lifecycle TS modul');
assert(profileTestSource.includes("requireProductionTsModule('lib/profileFormLogic.ts')"), 'profile-vehicle-regression importuje produkční profile helper TS modul');

assert(offerFormSource.includes('if (!userId)'), 'offerForm má auth guard bez Supabase zápisu');
assert(offerFormSource.includes('activeJob.customerId && activeJob.customerId === userId'), 'offerForm blokuje nabídku na vlastní poptávku');
assert(offerFormSource.includes('ensureCarrierProfile()'), 'offerForm zachovává guard přepravního profilu');
assert(offerFormSource.includes('supabase.from("tow_offers").insert({'), 'offerForm používá produkční insert do tow_offers');
for (const field of ['tow_request_id: activeJob.id', 'driver_id: userId', 'price,', 'estimated_arrival_at: offerArrivalDateTime.toISOString()', 'message: offerMessage', 'status: "pending"']) {
  assert(offerFormSource.includes(field), `offerForm payload obsahuje ${field}`);
}
assert(routeFormSource.includes('vehicle_types: [vehicleType]'), 'routeForm payload posílá vehicle_types jako pole');
assert(jobDetailSource.includes('select_tow_offer'), 'job/providerProfile výběr nabídky používá existující select_tow_offer cestu v detailu');
assert(jobDetailSource.includes('cancel_tow_request'), 'job detail rušení používá existující cancel_tow_request');

console.log('ALL NAVIGATION/PAYLOAD REGRESSION TESTS PASSED');
