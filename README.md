# RoadLink

Mobilní tržiště pro poptávky a nabídky přepravy vozidel. Aplikace je postavená na React Native, Expo, React Navigation a Supabase.

## Aktuální stav

- veřejný, sanitizovaný trh přepravy dostupný bez přihlášení;
- přihlášení a oddělené soukromé detaily chráněné přes Supabase RLS;
- poptávky, nabídky dopravců, volné trasy a průběh přepravy;
- profil dopravce a vozový park;
- responzivní domovská obrazovka a formuláře;
- SOS, servis vozidla a notifikace jsou zatím připravované funkce.

## Lokální spuštění

Požadován je Node.js 20 nebo novější.

```bash
npm ci
copy .env.example .env
npm start
```

Do `.env` doplňte hodnoty `EXPO_PUBLIC_SUPABASE_URL` a `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Soubor `.env` se nesmí commitovat.

## Kontroly

```bash
npm run check
```

Příkaz spustí TypeScript kontrolu a všechny projektové regresní skripty.

## Interní Android build

Po přihlášení do Expo/EAS a nastavení proměnných prostředí `preview`:

```bash
npm run build:preview:android
```

Profil `preview` vytváří instalovatelný APK určený interním testerům. Profil `production` vytváří AAB pro Google Play; před veřejným vydáním je nutné znovu potvrdit identifikátor aplikace, store metadata, zásady ochrany soukromí a produkční Supabase prostředí.

## Bezpečnost prostředí

Klientská aplikace smí obsahovat pouze Supabase publishable key. Service-role klíč ani databázové heslo do aplikace nebo EAS proměnných nepatří. Pro testování a produkci používejte oddělená Supabase prostředí.

## Databáze

Dopředné migrace jsou v `supabase/migrations`. Ruční destruktivní rollbacky jsou oddělené v `supabase/rollback` a nesmějí se spouštět automaticky.
