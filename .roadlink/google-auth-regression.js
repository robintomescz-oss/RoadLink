/**
 * Regresní test Google přihlášení (OAuth přes Supabase, PKCE).
 *
 * Ověřuje:
 *  - konfiguraci, bez které tok nefunguje (flowType pkce, scheme, závislosti),
 *  - parsování návratové URL (code v query i fragmentu, chybová větev),
 *  - sestavení profilu z Google metadat (given_name/family_name/name/e-mail),
 *  - založení řádku v profiles jen když chybí (a chyby obou kroků),
 *  - celý tok signInWithGoogle (úspěch, zavření prohlížeče, chyby) se stuby.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}`);
  }
}
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}${a === e ? "" : `\n  expected: ${e}\n  actual:   ${a}`}`);
}

// ── 1. Statické kontroly konfigurace ────────────────────────────────────────
const supabaseClient = read("lib/supabase.ts");
assert(supabaseClient.includes('flowType: "pkce"'), "Supabase klient používá PKCE (bez něj callback neobsahuje code)");
assert(supabaseClient.includes("detectSessionInUrl: false"), "detectSessionInUrl zůstává vypnuté (nativní aplikace, ne web)");

const appJson = JSON.parse(read("app.json"));
assert(appJson.expo.scheme === "roadlink", "app.json má scheme pro deep link z prohlížeče");
assert(
  appJson.expo.plugins.some((plugin) => Array.isArray(plugin) ? plugin[0] === "expo-web-browser" : plugin === "expo-web-browser"),
  "expo-web-browser je v app.json pluginech"
);

const packageJson = JSON.parse(read("package.json"));
assert(Boolean(packageJson.dependencies["expo-web-browser"]), "expo-web-browser je závislost");
assert(Boolean(packageJson.dependencies["expo-auth-session"]), "expo-auth-session je závislost");

const loginScreen = read("screens/Auth/LoginScreen.tsx");
const signupScreen = read("screens/Auth/SignupScreen.tsx");
const authSession = read("hooks/useAuthSession.ts");
const googleAuth = read("lib/googleAuth.ts");
assert(loginScreen.includes("loginWithGoogle") && loginScreen.includes("Pokračovat přes Google"), "LoginScreen nabízí Google přihlášení");
assert(signupScreen.includes("loginWithGoogle") && signupScreen.includes("Registrovat přes Google"), "SignupScreen nabízí Google registraci");
assert(!loginScreen.includes("client_secret") && !signupScreen.includes("client_secret"), "obrazovky neobsahují žádný Google secret");
assert(!googleAuth.includes("client_secret") && !googleAuth.includes("GOOGLE_CLIENT"), "klientský kód neobsahuje Google client ID/secret (patří do Supabase)");
assert(authSession.includes('result.profile === "created"'), "po Google přihlášení se hlásí doplnění telefonu");
assert(authSession.includes("loginWithGoogle"), "useAuthSession vystavuje loginWithGoogle pro obě obrazovky");

// ── 2. Načtení produkčního modulu se stuby ──────────────────────────────────
function loadGoogleAuth(stubs) {
  const filename = path.join(root, "lib/googleAuth.ts");
  const output = ts.transpileModule(read("lib/googleAuth.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith("./") || request.startsWith("../")) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function("require", "module", "exports", "__filename", "__dirname", output)(
    localRequire, module, module.exports, filename, path.dirname(filename)
  );
  return module.exports;
}

function createSupabaseStub(options = {}) {
  const calls = { oauthArgs: null, exchangedCode: null, insertedRow: null, profileTable: null, openUrl: null };
  const stub = {
    auth: {
      signInWithOAuth: async (args) => {
        calls.oauthArgs = args;
        return options.oauth ?? { data: { url: "https://projekt.supabase.co/auth/v1/authorize?provider=google" }, error: null };
      },
      exchangeCodeForSession: async (code) => {
        calls.exchangedCode = code;
        return options.exchange ?? { data: { user: { id: "user-1" }, session: { user: { id: "user-1" } } }, error: null };
      },
    },
    from: (table) => {
      calls.profileTable = table;
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => options.profileLookup ?? { data: { id: "user-1" }, error: null } }),
        }),
        insert: async (row) => {
          calls.insertedRow = row;
          return options.insert ?? { error: null };
        },
      };
    },
  };
  return { stub, calls };
}

const redirectUri = "roadlink://auth/callback";
function createStubs(supabaseStub, browserResult) {
  const stubs = {
    "./supabase": { supabase: supabaseStub },
    "expo-auth-session": { makeRedirectUri: (args) => `${args.scheme}://${args.path}` },
    "expo-web-browser": {
      openAuthSessionAsync: async (url, redirectTo) => {
        stubs.__open = { url, redirectTo };
        return browserResult ?? { type: "success", url: `${redirectUri}?code=code-1` };
      },
    },
  };
  return stubs;
}

// ── 3. Parsování návratové URL ──────────────────────────────────────────────
const { parseOAuthRedirect, buildGoogleProfileSeed } = loadGoogleAuth(createStubs(createSupabaseStub().stub));

assertEqual(parseOAuthRedirect(`${redirectUri}?code=abc`).code, "abc", "query s code se rozparsuje");
assertEqual(parseOAuthRedirect(`${redirectUri}#code=xyz`).code, "xyz", "code ve fragmentu se rozparsuje i pro starší tok");
assertEqual(parseOAuthRedirect(`${redirectUri}?state=s&code=abc`).code, "abc", "code se najde i mezi dalšími parametry");
assertEqual(
  parseOAuthRedirect(`${redirectUri}?error=access_denied&error_description=User+denied`),
  { code: null, error: "access_denied", errorDescription: "User denied" },
  "chybová větev vrací error i popis"
);
assertEqual(parseOAuthRedirect(`${redirectUri}?state=jen-state`), { code: null, error: null, errorDescription: null }, "URL bez code nevypadá jako úspěch");
assertEqual(parseOAuthRedirect(""), { code: null, error: null, errorDescription: null }, "prázdná URL nespadne");

// ── 4. Profil z Google metadat ──────────────────────────────────────────────
assertEqual(
  buildGoogleProfileSeed({ email: "jan.novak@gmail.com", user_metadata: { given_name: "Jan", family_name: "Novák" } }),
  { first_name: "Jan", last_name: "Novák", phone: "", role: "customer" },
  "given_name/family_name se použijí přednostně"
);
assertEqual(
  buildGoogleProfileSeed({ email: "jan.novak@gmail.com", user_metadata: { name: "Jan Novák" } }),
  { first_name: "Jan", last_name: "Novák", phone: "", role: "customer" },
  "bez given_name se jméno rozdělí z name"
);
assertEqual(
  buildGoogleProfileSeed({ email: "jan.novak@gmail.com", user_metadata: { given_name: "Jan" } }).last_name,
  "",
  "jen given_name nechá příjmení prázdné (doplní ho uživatel)"
);
assertEqual(
  buildGoogleProfileSeed({ email: "jan.novak@gmail.com", user_metadata: {} }),
  { first_name: "jan novak", last_name: "", phone: "", role: "customer" },
  "bez metadat se použije e-mail a telefon zůstane k doplnění"
);
assertEqual(
  buildGoogleProfileSeed({ email: null, user_metadata: null }).first_name,
  "Uživatel",
  "když není jméno ani e-mail, profil má fallback jméno (insert nespadne na NOT NULL)"
);

// ── 5. Založení profilu ─────────────────────────────────────────────────────
(async () => {
  let { stub: supabaseStub, calls } = createSupabaseStub({ profileLookup: { data: { id: "user-1" }, error: null } });
  let googleAuthModule = loadGoogleAuth(createStubs(supabaseStub));
  assertEqual(await googleAuthModule.ensureProfileForUser({ id: "user-1", email: "a@b.cz", user_metadata: {} }), "exists", "existující profil se nezapisuje znovu");
  assert(calls.insertedRow === null, "u existujícího profilu se nevolá insert");

  ({ stub: supabaseStub, calls } = createSupabaseStub({ profileLookup: { data: null, error: null } }));
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub));
  assertEqual(
    await googleAuthModule.ensureProfileForUser({ id: "user-9", email: "petr@seznam.cz", user_metadata: { given_name: "Petr", family_name: "Svoboda" } }),
    "created",
    "chybějící profil se založí"
  );
  assertEqual(calls.profileTable, "profiles", "profil se zakládá v tabulce profiles");
  assertEqual(
    calls.insertedRow,
    { id: "user-9", first_name: "Petr", last_name: "Svoboda", phone: "", role: "customer" },
    "insert má id = auth.uid() a roli customer"
  );

  ({ stub: supabaseStub } = createSupabaseStub({ profileLookup: { data: null, error: { message: "boom" } } }));
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub));
  assertEqual(await googleAuthModule.ensureProfileForUser({ id: "user-1", email: null, user_metadata: null }), "failed", "chyba čtení profilu se hlásí jako failed");

  ({ stub: supabaseStub } = createSupabaseStub({ profileLookup: { data: null, error: null }, insert: { error: { message: "duplicate" } } }));
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub));
  assertEqual(await googleAuthModule.ensureProfileForUser({ id: "user-1", email: null, user_metadata: null }), "failed", "chyba insertu se hlásí jako failed");

  // ── 6. Celý tok signInWithGoogle ──────────────────────────────────────────
  ({ stub: supabaseStub, calls } = createSupabaseStub());
  let stubs = createStubs(supabaseStub);
  googleAuthModule = loadGoogleAuth(stubs);
  let result = await googleAuthModule.signInWithGoogle();
  assertEqual(stubs.__open.url, "https://projekt.supabase.co/auth/v1/authorize?provider=google", "prohlížeč otevírá URL ze Supabase");
  assertEqual(stubs.__open.redirectTo, redirectUri, "návratová URL míří na scheme roadlink a cestu auth/callback");
  assertEqual(calls.oauthArgs.provider, "google", "OAuth provider je google");
  assertEqual(calls.oauthArgs.options.skipBrowserRedirect, true, "přesměrování řeší aplikace, ne WebView");
  assertEqual(calls.oauthArgs.options.redirectTo, redirectUri, "Supabase dostává stejnou návratovou URL");
  assertEqual(calls.exchangedCode, "code-1", "code z callbacku se vyměňuje za session");
  assertEqual(result, { status: "success", userId: "user-1", profile: "exists" }, "úspěšné přihlášení vrací userId a stav profilu");

  ({ stub: supabaseStub } = createSupabaseStub());
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub, { type: "dismiss" }));
  assertEqual(await googleAuthModule.signInWithGoogle(), { status: "cancelled" }, "zavření prohlížeče není chyba");
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub, { type: "cancel" }));
  assertEqual(await googleAuthModule.signInWithGoogle(), { status: "cancelled" }, "zrušení v prohlížeči není chyba");

  ({ stub: supabaseStub, calls } = createSupabaseStub({ oauth: { data: null, error: { message: "provider disabled" } } }));
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub));
  assertEqual(await googleAuthModule.signInWithGoogle(), { status: "error", message: "provider disabled" }, "chyba ze Supabase se propaguje");

  ({ stub: supabaseStub } = createSupabaseStub());
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub, { type: "success", url: `${redirectUri}?error=access_denied&error_description=User+denied` }));
  assertEqual(await googleAuthModule.signInWithGoogle(), { status: "error", message: "User denied" }, "odmítnutí na Google se propaguje jako chyba");

  ({ stub: supabaseStub } = createSupabaseStub());
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub, { type: "success", url: `${redirectUri}?state=bez-code` }));
  assertEqual(
    await googleAuthModule.signInWithGoogle(),
    { status: "error", message: "V návratové adrese chybí přihlašovací kód." },
    "callback bez code se nevyhodnotí jako přihlášení"
  );

  ({ stub: supabaseStub } = createSupabaseStub({ exchange: { data: null, error: { message: "invalid request" } } }));
  googleAuthModule = loadGoogleAuth(createStubs(supabaseStub));
  assertEqual(await googleAuthModule.signInWithGoogle(), { status: "error", message: "invalid request" }, "chyba výměny code za session se propaguje");

  ({ stub: supabaseStub } = createSupabaseStub({
    exchange: { data: { user: { id: "user-2", email: "novy@email.cz", user_metadata: { name: "Nový Uživatel" } }, session: null }, error: null },
    profileLookup: { data: null, error: null },
  }));
  stubs = createStubs(supabaseStub);
  googleAuthModule = loadGoogleAuth(stubs);
  result = await googleAuthModule.signInWithGoogle();
  assertEqual(result, { status: "success", userId: "user-2", profile: "created" }, "první Google přihlášení založí profil");

  if (failures > 0) {
    console.error(`GOOGLE AUTH REGRESSION: ${failures} FAILED`);
    process.exit(1);
  }
  console.log("ALL GOOGLE AUTH TESTS PASSED");
})();
