const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function requireProductionTsModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const {
  mapCarrierProfileToFormFields,
  parseVehicleNumericFields,
  buildVehiclePayload,
  parseCarrierProfilePublicContact,
} = requireProductionTsModule('lib/profileFormLogic.ts');

let failures = 0;
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}

assertEqual(
  mapCarrierProfileToFormFields({
    display_name: null,
    business_type: null,
    company_name: "Auto Sergej s.r.o.",
    ico: "12345678",
    description: null,
    service_area: "Ostrava",
    max_radius_km: 100.5,
    years_experience: null,
    available_24_7: true,
    phone_public: null,
    email_public: null,
    public_phone: "+420 777 123 456",
    public_email: "a@b.cz",
  }),
  {
    displayName: "",
    businessType: "individual",
    companyName: "Auto Sergej s.r.o.",
    ico: "12345678",
    description: "",
    serviceArea: "Ostrava",
    maxRadius: "100.5",
    yearsExperience: "",
    available247: true,
    phonePublic: true,
    emailPublic: false,
    publicPhone: "+420 777 123 456",
    publicEmail: "a@b.cz",
  },
  "1 mapCarrierProfileToFormFields imports production helper"
);

assertEqual(
  parseVehicleNumericFields({ year: "2020", maxWeight: "3500", maxLength: "500", maxWidth: "200", maxHeight: "180", capacity: "2" }),
  { year: 2020, maxWeight: 3500, maxLength: 500, maxWidth: 200, maxHeight: 180, capacity: 2, allValid: true },
  "2a parseVehicleNumericFields valid"
);
assertEqual(
  parseVehicleNumericFields({ year: "", maxWeight: "  ", maxLength: "", maxWidth: "", maxHeight: "", capacity: "" }),
  { year: null, maxWeight: null, maxLength: null, maxWidth: null, maxHeight: null, capacity: null, allValid: true },
  "2b parseVehicleNumericFields empty"
);
assertEqual(
  parseVehicleNumericFields({ year: "abc", maxWeight: "3500", maxLength: "500", maxWidth: "200", maxHeight: "180", capacity: "xyz" }),
  { year: NaN, maxWeight: 3500, maxLength: 500, maxWidth: 200, maxHeight: 180, capacity: NaN, allValid: false },
  "2c parseVehicleNumericFields invalid year keeps capacity quirk"
);
assertEqual(
  parseVehicleNumericFields({ year: "2020", maxWeight: "3500", maxLength: "500", maxWidth: "200", maxHeight: "abc", capacity: "xyz" }),
  { year: 2020, maxWeight: 3500, maxLength: 500, maxWidth: 200, maxHeight: NaN, capacity: NaN, allValid: false },
  "2d parseVehicleNumericFields invalid dimension"
);

assertEqual(
  buildVehiclePayload({
    name: "  Poskyz Vlečák  ", type: "  rampa ", make: "Ford", model: "", year: "2019", registrationNumber: " ",
    maxWeight: "3000", maxLength: "480", maxWidth: "190", maxHeight: "170", capacity: "1", description: "  Rampa + naviják. ",
    hasWinch: true, hasHydraulicPlatform: false, hasRamps: true, hasStraps: false, hasJumpStarter: false, hasCompressor: true, isActive: true,
  }),
  {
    name: "Poskyz Vlečák", vehicle_type: "rampa", make: "Ford", model: null, year: 2019, registration_number: null,
    max_weight_kg: 3000, max_vehicle_length_cm: 480, max_vehicle_width_cm: 190, max_vehicle_height_cm: 170, capacity: 1,
    description: "Rampa + naviják.", has_winch: true, has_hydraulic_platform: false, has_ramps: true, has_straps: false,
    has_jump_starter: false, has_compressor: true, is_active: true,
  },
  "3 buildVehiclePayload imports production helper"
);

assertEqual(
  parseCarrierProfilePublicContact("150", "5", " +420 777 111 222 ", "  Prefs@Example.COM "),
  { maxRadius: 150, yearsExperience: 5, publicPhone: "+420 777 111 222", publicEmail: "prefs@example.com", numbersValid: true, emailValid: true },
  "4a parseCarrierProfilePublicContact valid"
);
assertEqual(
  parseCarrierProfilePublicContact("", "", "  ", ""),
  { maxRadius: null, yearsExperience: null, publicPhone: null, publicEmail: null, numbersValid: true, emailValid: true },
  "4b parseCarrierProfilePublicContact empty"
);
assertEqual(
  parseCarrierProfilePublicContact("abc", "5", "", ""),
  { maxRadius: NaN, yearsExperience: 5, publicPhone: null, publicEmail: null, numbersValid: false, emailValid: true },
  "4c parseCarrierProfilePublicContact invalid number"
);
assertEqual(
  parseCarrierProfilePublicContact("150", "5", "", "ne-platny-email"),
  { maxRadius: 150, yearsExperience: 5, publicPhone: null, publicEmail: "ne-platny-email", numbersValid: true, emailValid: false },
  "4d parseCarrierProfilePublicContact invalid email"
);

const RESET_CONTRACT = ["profile", "carrierProfile", "vehicles", "profileEditing", "carrierProfileEditing", "vehicleEditing", "editingVehicleId"];
assertEqual(RESET_CONTRACT.length, 7, "5a resetProfileData contract count");
assertEqual(RESET_CONTRACT.filter((key) => ["profile", "carrierProfile", "vehicles", "profileEditing", "carrierProfileEditing", "vehicleEditing", "editingVehicleId"].includes(key)), RESET_CONTRACT, "5b resetProfileData contract keys");

console.log("");
if (failures === 0) console.log("ALL PROFILE & VEHICLE REGRESSION TESTS PASSED");
else { console.error(`${failures} PROFILE/VEHICLE REGRESSION TEST(S) FAILED`); process.exit(1); }
