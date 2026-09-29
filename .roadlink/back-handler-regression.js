/**
 * Regresní test Android hardware Back:
 *  - každá vnitřní obrazovka má handler (jinak navigateLegacy reset bez historie ukončí aplikaci),
 *  - handlery jdou přes jediný společný mechanizmus v hooks/useBackHandlers.ts,
 *  - listener se registruje při fokusu a má cleanup (žádné duplicitní listenery),
 *  - cíle navigace odpovídají horním tlačítkům ‹ Zpět,
 *  - formuláře si drží dirty-guard (odchod s rozepsanými daty se ptá).
 *
 * Společný hook se navíc spouští se stuby React/React Native/React Navigation,
 * takže se ověřuje skutečná registrace, návratová hodnota true i cleanup.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

// ── 1. Společný mechanizmus: registrace s fokusem + cleanup ─────────────────
const backHandlersSource = read('hooks/useBackHandlers.ts');
assert(backHandlersSource.includes('BackHandler.addEventListener("hardwareBackPress"'), 'shared hook registers Android hardwareBackPress');
assert(backHandlersSource.includes('useFocusEffect'), 'shared hook registers the listener only while the screen is focused');
assert(backHandlersSource.includes('subscription.remove()'), 'shared hook removes the listener on blur/unmount (cleanup)');
assert((backHandlersSource.match(/\}, \[\]\)/g) || []).length === 2, 'both shared hooks register exactly once (empty dependency array)');
assert(backHandlersSource.includes('return true'), 'registered handler consumes the event (no app exit, no double dialog)');
assert(backHandlersSource.includes('handlerRef.current = handler'), 'handler is read through a ref (no re-registration churn)');
assert(backHandlersSource.includes('leaveRef.current = leaveForm'), 'form leave function is read through a ref');
assert(!backHandlersSource.includes('goBack()'), 'shared hook does not hardcode navigation targets');

// ── 2. Runtime: registrace, cíl navigace a cleanup ──────────────────────────
function loadBackHandlersWithStubs() {
  const filename = path.join(root, 'hooks/useBackHandlers.ts');
  const output = ts.transpileModule(read('hooks/useBackHandlers.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;

  const listeners = [];
  const navigated = [];
  let focusEffectCleanup = null;

  const stubs = {
    react: {
      useCallback: (fn) => fn,
      useRef: (value) => ({ current: value }),
    },
    'react-native': {
      BackHandler: {
        addEventListener: (event, handler) => {
          const record = { event, handler, removed: 0 };
          listeners.push(record);
          return {
            remove: () => {
              const index = listeners.indexOf(record);
              if (index >= 0) listeners.splice(index, 1);
              record.removed += 1;
            },
          };
        },
      },
    },
    '@react-navigation/native': {
      useFocusEffect: (callback) => { focusEffectCleanup = callback(); },
    },
    '../navigation/navigationRef': {
      navigateLegacy: (name) => { navigated.push(name); },
    },
  };

  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return require(request);
  };

  const module = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    localRequire, module, module.exports, filename, path.dirname(filename)
  );

  return {
    hooks: module.exports,
    listeners,
    navigated,
    runFocusCleanup: () => {
      const cleanup = focusEffectCleanup;
      focusEffectCleanup = null;
      if (typeof cleanup === 'function') cleanup();
    },
  };
}

// useHardwareBackAction: zaregistruje, spotřebuje událost a uklidí.
{
  const env = loadBackHandlersWithStubs();
  let calls = 0;
  env.hooks.useHardwareBackAction(() => { calls += 1; });
  assert(env.listeners.length === 1, 'useHardwareBackAction registers exactly one listener');
  assert(env.listeners[0].event === 'hardwareBackPress', 'listener is bound to hardwareBackPress');
  assert(env.listeners[0].handler() === true, 'hardware back is consumed (app does not exit)');
  assert(calls === 1, 'hardware back runs the supplied target action');
  env.runFocusCleanup();
  assert(env.listeners.length === 0, 'focus cleanup removes the listener (no leak)');
  assert(env.listeners[0] === undefined && calls === 1, 'cleanup does not re-run the action');
}

// useHardwareBackTo: cíl se předá navigateLegacy a uklidí se.
{
  const env = loadBackHandlersWithStubs();
  env.hooks.useHardwareBackTo('home');
  assert(env.listeners.length === 1, 'useHardwareBackTo registers one listener');
  env.listeners[0].handler();
  assert(env.navigated.length === 1 && env.navigated[0] === 'home', 'useHardwareBackTo navigates to the expected screen');
  env.runFocusCleanup();
  assert(env.listeners.length === 0, 'useHardwareBackTo cleans up on blur');
}

// Dvě obrazovky = dva listenery; cleanup jedné nechá druhou být.
{
  const env = loadBackHandlersWithStubs();
  env.hooks.useHardwareBackTo('home');
  const second = env.listeners.length;
  env.hooks.useHardwareBackTo('transport');
  assert(second === 1 && env.listeners.length === 2, 'each focused screen owns its own listener');
  env.navigated.length = 0;
  env.listeners[1].handler();
  assert(env.navigated.join(',') === 'transport', 'only the last registered handler runs its own target');
}

// useFormBackGuard: registruje leave funkci a vrací true.
{
  const env = loadBackHandlersWithStubs();
  let left = 0;
  env.hooks.useFormBackGuard(() => { left += 1; });
  assert(env.listeners.length === 1, 'useFormBackGuard registers one listener');
  assert(env.listeners[0].handler() === true, 'form guard consumes hardware back');
  assert(left === 1, 'form guard calls the leave function (which decides about the discard dialog)');
  env.runFocusCleanup();
  assert(env.listeners.length === 0, 'form guard cleans up on blur');
}

// ── 3. Každá vnitřní obrazovka má handler přes společný hook ────────────────
const screenExpectations = [
  { file: 'screens/Transport/TransportRoute.tsx', usage: 'useHardwareBackTo("home")', target: 'Přehled (home)' },
  { file: 'screens/Transport/TrackingRoute.tsx', usage: 'useHardwareBackAction(goBack)', target: 'trh přepravy dle requestViewMode' },
  { file: 'screens/Vehicles/VehicleFormRoute.tsx', usage: 'useHardwareBackAction(goBack)', target: 'vozidla' },
  { file: 'screens/Transport/ProviderProfileRoute.tsx', usage: 'useHardwareBackAction(goBack)', target: 'detail poptávky nebo trh přepravy' },
  { file: 'screens/Transport/RequestSuccessRoute.tsx', usage: 'useHardwareBackAction(showMyRequests)', target: 'trh přepravy, tab Moje' },
  { file: 'screens/Sos/SosRoute.tsx', usage: 'useHardwareBackTo("home")', target: 'Přehled (home)' },
  { file: 'screens/Auth/LoginScreen.tsx', usage: 'useHardwareBackTo("home")', target: 'Přehled (home)' },
  { file: 'screens/Auth/SignupScreen.tsx', usage: 'useHardwareBackTo("home")', target: 'Přehled (home)' },
];

for (const expectation of screenExpectations) {
  const source = read(expectation.file);
  const name = expectation.file.split('/').pop();
  assert(source.includes(expectation.usage), `${name} registers hardware back → ${expectation.target}`);
  assert(source.includes('from "../../hooks/useBackHandlers"'), `${name} uses the shared back-handler module`);
  assert(!source.includes('BackHandler.addEventListener'), `${name} has no duplicate raw BackHandler listener`);
  assert(!source.includes('BackHandler.removeEventListener'), `${name} does not mix manual listener APIs`);
  assert((source.match(/useHardwareBack(To|Action)\(/g) || []).length === 1, `${name} registers exactly one back handler`);
  assert(source.includes('useFormBackGuard') || !source.includes('dirty'), `${name} does not bypass the shared form guard`);
}

// Cíle u obrazovek, kde se cíl odvozuje z kontextu.
const trackingSource = read('screens/Transport/TrackingRoute.tsx');
assert(trackingSource.includes('setTransportTab(requestViewMode === "owner" ? "mine" : "requests")'), 'TrackingRoute back mirrors the header back target');
assert(trackingSource.includes('navigateLegacy("transport")'), 'TrackingRoute back returns to the transport screen');
const vehicleFormSource = read('screens/Vehicles/VehicleFormRoute.tsx');
assert(vehicleFormSource.includes('const goBack = () => navigateLegacy("vehicles")'), 'VehicleFormRoute back target is vehicles');
assert(vehicleFormSource.includes('onPress={goBack}'), 'VehicleFormRoute back button and hardware back share one function');
const providerProfileSource = read('screens/Transport/ProviderProfileRoute.tsx');
assert(providerProfileSource.includes('navigateLegacy(activeJob ? "job" : "transport")'), 'ProviderProfileRoute back prefers job detail with a valid context and falls back to transport');
assert(providerProfileSource.includes('onBack={goBack}'), 'ProviderProfileRoute header back and hardware back share one function');
assert(!providerProfileSource.includes('new RegExp'), 'ProviderProfileRoute has no parallel navigation logic');
const requestSuccessSource = read('screens/Transport/RequestSuccessRoute.tsx');
assert(requestSuccessSource.includes('setTransportTab("mine")') && requestSuccessSource.includes('navigateLegacy("transport")'), 'RequestSuccessRoute hardware back opens transport/mine');
assert(requestSuccessSource.includes('onShowRequests={showMyRequests}'), 'RequestSuccessRoute button and hardware back share one function');
const transportSource = read('screens/Transport/TransportRoute.tsx');
assert(!transportSource.includes('navigateLegacy("transport")'), 'TransportRoute back does not loop back to itself');

// ── 4. Formuláře: dirty-guard zůstává ───────────────────────────────────────
const createRequestSource = read('screens/Transport/CreateRequestScreen.tsx');
const routeFormSource = read('screens/Transport/RouteFormRoute.tsx');
assert(createRequestSource.includes('useFormBackGuard(leaveRequestForm)'), 'request form still uses the shared dirty-form guard');
assert(routeFormSource.includes('useFormBackGuard(leaveRouteForm)'), 'route form still uses the shared dirty-form guard');
assert(createRequestSource.includes('showDiscardDraftConfirmation(discardAndLeave)'), 'request form still asks before discarding a dirty draft');
assert(routeFormSource.includes('showDiscardDraftConfirmation(leave)'), 'route form still asks before discarding a dirty draft');
assert(!createRequestSource.includes('useHardwareBackAction') && !routeFormSource.includes('useHardwareBackAction'), 'forms are not switched to the plain back action');

// ── 5. Spodní navigace zůstává beze změny ───────────────────────────────────
const bottomNavSource = read('components/BottomNav.tsx');
assert(bottomNavSource.includes('{ key: "overview", label: "Přehled", icon: "dashboard" }'), 'bottom nav keeps Přehled with the dashboard icon');
assert(bottomNavSource.includes('{ key: "mine", label: "Moje", icon: "mine" }'), 'bottom nav keeps Moje unchanged');
assert(bottomNavSource.includes('{ key: "profile", label: "Profil", icon: "person" }'), 'bottom nav keeps Profil unchanged');
assert(!bottomNavSource.includes('"Domů"') && !bottomNavSource.includes('"home"'), 'bottom nav was not renamed to Domů');

console.log('\nALL HARDWARE BACK REGRESSION TESTS PASSED');
