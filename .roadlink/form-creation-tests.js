const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'createFormLogic.ts');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/import type \{[^}]+\} from "\.\/types";\n/, '');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
const localRequire = (request) => {
  if (request === './publicMarket') {
    const publicSourcePath = path.join(__dirname, '..', 'lib', 'publicMarket.ts');
    const publicSource = fs.readFileSync(publicSourcePath, 'utf8');
    const publicJs = ts.transpileModule(publicSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const publicMod = { exports: {} };
    new Function('exports', 'module', 'require', publicJs)(publicMod.exports, publicMod, require);
    return publicMod.exports;
  }
  return require(request);
};
new Function('exports', 'module', 'require', js)(mod.exports, mod, localRequire);
const {
  loadingOptionToFields,
  fieldsToLoadingOption,
  validateRequestForm,
  validateCapacityForm,
  requestSnapshot,
  capacitySnapshot,
  normalizeViaPlaces,
  MAX_VIA_PLACES,
} = mod.exports;

function date(iso) { return new Date(iso); }

assert.deepStrictEqual(loadingOptionToFields('drive'), {
  option: 'drive',
  label: 'Najede vlastní silou',
  description: 'Vozidlo je pojízdné a může samo najet na přepravník.',
  vehicle_mobility: 'drivable',
  can_drive_onto_trailer: true,
});
assert.strictEqual(loadingOptionToFields('winch').vehicle_mobility, 'not_drivable');
assert.strictEqual(loadingOptionToFields('winch').can_drive_onto_trailer, false);
assert.strictEqual(loadingOptionToFields('special').vehicle_mobility, 'partially_drivable');
assert.strictEqual(loadingOptionToFields('unknown').can_drive_onto_trailer, null);
assert.strictEqual(fieldsToLoadingOption('drivable', true), 'drive');
assert.strictEqual(fieldsToLoadingOption('not_drivable', false), 'winch');
assert.strictEqual(fieldsToLoadingOption('partially_drivable', false), 'special');
assert.strictEqual(fieldsToLoadingOption('unknown', null), 'unknown');

const validRequest = {
  pickupText: 'Praha',
  destination: 'Brno',
  requestedDate: date('2026-10-01T00:00:00Z'),
  requestedEndDate: null,
  dateMode: 'concrete',
  vehicle: 'Osobní automobil',
  loadingState: 'drive',
};
assert.strictEqual(validateRequestForm(validRequest).valid, true);
assert.strictEqual(validateRequestForm({ ...validRequest, pickupText: '' }).firstInvalid, 'route');
assert.strictEqual(validateRequestForm({ ...validRequest, requestedDate: null }).firstInvalid, 'date');
assert.strictEqual(validateRequestForm({ ...validRequest, vehicle: '' }).firstInvalid, 'vehicle');
assert.strictEqual(validateRequestForm({ ...validRequest, loadingState: null }).firstInvalid, 'loading');
assert.strictEqual(validateRequestForm({ ...validRequest, dateMode: 'window', requestedEndDate: null }).valid, false);
assert.strictEqual(validateRequestForm({ ...validRequest, dateMode: 'window', requestedEndDate: date('2026-09-30T00:00:00Z') }).firstInvalid, 'date');
assert.strictEqual(validateRequestForm({ ...validRequest, dateMode: 'window', requestedEndDate: date('2026-10-02T00:00:00Z') }).valid, true);

const validCapacity = {
  routeFrom: 'Praha',
  routeTo: 'Brno',
  routeDepartureDate: date('2026-10-01T00:00:00Z'),
  routeDepartureTime: date('2026-10-01T10:00:00Z'),
  routeSpaces: '1',
  routeMaxDeviationKm: '',
  routeVehicleTypes: 'Osobní automobil',
  routePriceMode: 'fixed',
  routePrice: '1200',
};
assert.strictEqual(validateCapacityForm(validCapacity).valid, true);
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeTo: '' }).firstInvalid, 'route');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeDepartureDate: null }).firstInvalid, 'departure');
// Čas odjezdu je volitelný: datum stačí, chybějící čas nesmí blokovat odeslání.
assert.strictEqual(
  validateCapacityForm({ ...validCapacity, routeDepartureTime: null }).valid,
  true,
  'a missing departure time is allowed when the date is set',
);
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeSpaces: '0' }).firstInvalid, 'capacity');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeVehicleTypes: '' }).firstInvalid, 'vehicle');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routePrice: '' }).firstInvalid, 'price');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routePriceMode: 'negotiable', routePrice: '' }).valid, true);
assert.strictEqual(validateCapacityForm({ ...validCapacity, routePriceMode: 'negotiable', routePrice: 'abc' }).firstInvalid, 'price');

const reqSnap = requestSnapshot({ pickupText: '', destination: '', vehicle: 'Osobní automobil', problem: 'Porucha', requestedDate: null, requestedEndDate: null, dateMode: 'concrete', loadingState: 'drive', requestVehicleModel: '' });
assert.strictEqual(reqSnap, requestSnapshot({ pickupText: '', destination: '', vehicle: 'Osobní automobil', problem: 'Porucha', requestedDate: null, requestedEndDate: null, dateMode: 'concrete', loadingState: 'drive', requestVehicleModel: '' }));
assert.notStrictEqual(reqSnap, requestSnapshot({ pickupText: 'Praha', destination: '', vehicle: 'Osobní automobil', problem: 'Porucha', requestedDate: null, requestedEndDate: null, dateMode: 'concrete', loadingState: 'drive', requestVehicleModel: '' }));

const capSnap = capacitySnapshot({ routeFrom: '', routeTo: '', routeDepartureDate: null, routeDepartureTime: null, routeSpaces: '1', routeVehicleTypes: 'Osobní automobil', routePrice: '', routePriceMode: 'fixed', routeDescription: '' });
assert.notStrictEqual(capSnap, capacitySnapshot({ routeFrom: '', routeTo: 'Brno', routeDepartureDate: null, routeDepartureTime: null, routeSpaces: '1', routeVehicleTypes: 'Osobní automobil', routePrice: '', routePriceMode: 'fixed', routeDescription: '' }));

// ── Průjezdní body (via) ──────────────────────────────────────────────────
assert.strictEqual(MAX_VIA_PLACES, 3, 'the via limit is three points');

const viaNone = normalizeViaPlaces({ viaPlaces: [] });
assert.deepStrictEqual(viaNone, [], 'no via points is valid and normalizes to an empty list');

const viaOne = normalizeViaPlaces({ viaPlaces: [{ placeId: ' ChIJplzen ', publicLabel: ' Plzeň-město ' }] });
assert.deepStrictEqual(viaOne, [{ placeId: 'ChIJplzen', publicLabel: 'Plzeň-město' }], 'a single via point is trimmed and kept');

const viaThree = normalizeViaPlaces({
  viaPlaces: [
    { placeId: 'a1', publicLabel: 'A' },
    { placeId: 'b2', publicLabel: 'B' },
    { placeId: 'c3', publicLabel: 'C' },
  ],
});
assert.strictEqual(viaThree.length, 3, 'three via points are allowed');

assert.strictEqual(
  normalizeViaPlaces({
    viaPlaces: [{ placeId: 'a1', publicLabel: 'A' }, { placeId: 'b2', publicLabel: 'B' }, { placeId: 'c3', publicLabel: 'C' }, { placeId: 'd4', publicLabel: 'D' }],
  }),
  null,
  'four via points are rejected',
);
assert.strictEqual(normalizeViaPlaces({ viaPlaces: [{ placeId: '', publicLabel: 'X' }] }), null, 'a via point without a place ID is rejected');
assert.strictEqual(normalizeViaPlaces({ viaPlaces: [{ placeId: 'a1', publicLabel: '  ' }] }), null, 'a via point without a public label is rejected');
assert.strictEqual(
  normalizeViaPlaces({ viaPlaces: [{ placeId: 'dup', publicLabel: 'A' }, { placeId: 'dup', publicLabel: 'B' }] }),
  null,
  'a duplicated via point is rejected',
);
assert.strictEqual(
  normalizeViaPlaces({ viaPlaces: [{ placeId: 'ChIJfrom', publicLabel: 'A' }], originPlaceId: 'ChIJfrom' }),
  null,
  'a via point identical to the origin is rejected',
);
assert.strictEqual(
  normalizeViaPlaces({ viaPlaces: [{ placeId: 'ChIJto', publicLabel: 'A' }], destinationPlaceId: 'ChIJto' }),
  null,
  'a via point identical to the destination is rejected',
);

// Cizí místa pro průjezd se neodmítají.
assert.deepStrictEqual(
  normalizeViaPlaces({ viaPlaces: [{ placeId: 'x', publicLabel: 'A' }], originPlaceId: 'other', destinationPlaceId: 'another' }),
  [{ placeId: 'x', publicLabel: 'A' }],
  'a via point distinct from origin and destination is kept',
);

console.log('FORM TESTS PASSED');
