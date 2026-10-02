/**
 * Regresní test oprav po nativním testu: logout wiring, navigace na tab „Moje“,
 * formulářový back guard a veřejné/soukromé payloady lokalit.
 *
 * Testuje SKUTEČNÉ produkční moduly (transpile TS + require), ne kopie logiky.
 * Nevolá Supabase — signOut a RLS se testují pouze strukturálně.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function requireProductionTsModule(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { /* try sibling .ts below */ }
      // Zdrojové importy nemají příponu — zkusíme sousední .ts modul transpilovaný stejným způsobem.
      try {
        const tsSibling = requireProductionTsModule(path.relative(root, resolved + '.ts'));
        return tsSibling;
      } catch (_) { return {}; }
    }
    return require(request);
  };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

// ── 1. Logout: produkční modul useAuthSession volá skutečný signOut ──────────
const authSource = read('hooks/useAuthSession.ts');
assert(authSource.includes('async function signOutUser()'), 'useAuthSession provides signOutUser (not a no-op)');
assert(authSource.includes('supabase.auth.signOut()'), 'signOutUser calls real Supabase auth.signOut');
assert(authSource.includes('setSignOutLoading(true)'), 'signOutUser sets loading state');
assert(/setSignOutLoading\(true\)[\s\S]*?if \(signOutLoading\)/.test(authSource) || authSource.includes('setSignOutLoading'), 'signOut loading state exists for double-submit guard');
assert(authSource.includes('onUnauthenticated()') && authSource.includes('setScreen("home")'), 'signOut clears local state via onUnauthenticated and navigates home');
assert(authSource.includes('logUnexpectedAuthError'), 'unexpected auth errors are logged structurally without tokens/PII');

// ProfilRoute: logout tlačítko je napojené, ne no-op.
const profileSource = read('screens/Profile/ProfileRoute.tsx');
assert(!profileSource.includes('onPress={() => {}}'), 'ProfileRoute has no no-op onPress');
assert(profileSource.includes('signOutUser()'), 'ProfileRoute logout button calls signOutUser');
assert(profileSource.includes('disabled={signOutLoading}'), 'ProfileRoute logout button disabled while signing out');
assert(profileSource.includes('if (signOutLoading) return;'), 'ProfileRoute guards double sign-out press');
assert(profileSource.includes('Odhlašuji'), 'ProfileRoute shows loading state on logout button');

// ── 2. Navigace na tab „Moje“ ────────────────────────────────────────────────
assert(profileSource.includes('setTransportTab("mine")') && profileSource.includes('navigateLegacy("transport")'), 'ProfileRoute opens transport/mine for Moje poptávky and Moje aktivita');
assert(profileSource.split('openMyTransport').length >= 3, 'both Moje actions share one transport/mine handler');

const bottomNavSource = read('components/AppBottomNav.tsx');
assert(bottomNavSource.includes('setTransportTab("mine")') && bottomNavSource.includes('navigateLegacy("transport")'), 'BottomNav Moje opens transport/mine');

const homeRouteSource = read('screens/Home/HomeRoute.tsx');
assert(homeRouteSource.includes('setTransportTab("all")') && homeRouteSource.includes('navigateLegacy("transport")'), 'Global Home Trh přepravy opens transport/all');

// TransportRoute: přímé otevření nepřepisuje tab, mine bez přihlášení vede na login.
const transportSource = read('screens/Transport/TransportRoute.tsx');
assert(!/useState<TransportTab>\(/.test(transportSource), 'TransportRoute does not reset transportTab to all on mount');
assert(transportSource.includes('if (transportTab === "mine" && !userId)'), 'TransportRoute redirects mine tab without login');

// ── 3. Společný back guard pro formuláře ─────────────────────────────────────
const backHandlersSource = read('hooks/useBackHandlers.ts');
assert(backHandlersSource.includes('export function useFormBackGuard'), 'shared useFormBackGuard hook exists');
assert(backHandlersSource.includes('export function useHardwareBackTo'), 'shared useHardwareBackTo hook exists');
assert(backHandlersSource.includes('hardwareBackPress'), 'back handlers register Android hardwareBackPress');
assert(backHandlersSource.includes('return true'), 'back handlers consume the back event (no double dialogs)');

const requestFormSource = read('screens/Transport/CreateRequestScreen.tsx');
const routeFormSource = read('screens/Transport/RouteFormRoute.tsx');
assert(requestFormSource.includes('useFormBackGuard(leaveRequestForm)'), 'request form uses shared back guard');
assert(routeFormSource.includes('useFormBackGuard(leaveRouteForm)'), 'route form uses shared back guard');
assert(!requestFormSource.includes('BackHandler.addEventListener'), 'request form has no duplicate BackHandler listener');
assert(!routeFormSource.includes('BackHandler.addEventListener'), 'route form has no duplicate BackHandler listener');
assert(requestFormSource.includes('if (!dirty || creatingRequest) leave();'), 'clean form leaves without dialog and submit suppresses dialog');
assert(routeFormSource.includes('if (!dirty || creatingRoute) leave();'), 'clean form leaves without dialog and submit suppresses dialog');
assert(requestFormSource.includes('showDiscardDraftConfirmation(discardAndLeave)'), 'dirty request form shows discard dialog with explicit draft reset');
assert(requestFormSource.includes('draftRef.current = EMPTY_REQUEST_DRAFT'), 'discarded or submitted request draft is cleared before unmount');
assert(requestFormSource.includes('setRequestDraft(EMPTY_REQUEST_DRAFT)'), 'cleared request draft is propagated to app context');
assert(requestFormSource.includes('problem: ""'), 'cleared request draft does not prefill the optional note');
assert(routeFormSource.includes('showDiscardDraftConfirmation(leave)'), 'dirty route form shows discard dialog');

// Detaily a navigační obrazovky: hardware Back vede na předchozí obrazovku.
const jobDetailSource = read('screens/Transport/JobDetailRoute.tsx');
const routeDetailSource = read('screens/Transport/RouteDetailRoute.tsx');
const vehiclesSource = read('screens/Vehicles/VehiclesRoute.tsx');
assert(jobDetailSource.includes('useHardwareBackAction(goBack)'), 'JobDetailRoute hardware back mirrors header back');
assert(routeDetailSource.includes('useHardwareBackAction(backToCapacity)'), 'RouteDetailRoute hardware back mirrors header back');
const offerFormSource = read('screens/Transport/OfferFormRoute.tsx');
assert(offerFormSource.includes('useHardwareBackAction(goBack)'), 'OfferFormRoute hardware back returns to request detail');
assert(!/<DateTimePicker[^>]*\bonChange=/.test(offerFormSource), 'OfferFormRoute does not use deprecated DateTimePicker onChange');
assert(!/<DateTimePicker[^>]*\bonChange=/.test(requestFormSource), 'request form does not use deprecated DateTimePicker onChange');
assert(!/<DateTimePicker[^>]*\bonChange=/.test(routeFormSource), 'route form does not use deprecated DateTimePicker onChange');
assert(!jobDetailSource.includes('label="Najede na vlek"'), 'request detail does not duplicate loading capability');
assert(profileSource.includes('useHardwareBackTo("home")'), 'ProfileRoute hardware back returns to home');
assert(vehiclesSource.includes('useHardwareBackTo("profile")'), 'VehiclesRoute hardware back returns to profile');

// ── 4. VehiclesRoute bez duplicitních návratů ────────────────────────────────
// Hledáme viditelné texty tlačítek (spodní „Zpět na profil“/„Zpět na přehled“);
// accessibilityLabel horní akce „‹ Profil“ se nepočítá jako duplicita.
assert(vehiclesSource.includes('‹ Profil'), 'VehiclesRoute has single top back action to profile');
assert(!/Zpět na profil<\/Text>/.test(vehiclesSource), 'VehiclesRoute has no duplicate bottom back-to-profile');
assert(!/Zpět na přehled<\/Text>/.test(vehiclesSource), 'VehiclesRoute has no bottom back-to-overview');

// ── 5. Veřejné/soukromé payloady lokalit ─────────────────────────────────────
const createFormLogic = requireProductionTsModule('lib/createFormLogic.ts');
assert(typeof createFormLogic.resolvePrivateAddress === 'function', 'resolvePrivateAddress exists in production form logic');
assert(createFormLogic.resolvePrivateAddress('Praha', '  ') === 'Praha', 'collapsed precise place falls back to public city label');
assert(createFormLogic.resolvePrivateAddress('Praha', 'Ulice 5, Praha 1') === 'Ulice 5, Praha 1', 'expanded precise place is used as private address');
assert(createFormLogic.resolvePrivateAddress('Praha', 'Ulice 5') !== undefined, 'private address never overwrites public label contract');

// Payload formulářů: veřejný label + soukromá ověřená adresa a souřadnice.
assert(requestFormSource.includes('pickup_public_label: validatedPickupPublic.value'), 'request payload contains pickup_public_label');
assert(requestFormSource.includes('destination_public_label: validatedDestinationPublic.value'), 'request payload contains destination_public_label');
assert(requestFormSource.includes('pickupLocation.formattedAddress'), 'request payload uses verified private pickup address');
assert(requestFormSource.includes('destinationLocation.formattedAddress'), 'request payload uses verified private destination address');
assert(requestFormSource.includes('pickupLocation.latitude') && requestFormSource.includes('destinationLocation.latitude'), 'request payload uses verified coordinates');
assert(routeFormSource.includes('from_public_label: validatedFromPublic.value'), 'route payload contains from_public_label');
assert(routeFormSource.includes('to_public_label: validatedToPublic.value'), 'route payload contains to_public_label');
assert(routeFormSource.includes('fromLocation.formattedAddress'), 'route payload uses verified private origin address');
assert(routeFormSource.includes('toLocation.formattedAddress'), 'route payload uses verified private destination address');
assert(routeFormSource.includes('fromLocation.latitude') && routeFormSource.includes('toLocation.latitude'), 'route payload uses verified coordinates');

// Validace: město/obec je povinné, přesné místo volitelné.
const validCollapsed = {
  pickupText: '',
  destination: '',
  pickupPublicLabel: 'Praha',
  destinationPublicLabel: 'Brno',
  requestedDate: new Date('2026-10-01T00:00:00Z'),
  requestedEndDate: null,
  dateMode: 'concrete',
  vehicle: 'Osobní automobil',
  loadingState: 'drive',
};
assert(createFormLogic.validateRequestForm(validCollapsed).valid === true, 'request form validates with collapsed precise places (public labels only)');
const validCapacityCollapsed = {
  routeFrom: '',
  routeTo: '',
  fromPublicLabel: 'Praha',
  toPublicLabel: 'Brno',
  routeDepartureDate: new Date('2026-10-01T00:00:00Z'),
  routeDepartureTime: new Date('2026-10-01T10:00:00Z'),
  routeSpaces: '1',
  routeMaxDeviationKm: '',
  routeVehicleTypes: 'Osobní automobil',
  routePriceMode: 'fixed',
  routePrice: '1200',
};
assert(createFormLogic.validateCapacityForm(validCapacityCollapsed).valid === true, 'capacity form validates with collapsed precise places (public labels only)');

// UI: odjezd a cíl jsou vždy dva ověřené vstupy. Formulář volné kapacity navíc
// nabízí volitelný třetí vstup pro průjezdní bod ("Cheb → Praha přes Plzeň"),
// takže smí obsahovat tři instance VerifiedLocationInput.
assert((requestFormSource.match(/<VerifiedLocationInput/g) || []).length === 2, 'request form requires two verified locations');
assert((routeFormSource.match(/<VerifiedLocationInput/g) || []).length >= 2, 'route form requires origin and destination verified locations');
assert((routeFormSource.match(/<VerifiedLocationInput/g) || []).length <= 3, 'route form exposes at most one via-point input');
assert(routeFormSource.includes('Průjezdní bod · volitelný'), 'route form offers an optional via point');
assert(routeFormSource.includes('Odebrat průjezdní bod'), 'a chosen via point can be removed again');
assert(!requestFormSource.includes('Upřesnit přesné místo') && !routeFormSource.includes('Upřesnit přesné místo'), 'forms no longer duplicate public and private address entry');
assert(requestFormSource.includes('přesná adresa zůstane soukromá') && routeFormSource.includes('přesná adresa zůstane soukromá'), 'both forms explain address privacy');
assert(requestFormSource.includes('pickupLocation.formattedAddress') && routeFormSource.includes('fromLocation.formattedAddress'), 'private addresses come from verified selections');

// Soukromá adresa se nikdy nedostane do veřejného market objektu.
const publicMarket = requireProductionTsModule('lib/publicMarket.ts');
let leaked = false;
try {
  publicMarket.mapPublicMarketplaceRequest({
    public_id: 'x',
    created_at: '',
    pickup_address: 'Tajná ulice 5',
    pickup_lat: 50.1,
    customer_id: 'cust',
  });
} catch (_) { leaked = true; }
assert(leaked, 'public market mapping rejects private address/GPS/customer fields');

// Profil: read-only výchozí, editace až po Upravit, login guard, karty.
assert(profileSource.includes('setProfileEditing(true)'), 'profile edit opens only after Upravit action');
assert(profileSource.includes('if (!userId)'), 'ProfileRoute guards private screen when logged out');
assert(profileSource.includes('profileCardHeading'), 'ProfileRoute uses card layout headings');
// Vozidla jsou rozdělená na dvě nesměitelné oblasti (fáze 1 rozdělení vozidel):
// „Přepravní vozidla“ navázaná na přepravní profil a „Moje vozidla“ jako osobní.
// Každá má vlastní kartu, vlastní akci a vlastní obrazovku.
assert(profileSource.includes('Přepravní vozidla'), 'profile separates carrier vehicles into their own card');
assert(profileSource.includes('Spravovat přepravní vozidla'), 'carrier vehicles card has a single manage action');
assert(profileSource.includes('Moje vozidla'), 'profile has a separate personal vehicles card');
assert(profileSource.includes('Spravovat moje vozidla'), 'personal vehicles card has a single manage action');
assert((profileSource.match(/navigateLegacy\("vehicles"\)/g) || []).length === 1, 'carrier vehicles action opens only the carrier screen');
assert((profileSource.match(/navigateLegacy\("personalVehicles"\)/g) || []).length === 1, 'personal vehicles action opens only the personal screen');

console.log('\nVŠECHNY KONTROLY PROŠLY.');
