# RoadLink

RoadLink je mobilní platforma pro řešení problémů kolem vozidla na cestě — od přepravy vozidel přes SOS pomoc až po budoucí propojení s autoservisy a dalšími poskytovateli služeb.

Cílem není vytvořit jen další aplikaci na odtah. RoadLink má uživateli nabídnout jedno místo, kde může podle konkrétní situace najít vhodné řešení: přepravu vozidla, pomoc na místě, servis nebo jinou dostupnou službu.

## Cílová vize

RoadLink má postupně propojit:

- řidiče, kteří potřebují pomoc nebo přepravu vozidla;
- dopravce a odtahové služby;
- volnou kapacitu na trasách, které dopravci stejně jedou;
- SOS průvodce a následné propojení s reálnou pomocí;
- autoservisy, které mohou nabídnout opravu, svoz vozidla nebo jinou pomoc;
- další relevantní služby pro motoristy.

Dlouhodobým cílem je zkrátit cestu od problému k řešení, zvýšit přehlednost pro uživatele a lépe využívat existující přepravní kapacitu.

## Aktuálně implementováno

Projekt je funkční prototyp ve vývoji. Aktuálně obsahuje:

- veřejný, sanitizovaný trh přepravy dostupný bez přihlášení;
- přihlášení a registraci e-mailem i přes Google účet;
- poptávky přepravy vozidel;
- cenové nabídky dopravců na konkrétní poptávky;
- volné trasy / volnou kapacitu dopravců;
- průběh přepravy a související obrazovky;
- jeden RoadLink účet bez přepínání identity zákazník / dopravce;
- volitelný přepravní profil pro uživatele, kteří chtějí nabízet přepravu;
- přepravní vozidla navázaná na přepravní profil;
- soukromá osobní vozidla uživatele pro rychlé předvyplnění SOS;
- responzivní domovskou obrazovku a formuláře;
- SOS Emergency Wizard pro poruchu nebo nehodu, včetně bezpečnostních kroků, tísňových čísel, práce s polohou, stavů objednávky a fallbacku při nedostupné asistenci;
- ochranu soukromých dat pomocí Supabase RLS a oddělení veřejných / neveřejných údajů.

Podrobnosti k SOS jsou v docs/sos-emergency-wizard.md.

## Rozpracované a plánované funkce

Následující části jsou součástí cílové vize, ale zatím nejsou plně připravené pro reálný provoz.

### Reálné objednání asistence

Aplikace má připravené rozhraní pro partnerskou asistenci, stavový proces objednávky, retry, storno a fallback. Aktuálně ale není připojené žádné skutečné partnerské API, takže RoadLink zatím nepředstírá, že reálnou asistenci dokáže objednat.

### Autoservisy

Propojení s autoservisy je důležitá plánovaná část ekosystému. Cílem je, aby RoadLink dokázal uživatele spojit nejen s odtahem, ale také se servisem nebo jiným vhodným poskytovatelem pomoci.

Do budoucna může servis nabídnout například:

- opravu vozidla;
- vlastní svoz nebo odtah vozidla;
- pomoc na místě;
- reakci na relevantní poptávky z okolí.

Samostatná síť servisů a partnerské servisní rozhraní zatím nejsou implementované.

### Další plánované oblasti

- reálné napojení poskytovatelů SOS / asistence;
- plnohodnotný partnerský režim pro autoservisy;
- notifikace;
- produkční platby a případná monetizace;
- dokončení právní a provozní přípravy;
- další bezpečnostní audit RLS a databázových oprávnění;
- pilotní provoz s reálnými uživateli a partnery.

## Technický základ

Aplikace je postavená na React Native, Expo, React Navigation a Supabase.

## Lokální spuštění

Požadován je Node.js 20 nebo novější.

    npm ci
    copy .env.example .env
    npm start

Do .env doplňte hodnoty EXPO_PUBLIC_SUPABASE_URL a EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Soubor .env se nesmí commitovat.

## Kontroly

    npm run check

Příkaz spustí TypeScript kontrolu a všechny projektové regresní skripty.

## Interní Android build

Po přihlášení do Expo/EAS a nastavení proměnných prostředí preview:

    npm run build:preview:android

Profil preview vytváří instalovatelný APK určený interním testerům. Profil production vytváří AAB pro Google Play; před veřejným vydáním je nutné znovu potvrdit identifikátor aplikace, store metadata, zásady ochrany soukromí a produkční Supabase prostředí.

## Bezpečnost prostředí

Klientská aplikace smí obsahovat pouze Supabase publishable key. Service-role klíč ani databázové heslo do aplikace nebo EAS proměnných nepatří. Pro testování a produkci používejte oddělená Supabase prostředí.

## Databáze

Dopředné migrace jsou v supabase/migrations. Ruční destruktivní rollbacky jsou oddělené v supabase/rollback a nesmějí se spouštět automaticky.
