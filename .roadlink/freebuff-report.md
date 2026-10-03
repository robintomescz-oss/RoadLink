# Report: matching volné kapacity s průjezdními body

Datum: 3. 10. 2026 · větev: `feature/via-route-matching`

## 1. Výchozí stav

- **Výchozí větev:** `refactor/simplify-bottom-nav` (commit `a6c758d`).
- **Remote:** `origin` = `https://github.com/robintomescz-oss/RoadLink.git`. Vzdálená větev
  `origin/refactor/simplify-bottom-nav` je s lokální **identická** (`0 0` divergence),
  žádný lokální commit nebyl nikam pushnut.
- **Pracovní strom před zásahem:** špinavý, ale **výhradně matching změny**
  (10 upravených + 13 nových cest). Žádný soubor navigace
  (`components/BottomNav.tsx`, `AppBottomNav.tsx`, `NavIcons.tsx`), profilu
  (`hooks/useProfile.ts`, `screens/Profile/*`) ani osobních vozidel nebyl
  rozpracovaný. Nic nebylo staged. `git diff --check` čistý.
- **Akce:** založena nová větev `feature/via-route-matching` z téhož commitu.
  **Nic nebylo vráceno, smazáno ani přepsáno** — změny navigace a profilu zůstávají
  nedotčené ve větvi `refactor/simplify-bottom-nav` i jako předek této větve.

**Konflikt cizích změn:** žádný. Pracovní strom obsahoval pouze práci na matchingu,
takže nebylo co odkládat ani oddělovat.

## 2. Migrační soubory a doporučené pořadí

Každý soubor existuje **právě jedenkrát**, plní jednu odpovědnost a navazuje na
předchozí. Duplicity ani rozpory nebyly nalezeny, žádný soubor se nemažel.

| # | Soubor | Odpovědnost |
|---|--------|-------------|
| 1 | `20261005120000_matching_includes_via_routes.sql` | Zruší vylučování tras s průjezdnými body, RPC vrací `route_via_place_ids` |
| 2 | `20261005130000_matching_via_coordinates.sql` | Soukromé `via_latitudes`/`via_longitudes` + validační trigger, RPC s polohou |
| 3 | `20261005140000_matching_sql_geo_preselection.sql` | Přechodné `bbox_*`, btree indexy, `roadlink_haversine_meters` |
| 4 | `20261005145000_matching_bbox_without_via.sql` | **Doplněno pri nasazení** — oprava: trasa bez průjezdných bodů má obdélník |
| 5 | `20261005150000_enable_postgis.sql` | `create extension if not exists postgis`, okamžité ověření typů |
| 6 | `20261005160000_carrier_route_spatial_line.sql` | `route_line geography(LineString,4326)` + trigger + GiST |
| 7 | `20261005170000_matching_spatial_preselection.sql` | RPC přepsaná přes `create or replace`: `ST_DWithin` + `ST_Distance` |
| 8 | `20261005180000_matching_spatial_cleanup.sql` | **poslední krok** — úklid `bbox_*`/haversine, jediný zdroj pravdy pro geometrii |

**Doplněná migrace `145000`** vznikla pri nasazování, když se ukázalo, že trigger
z kroku 3 považuje trasu BEZ průjezdných bodů za trasu bez geometrie. Podrobnosti
v sekci 9.

### Vlastnosti úklidní migrace (krok 7)

- dopředná, idempotentní, jedna transakce (`begin; … commit;`),
- **nejprve** blok předpokladů, při nesplnění `raise exception` a **nic se nezmění**;
  teprve potom jakýkoliv `DROP` (každý přes `if exists`),
- `DELETE`/`UPDATE`/`INSERT` v `carrier_routes`: **žádný**,
- veřejný feed, RLS, grants i interní autorizovaná RPC: **nedotčeny**,
- odstraňuje jen přechodné struktury (`bbox_*` + jejich CHECKy/indexy, helper,
  starý trigger `assign_carrier_route_line`), a to **jen když** je nahradila
  ověřená route geometry (to je právě první předpoklad),
- návratová cesta: migrace je **jednosměrná**, návrat je znovu aplikovat
  `20261005140000` — uvedeno v hlavičce souboru i v dokumentaci.

## 3. Je matching připraven k nasazení?

**Kód a migrace ano, nasazení ne.** Funkčně je kompletní:

- matching počítá celou plánovanou trasu včetně průjezdných bodů,
- kandidáti se předvýbírají v SQL podle vzdálenosti od trasy (`ST_DWithin` +
  `ST_Distance`), respektuje se `max_deviation_km` + 10 km rezerva,
- Edge Function omezuje rozpočet Google (`MAX_MATCH_ROUTE_CALLS = 8`,
  `MAX_EXACT_VARIANTS_PER_CANDIDATE = 3`, `MAX_MATCH_CANDIDATES = 5`),
  přímé trasy mají dál přesně 1 variantu / 1 volání,
- neúplný výsledek nese `incomplete: true`, výpadek Google API se nikdy
  netváří jako „žádné shody“,
- **průjezdné body jsou volitelné** a veřejně neviditelné.

Chybí jediná věc: **ověření na reálné databázi** (viz bod 5).

## 4. Co je ověřeno staticky a co čeká na reálnou DB

**Ověřeno lokálně (staticky):**

- `tsc --noEmit` — bez chyb,
- 22 regresních suite v `npm run check` — `ALL ROADLINK REGRESSION SUITES PASSED`,
- logika variant vložení, matice, souřadnice, pořadí kandidátů (čisté funkce),
- UI logika: normalizace via bodů, změna pořadí, pravidla přidání,
- `git diff --check` — čistý,
- **bezpečnost migrací** (staticky, přes text SQL): žádná `row level security`,
  žádný `drop policy`, žádný plošný `grant`, interní RPC drží `security definer` +
  `search_path = ''` + revoke pro `anon`/`authenticated` a grant **jen**
  `service_role`,
- **soukromí**: veřejný feed neobsahuje `via_latitudes`/`via_longitudes`/
  `route_line`/`bbox_*`/place ID, odpověď Edge Function klientovi neobsahuje
  žádný soukromý detail trasy,
- **logování**: žádný nový `console.*`; nové `console.error` v Edge Function
  nese jen `{ source, status }` / `{ source, reason }`, nikdy payload, adresu,
  place ID, souřadnici ani token,
- live harness `.roadlink/matching-spatial-integration.mjs` zůstává za volnou
  bránou, není v běžném runneru, v suchém režimu bez jediného síťového volání.

**Čeká na reálné DB / produkci:**

- samotné spuštění všech sedmi migrací (SQL **nebyl nikdy spuštěn**),
- `supabase/smoke/matching_spatial_smoke.sql` (read-only) — předpoklady, pokrytí,
  `EXPLAIN (ANALYZE, BUFFERS)`, smlouva RPC,
- živý harness proti reálné DB,
- nasazení Edge Function a reálné dotazy s průjezdními body,
- **read-only nativní test formuláře — NEPROVEDEN**: v prostředí není dostupné
  `adb` ani připojené zařízení (`adb: command not found`). Přidání/odebrání
  průjezdného bodu a návrat z formuláře je kryto regresí na čisté logice a
  TypeScriptem, ale vizuálně na zařízení ověřeno nebylo. **Žádný reálný záznam
  nebyl při testu vytvořen ani odeslán.**

## 5. Výsledky testů

```
npx tsc --noEmit                 → OK (exit 0)
npm run check                    → ALL ROADLINK REGRESSION SUITES PASSED (22 suite)
git diff --check                 → čistý
node .roadlink/form-creation-tests.js                 → FORM TESTS PASSED
node .roadlink/via-privacy-migrations-regression.js   → ALL VIA PRIVACY AND MIGRATION ORDER CHECKS PASSED
node .roadlink/matching-spatial-regression.js         → ALL MATCHING SPATIAL REGRESSION CHECKS PASSED
```

Nové/přepsané testy: `matching-via-regression.js`, `matching-matrix-regression.js`,
`matching-coordinates-regression.js`, `matching-spatial-regression.js`,
`via-privacy-migrations-regression.js` (nový) + rozšířený `form-creation-tests.js`
a `matching-server-regression.js`.

## 6. Bezpečnostní a soukromá rizika

1. **Žádná nová rizika nepřibyla.** Průjezdné body jsou uložené jako place ID +
   veřejný label (město/oblast) a jako **soukromé** souřadnice; veřejný feed je
   nikdy nevybírá, odpověď klientovi je neobsahuje.
2. **`via_latitudes`/`via_longitudes` jsou citlivá data** — stejná kategorie jako
   `from_lat`/`to_lat`. Jejich ochrana stojí na `service_role` grantu interního
   RPC a na tom, že veřejná funkce feedu je nevybírá. Po `20261005180000` zbývá
   `route_line` jako jediná odvozená geometrie.
3. **Předpoklad bezpečnosti filtru** `ST_DWithin`: kandidát s bodem dále než
   `max_deviation_km` od trasy by shodu stejně nedostal (odbočky jsou nesouběžné
   části trasy, silniční vzdálenost ≥ oblouk). Rezerva +10 km je proti odhadům
   PostGIS. **Toto plně ověří až `EXPLAIN` a reálná data.**
4. **Úklidová migrace je jednosměrná.** Předpoklady fail-loud, ale pokud by se
   uklízilo „v příliš brzkém stavu“, návrat je znovu aplikovat `20261005140000`.
5. **Formulář ještě nepozná `incomplete` odpověď detailu** — stávající UI ji
   zobrazuje; toto je známé omezení, ne změna tohoto commitu.

## 7. Přesný seznam změněných souborů

Upravené:
- `.gitignore` — allowlist pro nový regresní skript
- `scripts/run-regressions.mjs` — registrace nové suite
- `.roadlink/form-creation-tests.js` — testy pořadí/přidání via bodů
- `.roadlink/matching-server-regression.js` — via-aware chování
- `lib/createFormLogic.ts` — via-aware pair key, souřadnice, `moveViaPlace`, `canAddViaPlace`
- `screens/Transport/RouteFormRoute.tsx` — via předávaný do preview/guardu, ukládání souřadnic, UI pořadí
- `screens/Transport/RouteDetailRoute.tsx` — via trasy už nejsou blokované, text o celé trase
- `supabase/functions/google-route-matches/matchingRequest.ts` — varianty vložení, matice, souřadnice
- `supabase/functions/google-route-matches/index.ts` — rozpočet/limiter, předvýběr, `incomplete`
- `docs/address-routing-matching.md` — dokumentace v2, PostGIS rollout, runbook, úklid

Nové:
- `supabase/migrations/20261005120000_matching_includes_via_routes.sql`
- `supabase/migrations/20261005130000_matching_via_coordinates.sql`
- `supabase/migrations/20261005140000_matching_sql_geo_preselection.sql`
- `supabase/migrations/20261005150000_enable_postgis.sql`
- `supabase/migrations/20261005160000_carrier_route_spatial_line.sql`
- `supabase/migrations/20261005170000_matching_spatial_preselection.sql`
- `supabase/migrations/20261005180000_matching_spatial_cleanup.sql`
- `supabase/smoke/matching_spatial_smoke.sql`
- `.roadlink/matching-via-regression.js`
- `.roadlink/matching-matrix-regression.js`
- `.roadlink/matching-coordinates-regression.js`
- `.roadlink/matching-spatial-regression.js`
- `.roadlink/matching-spatial-integration.mjs` (gated, read-only)
- `.roadlink/via-privacy-migrations-regression.js`

**Žádný soubor navigace ani profilu nebyl změněn.**

## 8. Lokální commit

Commit: `f565033a1d253f30205b44ad67ebc2ba9a182dce` — `Add via-point route matching`
(lokální, **nepushnutý**).
Obsahuje výhradně výše uvedené matching soubory (24 souborů, +3709 / -57).
Žádný soubor navigace ani profilu v commitu není (ověřeno proti `HEAD`).

## 8b. Runbook

Podrobný runbook s kontrolními dotazy po každém z sedmi kroků a s rollbackem je
v `docs/matching-deployment-runbook.md` (commit `Runbook` — viz `git log`).
Je staticky krytý regresí `.roadlink/deployment-runbook-regression.js`, která
hlídá, že runbook jmenuje všech sedm souborů ve správném pořadí, že každý krok
má vlastní kontrolní dotazy i rollback a že neobsahuje `db push`,
`migration repair` ani deploy.

## 8c. Opravená chyba v plánovací kontrole

Audit odhalil nepravdivé tvrzení: runbook, smoke test i dokumentace žádaly
„hledejte `carrier_routes_route_line_gist_idx` v `Index Cond` plánu RPC“.
RPC filtruje `cr.id = p_route_id`, tedy **jednu trasu**, takže na
`carrier_routes` planner použije primární klíč a GiST se v plánu RPC objevit
nemůže. Kontrola by na reálném objemu nikdy neprošla.

Opraveno ve všech dotčených souborech; očekávaný plán RPC je nyní
`Index Scan using carrier_routes_pkey` a skutečné úzké místo je spojení
s `tow_requests`. Přidána read-only sada
`supabase/smoke/matching_spatial_index_proof.sql` (zdraví indexu, reálné
použití GiST při hledání napříč tabulkou, výkon předvýběru, rozhodovací
tabulka kdy je `Seq Scan` správná volba), krytá regresí
`.roadlink/spatial-index-proof-regression.js`.

## 8d. Kontrola celého řešení po pushi

Větev `feature/via-route-matching` pushnuta na remote (commit `dee73e2`,
divergence 0/0). Navigační větev `refactor/simplify-bottom-nav` nedotčena
(`a6c758d`). Žádný merge, žádný PR.

Při kontrole konzistence byly nalezeny a opraveny **dvě chyby v runbooku**:

1. Chybná precedence v dotazu na triggery (`and` má vyšší precedenci než `or`,
   takže poslední větve nebyly omezené na `carrier_routes` a dotaz by vrátil
   triggery ze všech tabulek). Doplněny závorky.
2. Runbook tvrdil konkrétní název primárního klíče `carrier_routes_pkey`.
   Tabulka `carrier_routes` vznikla mimo repozitář, takže tento název **nelze
   ověřit** a mohl být chybný. Nahrazeno obecným „`Index Scan` po primárním
   klíči“ a regresi upraveny, aby neprosazovaly neověřitelný název.

Ověřeno dále:

- **Kompatibilita Edge Function a RPC oběma směry.** Nová funkce proti starému
  RPC: chybějící via pole jsou volitelná, kandidát projde (ověřeno spuštěním
  `normalizeCandidate`). Stará funkce proti novému RPC: žádný sloupec nebyl
  odebrán, jen přidán. **Okno mezi migrací a deployem není nebezpečné v žádném
  pořadí** — zapsáno do runbooku. Jediný krok vyžadující pořadí je cleanup.
- **Soukromí end-to-end.** Odpověď Edge Function klientovi obsahuje jen
  `requestId`, kilometry, minuty, skóre a důvody — žádné place ID, souřadnice ani
  adresy. Veřejný feed vybírá výhradně `from_public_label`/`to_public_label`;
  `via_*`, `route_line` ani souřadnice nevybírá vůbec.
- **Názvy objektů** tvrzené runbookem byly zkontrolovány proti migracím —
  všechny odpovídají (kromě opraveného `carrier_routes_pkey`).

## 8e. Balíček pro Supabase SQL Editor

Protože v této session není `psql` ani heslo k DB, migrace se aplikují ručně
přes SQL Editor. Balíček je **generovaný**, ne psaný ručně:

- `scripts/build-sql-editor-bundle.mjs` skládá jednotlivé dotazy bajtově ze
  `supabase/migrations/*.sql`, takže se nemůže rozejít s tím, co je v repu,
- `supabase/sql-editor/00_preflight_readonly.sql` — read-only kontrola, která
  řekne, které kroky už v databázi jsou,
- sedm kroků `step_1_…` až `step_7_…`, každý s kontrolními dotazy a
  očekávaným výsledkem na konci,
- `supabase/sql-editor/README.md` — pořadí a co tam záměrně není.

Krok `20261005180000` (spatial_cleanup) **v balíčku není** — je jednosměrný
a patří až po ověřeném produkčním chodu. Regrese
`.roadlink/sql-editor-bundle-regression.js` to hlídá a zároveň kontroluje
synchronizaci (`--check`) i bezpečnost preflightu.

Cílový projekt potvrzen: **RoadLink `vbmxnrhmdjmqrsdtgjkn`** (propojený,
odpovídá `.env`).

## 9. Skutečný průběh nasazení (3. 10. 2026)

Nasazení proběhlo ručně v Supabase SQL Editoru — v této session není `psql` ani
heslo k DB. Každý krok běžel jako jedna transakce s vlastní kontrolní tabulkou na
konci (`zavre_kontrola` = ANO/NE), protože SQL Editor nezobrazuje `RAISE NOTICE`.

**Cílový projekt: RoadLink `vbmxnrhmdjmqrsdtgjkn`.**

### Výsledek

| Krok | Stav |
|------|------|
| 120000 via routes | prošel |
| 130000 via coordinates | prošel |
| 140000 bbox preselection | prošel, ale s chybnou kontrolou |
| **145000 bbox without via (doplněn)** | prošel |
| 150000 PostGIS | prošel (po opravě dvou kontrol) |
| 160000 route_line | prošel (po opravě dvou chyb) |
| 170000 spatial preselection | prošel |
| **smoke test** | **prošel až do veřejného feedu** |

Edge Function `google-route-matches` **nebyla nasazena** — záměrně odložena.
Krok 180000 (úklid) **nespuštěn**.

### Chyba 1 — trasa bez průjezdných bodů neměla obdélník (skutečná, v migraci)
Krok 3 vrátil `bez_bbox_tras_s_ukoncene = NE`. Příčina: trigger
`assign_carrier_route_bbox()` měl mezi podmínkami vedoucími k `bbox = NULL` i
`new.via_latitudes is null`. Jenže trasa *bez* průjezdných bodů má
`via_place_ids IS NULL`, a tím i `via_latitudes IS NULL` — trigger ji považoval
za trasu bez geometrie. Tedy přesně **trasa bez průjezdných bodů**, tedy
typická nabídka, neměla obdélník, nevstoupila do částečných btree indexů a
předvýběr ji nikdy netřídil.

Oprava je dopředná migrace `145000`, **ne** úprava aplikovaného kroku 3.
Zavádí helper `carrier_route_via_coordinates_valid()`, kde **prázdný seznam
průjezdných bodů je platný stav** a odmítají se jen osiřelé souřadnice. Stejný
helper používají i `assign_carrier_route_line()` a
`assign_carrier_route_geometry()`, aby se tři triggery nerozdělily v tom, co
považují za úplné souřadnice.

### Chyba 2 — kontrola požadovala to, co krok opravuje

V kroku 6 kontrola `st_makeline_ma_geometrii` vyžadovala
`ST_MakeLine(geography[])` — přetížení, které v PostGIS **záměrně neexistuje**
a kvůli němuž trigger staví `geometry` a převádí. Geometrie přitom byla
dopočítaná správně (`bez_chybejici_geometrie` i `pocet_bodu_souhlasí` = ANO).
Kontrola žádala přesně tu chybu, kterou krok opravuje, a odmítla správnou
databázi.

### Tři kontroly, které nemohly projít

Všechny tři byly chyby v kontrolních dotazech, ne v datech — a dvě z nich mě
zastavily, přestože byla databáze v pořádku:

1. `to_regtype('extensions.geography linestring')` — regtype vstup s typmodem
   odděleným mezerou je **syntaktická chyba**, takže dotaz spadl na parse dřív,
   než něco zjistil. Ověření je teď přes `pg_type`/`pg_proc`.
2. `count(*) = 4` nad `pg_proc` — počítalo **přetížení**, ne funkce.
   `ST_MakePoint` má v PostGIS pět variant a `ST_DWithin`/`ST_Distance`
   existují pro `geometry` i `geography`, takže počet nemohl být nikdy 4.
   Správně `count(distinct proname)`.
3. `ST_MakeLine(geography[])` — viz chyba 2.

**Ponauka:** kontrola, která nemůže projít, je stejně nebezpečná jako kontrola,
která nemůže selhat. Učí operátora čekat na červenou a zastavit. Žádnou z nich
by regrese v repu neodhalila — všechny byly syntakticky v pořádku a selhaly
až za běhu.

### Chyby 3 a 4 — sémantika PostGIS, kterou nešlo staticky ověřit

V kroku 6 selhal trigger `assign_carrier_route_line()`, který v této session
nikdo nikdy nespustil. Dvě chyby pod sebou:

- `geography || geography` **neskládá** geometrie — `||` je textový/pole
  operátor a WKB se jako pole nerozparsuje (`malformed array literal`).
- `ST_MakeLine` má **jen** variantu pro `geometry`; pro `geography` neexistuje
  (`function st_makeline(geography[]) does not exist`).

Vrcholy se nyní sbírají jako `geometry[]` přes `array_agg`/`unnest` v pořadí
cesty (odjezd → průjezdné body → cíl) a hotová čára se převede jedním
přetypováním. Stejnou past má `ST_NPoints` (také jen `geometry`) — používá se
v kontrolách na sloupci `route_line`, proto se převádí na
`::extensions.geometry`.

**Tyto regrese kryje, ale jako pojistku proti návratu, ne jako důkaz správnosti.**
Sémantiku PostGIS lze potvrdit jen jeho dotazem, ne kódem v repu.

### Opravený smoke test před úklidem

Smoke test vyžadoval trigger `carrier_routes_route_line_assign`, který úklid
(krok 180000) přejmenuje na `carrier_routes_route_geometry_assign`. Runbook přitom
žádá smoke test po úklidu zopakovat — a selhal by, přestože by bylo všechno
v pořádku. Nyní přijímá obě jména a odmítne stav, kdy existují **oba** (napůl
provedený úklid).

### Významná věc o návrhu

`route_line` je lomená čára spojující krajní a průjezdné body, **nikoli**
silniční geometrie z Googlu. Vzdálenost se tedy počítá k této aproximaci a tam,
kde silnice výrazně zatáčí, může být podhodnocena. Pro předvýběr to je
akceptovatelné — je to filtr, který **nikdy nevylučuje** platnou shodu, a
konečné rozhodnutí stejně ověřuje `google-route-matches` přes Compute Routes,
kde se při nejistotě vrací `incomplete = true`. Uložení plné polyline je
samostatný návrh.

### Nasazené commity

Větev `feature/via-route-matching` pushnuta na `origin` až do `ab8bab2`.
`refactor/simplify-bottom-nav` zůstala nedotčená (`a6c758d`).

## 10. Zbývá k rozhodnutí

1. **Edge Function deploy** — odložený záměrně. Do té doby matching běží po
   staré cestě a otevřená poptávka čeká.
2. **Krok 180000 (úklid)** — až za pár dní reálného provozu. Je **jednosměrný**:
   po `bbox_*` sloupcích se nevrátíš, návrat je jen znovu aplikovat krok 3.
   Doporučení: nejdřív pozorovat `incomplete: true` a limity Google Routes
   (10/min, 100/den).
3. **Kontrolovaný ruční test** — trasa s 1–3 průjezdnými body, pak vyhledání
   shody a ověření pořadí; trasa bez průjezdných bodů musí mít stále 1 variantu
   / 1 Google volání.
4. **`psql` nebo přístup k DB** — bez toho zůstává nasazování ruční a regrese
   SQL kódu statické.


## 11. Otevřené body k rozhodnutí

- Native read-only test formuláře na zařízení (chybí `adb`).
- Kdy přesně považovat produkční chod za „ověřený“ pro krok 6.
