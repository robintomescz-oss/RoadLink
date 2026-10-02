# Přihlášení a registrace přes Google

RoadLink umí vedle e-mailu a hesla i přihlášení/registraci Google účtem. Účty jsou
jeden typ (viz `ROADLINK_AGENT_RULES.md`) — Google je jen jiný způsob přihlášení
ke stejnému účtu, ne samostatný typ uživatele.

## Jak tok funguje

1. `signInWithGoogle()` (lib/googleAuth.ts) zavolá `supabase.auth.signInWithOAuth`
   s `skipBrowserRedirect: true` a získá adresu na Google.
2. Adresu otevře v systémovém prohlížeči přes `WebBrowser.openAuthSessionAsync`
   s návratovou URL `roadlink://auth/callback`.
3. Supabase vrátí do aplikace deep link s `code`, který se vymění přes
   `exchangeCodeForSession` za session (tok PKCE).
4. Uživatel z Google účtu ještě nemá řádek v `profiles` — `ensureProfileForUser`
   ho založí z Google metadat (jméno, příjmení) s prázdným telefonem.
   Telefon si uživatel doplní v obrazovce Profil.

## Co je hotové v repozitáři

| Soubor | Změna |
|---|---|
| `lib/supabase.ts` | `flowType: "pkce"` |
| `app.json` | `scheme: "roadlink"`, plugin `expo-web-browser` |
| `lib/googleAuth.ts` | celý OAuth tok, parsování callbacku, založení profilu |
| `hooks/useAuthSession.ts` | `loginWithGoogle` + `googleLoading` |
| `screens/Auth/LoginScreen.tsx`, `SignupScreen.tsx` | tlačítko „Pokračovat přes Google“ / „Registrovat přes Google“ |

## 1. Google Cloud Console

1. Vytvořte OAuth 2.0 Client ID typu **Web application**.
2. Authorized redirect URI:
   `https://<projekt-ref>.supabase.co/auth/v1/callback`
   (přesně tato adresa, ne adresa aplikace — Google se vrací do Supabase).
3. Poznamenejte si Client ID a Client secret.

## 2. Supabase dashboard

1. **Authentication → Providers → Google**: zapnout, vložit Client ID a Client secret.
2. **Authentication → URL Configuration → Redirect URLs**: přidat
   `roadlink://auth/callback` a pro vývoj `exp://**`
   (v Expo Go se hostitel i port mění, proto wildcard).
3. **Site URL** nastavit na produkční web RoadLinku.

## 3. Ověření

- Vývoj: `npm start`, na přihlášení zvolit „Pokračovat přes Google“.
- Zařízení: interní APK (`npm run build:preview:android`) — `scheme` se zapéká do
  nativního projektu, takže starý build bez schématu Google přihlášení nepodpoří.
- Kontrola: Supabase → Authentication → Users (nový uživatel) a Table Editor →
  `profiles` (nový řádek s prázdným telefonem).

## Bezpečnost

- Google Client secret patří výhradně do Supabase dashboardu. Nikdy do aplikace,
  `app.json` ani do EAS proměnných — klientský kód používá jen Supabase publishable key.
- Tokeny a session se neukládají do logů; chyby se logují bez obsahu odpovědi.

## Časté chyby

| Projev | Příčina |
|---|---|
| „V návratové adrese chybí přihlašovací kód.“ | `redirectTo` není v Redirect URLs v Supabase, nebo klient není v režimu PKCE |
| `redirect_uri_mismatch` od Googlu | Redirect URI v Google Cloudu neodpovídá `https://<ref>.supabase.co/auth/v1/callback` |
| „provider disabled“ | Google provider není v Supabase zapnutý |
| Uživatel se přihlásí, ale Profil je prázdný | řádek v `profiles` se nezaložil (RLS/insert) — uživatel otevře Profil a doplní údaje |
