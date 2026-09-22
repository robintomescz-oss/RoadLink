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
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeDepartureTime: null }).firstInvalid, 'departure');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeSpaces: '0' }).firstInvalid, 'capacity');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeMaxDeviationKm: '-1' }).firstInvalid, 'capacity');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routeVehicleTypes: '' }).firstInvalid, 'vehicle');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routePrice: '' }).firstInvalid, 'price');
assert.strictEqual(validateCapacityForm({ ...validCapacity, routePriceMode: 'negotiable', routePrice: '' }).valid, true);
assert.strictEqual(validateCapacityForm({ ...validCapacity, routePriceMode: 'negotiable', routePrice: 'abc' }).firstInvalid, 'price');

const reqSnap = requestSnapshot({ pickupText: '', destination: '', vehicle: 'Osobní automobil', problem: 'Porucha', requestedDate: null, requestedEndDate: null, dateMode: 'concrete', loadingState: 'drive', requestVehicleModel: '' });
assert.strictEqual(reqSnap, requestSnapshot({ pickupText: '', destination: '', vehicle: 'Osobní automobil', problem: 'Porucha', requestedDate: null, requestedEndDate: null, dateMode: 'concrete', loadingState: 'drive', requestVehicleModel: '' }));
assert.notStrictEqual(reqSnap, requestSnapshot({ pickupText: 'Praha', destination: '', vehicle: 'Osobní automobil', problem: 'Porucha', requestedDate: null, requestedEndDate: null, dateMode: 'concrete', loadingState: 'drive', requestVehicleModel: '' }));

const capSnap = capacitySnapshot({ routeFrom: '', routeTo: '', routeDepartureDate: null, routeDepartureTime: null, routeSpaces: '1', routeMaxDeviationKm: '', routeVehicleTypes: 'Osobní automobil', routePrice: '', routePriceMode: 'fixed', routeDescription: '' });
assert.notStrictEqual(capSnap, capacitySnapshot({ routeFrom: '', routeTo: 'Brno', routeDepartureDate: null, routeDepartureTime: null, routeSpaces: '1', routeMaxDeviationKm: '', routeVehicleTypes: 'Osobní automobil', routePrice: '', routePriceMode: 'fixed', routeDescription: '' }));

console.log('FORM TESTS PASSED');
