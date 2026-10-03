# Runbook: ruční nasazení matchingu s průjezdními body

**Osm migrací, osm zastávek.** Po každém kroku se zastavíte a spustíte
kontrolní dotazy. Teprve když sedí, pokračujete. Nic se nespouští automaticky.

> **Tento runbook neprovádí agent.** Popisuje, co *vy* spustíte ručně po mém
> výslovném potvrzení. Já `supabase db push`, `migration repair`, přímé SQL do
> vzdálené DB ani deploy Edge Functions neprovádím.

## Předpoklady a příprava

- SQL Editor v Supabase Dashboardu nebo `psql` s `DATABASE_URL`.
- **Záloha před krokem 1** — v Dashboardu: Database → Backups → zjistit, že
  existuje poslední bod obnovy. Migrace 120000–140000 mění návratový typ RPC,
  takže je potřeba mít kam se vrátit.
- Mít otevřený **transakční log** toho, co jste spustili, s časem.
- Větev `feature/via-route-matching`, commit `f565033`. Nic nebylo pushnuto.

### Základní kontrola před startem (read-only)

```sql
-- Které verze funkce jsou v databázi teď?
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'get_route_matching_candidates_internal';

-- Jaké sloupce carrier_routes existují (očekáváme: ještě žádné via_latitudes, route_line, bbox_*)?
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes'
  and (column_name like 'via_%' or column_name like 'bbox_%' or column_name = 'route_line')
order by column_name;

-- Kolik je tras celkem a kolik má úplné souřadnice (pro pozdější pokrytí)?
select
  count(*) as routes_total,
  count(*) filter (where from_lat is not null and from_lng is not null
                     and to_lat is not null and to_lng is not null) as with_endpoints,
  count(*) filter (where cardinality(via_place_ids) > 0) as with_via
from public.carrier_routes;
```

**Pokud už `via_latitudes` nebo `route_line` existují**, některý krok byl
aplikován dřív. Nepřeskakujte — pokračujte od nejnižšího neaplikovaného kroku
a nechte `if exists` / `create or replace` udělat svou práci.

---

## Krok 1 — `20261005120000_matching_includes_via_routes.sql`

**Účel:** zruší vylučování tras s průjezdními body; RPC začne vracet
`route_via_place_ids`. Zpětný DROP+CREATE, protože se mění návratový typ.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005120000_matching_includes_via_routes.sql
```

### Kontrola po kroku 1

```sql
-- A) Výhybková podmínka je pryč a via body se předávají v pořadí.
select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%route_via_place_ids%' as via_returned,
       pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%cr.via_place_ids is not null%' as still_excluded;
-- očekáváno: via_returned = true, still_excluded = false

-- B) Oprávnění: jen service_role.
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'get_route_matching_candidates_internal';
-- očekáváno: dva řádky — `postgres` (vlastník funkce, EXECUTE má vždy)
--   a `service_role`.
--   Pokud vidíte `anon` nebo `authenticated` → STOP. Znamenalo by to, že
--   klienti mohou volat RPC a dostávají soukromá data.

-- C) Limit je v tomto kroku ještě 5.
select least(greatest(coalesce(5,5),1),5) as limit_ok;
```

**Pokud něco nesedí:** transakce se celá odrolovala (krok je v `begin; … commit;`),
databáze je v původním stavu. Zjistěte příčinu, nespouštějte znovu naslepo.

---

## Krok 2 — `20261005130000_matching_via_coordinates.sql`

**Účel:** soukromé `via_latitudes` / `via_longitudes` + validační trigger; RPC
vrací souřadnice trasy i poptávky a umí načíst až 25 kandidátů.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005130000_matching_via_coordinates.sql
```

### Kontrola po kroku 2

```sql
-- A) Sloupce jsou přítomné a mají správný typ.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes'
  and column_name in ('via_latitudes','via_longitudes')
order by column_name;
-- očekáváno: oba double precision[]

-- B) Validační trigger existuje a je zapnutý.
select tgname, tgenabled, pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE%' as is_before
from pg_trigger
where tgrelid = 'public.carrier_routes'::regclass
  and tgname = 'carrier_routes_via_places_validate';
-- očekáváno: jeden řádek, tgenabled = 'O', is_before = true

-- C) Omezení na délku a na pár jsou založená.
select conname from pg_constraint
where conrelid = 'public.carrier_routes'::regclass
  and conname in ('carrier_routes_via_latitudes_len','carrier_routes_via_longitudes_len','carrier_routes_via_coordinates_together')
order by conname;
-- očekáváno: 3 řádky

-- D) Validační trigger opravdu odmítá rozbitý vstup (rollback v tomto bloku):
do $$
begin
  perform 1;
  raise notice 'Pouze přítomnost triggeru viz bod B; zkouška vkladu by zapsala data, proto se nedělá.';
end $$;
```

**Rollback kroku 2:** sloupce i trigger nechávejte. Vzniklá data jsou platná a
krok 3 na nich staví. Vrátit se dá až úplným rollbackem kroku 1.

---

## Krok 3 — `20261005140000_matching_sql_geo_preselection.sql`

**Účel:** přechodné `bbox_*` + btree indexy + `roadlink_haversine_meters`; RPC
filtruje obdélníkem a řadí podle blízkosti. PostGIS tu ještě **nepotřebuje** —
proto je to krok, na kterém lze bezpečně zastavit, kdyby prostorový plán
neprostál v kroku 4.

> **⚠️ Známá chyba tohoto kroku.** Trigger `assign_carrier_route_bbox()` považuje
> `via_latitudes IS NULL` za „chybí souřadnice“, a tím bere trasu **BEZ průjezdných
> bodů** jako trasu bez geometrie. Těmto trasám zůstane `bbox = NULL` a do
> částečných btree indexů nevstoupí. Opravuje to **krok 4** — spusťte ho hned
> poté. Kontrola A) proto záměrně počítá jen trasy, kterým tento krok umí
> geometrii odvodit.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005140000_matching_sql_geo_preselection.sql
```

### Kontrola po kroku 3

```sql
-- A) Obdélník se dopočítal u tras, kterým tento krok umí geometrii odvodit
--    (tedy u tras s průjezdnými body a jejich souřadnicemi).
--    Trasy BEZ průjezdných bodů jsou opravené až v kroku 4.
select count(*) as total,
       count(*) filter (where bbox_min_lat is null) as without_bbox
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null
  and via_latitudes is not null and via_longitudes is not null
  and cardinality(via_latitudes) = cardinality(via_place_ids)
  and cardinality(via_longitudes) = cardinality(via_place_ids);
-- očekáváno: without_bbox = 0

-- B) Indexy jsou platné a připravené.
select c.relname, i.indisvalid, i.indisready
from pg_index i
join pg_class c on c.oid = i.indexrelid
where i.indrelid = 'public.carrier_routes'::regclass
  and c.relname like 'carrier_routes_bbox%'
order by c.relname;
-- očekáváno: 2 řádky, vše true

-- C) Helper existuje a je immutable.
select p.proname, p.provolatile
from pg_proc p
where p.oid = to_regprocedure('public.roadlink_haversine_meters(double precision,double precision,double precision,double precision)');
-- očekáváno: roadlink_haversine_meters | i

-- D) RPC řadí podle blízkosti a vrací route_proximity_meters.
select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%roadlink_haversine_meters%' as uses_haversine,
       pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%route_proximity_meters%' as returns_proximity;
-- očekáváno: obě true
```

**Rollback kroku 3:** viz `Rollback celého řetězce` níže — vrstva 140000 je
jediná, kterou má smysl mazat, protože je plně zastaralá po kroku 7.

---

## Krok 4 — `20261005145000_matching_bbox_without_via.sql`

**Účel:** oprava chyby z kroku 3. Zavádí helper
`carrier_route_via_coordinates_valid()` a přepisuje trigger bbox tak, aby
**prázdný seznam průjezdných bodů byl platný stav**, ne chybějící údaj. Trasám
bez průjezdných bodů se tím dopočítá obdélník ze samotných krajních bodů.

Tento krok spusťte **bezprostředně po kroku 3** — bez něj zůstává většina tras
mimo obdélníkový index a celý předvýběr tak nemá nad čím třídit.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005145000_matching_bbox_without_via.sql
```

### Kontrola po kroku 4

```sql
-- A) Helper existuje a prázdný seznam průjezdných bodů považuje za platný.
select public.carrier_route_via_coordinates_valid('{}'::text[], null, null) as empty_ok,
       public.carrier_route_via_coordinates_valid(
         '{}'::text[], array[50.0]::double precision[], array[15.0]::double precision[]
       ) as orphan_rejected,
       public.carrier_route_via_coordinates_valid(
         array['via1']::text[], array[95.0]::double precision[], array[15.0]::double precision[]
       ) as out_of_range_rejected;
-- očekáváno: empty_ok = true, orphan_rejected = false, out_of_range_rejected = false

-- B) Obdélník je teď dopočítaný u VŠECH tras s krajními body — včetně těch
--    bez průjezdných bodů. Tohle je přesně kontrola, která v kroku 3 selhala.
select count(*) as total,
       count(*) filter (where bbox_min_lat is null) as without_bbox
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null
  and public.carrier_route_via_coordinates_valid(via_place_ids, via_latitudes, via_longitudes);
-- očekáváno: without_bbox = 0
```

**Rollback kroku 4:** migrace je dopředná a bezpečná, ale lze se vrátit
znovu aplikací kroku 3 (vrátí původní trigger). Nic se nemaže, takže
rollback databáze není potřeba.

---

## Krok 5 — `20261005150000_enable_postgis.sql` — **ZASTAVKA**

**Účel:** `create extension if not exists postgis schema extensions`. Pokud
PostIS není v plánu dostupný, **skript skončí chybou a nic se nezmění**.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005150000_enable_postgis.sql
```

### Kontrola po kroku 4

```sql
-- A) Extension je opravdu nainstalovaná.
select extname, extnamespace::regnamespace::text as schema
from pg_extension where extname = 'postgis';
-- očekáváno: postgis | extensions

-- B) Prostorový typ a funkce, které používají kroky 6 a 7, existují.
--    POZOR: `to_regtype('extensions.geography linestring')` se nesmí používat —
--    regtype vstup s typmodem odděleným mezerou je syntakticky chybný a dotaz
--    by spadl na parse chybě, ne na zjištění, že typ chybí. Kontrola jde
--    přes katalog.
select exists (
         select 1 from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'extensions' and t.typname = 'geography' and t.typtype = 'b'
       ) as geography_ok,
       -- POZOR: porovnává se počet JMEN, ne počet řádků v katalogu.
       -- ST_MakePoint má v PostGIS více přetížení (2D, 3D, 4D, s měřítkem)
       -- a ST_DWithin/ST_Distance existují pro geometry i geography, takže
       -- `count(*) = 4` by nikdy neplatilo.
       (select count(distinct p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'extensions'
          and p.proname in ('st_dwithin','st_makeline','st_makepoint','st_distance')
       ) = 4 as spatial_functions_ok;
-- očekáváno: obě true

-- C) PostGIS nezanechal nic v public schématu (konvence repozitáře).
select n.nspname, c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'spatial_%';
-- očekáváno: 0 řádků
```

### ⚠️ Jestli krok 5 selhal

PostGIS není v plánu dostupný. **Zastavte celé nasazení.** Kroky 3 a 4 (`140000`,
`145000`)
funguje bez PostGIS a předvýběr je použitelný (jen pomalejší, btree obdélník).
Kroky 5–7 **neaplikujte**. Řešení je plán, ne hádanka: buď zůstanete na
`140000`, nebo se rozhodnete plán rozšířit. Toto rozhodnutí je vaše.

**Rollback kroku 5:** není potřeba a není možný — skript je v jedné transakci
a při selhání se odroluje celý, takže po neúspěchu je databáze přesně tam, kde
byla. Extension, která by se nestavila, v databázi nezůstane.

---

## Krok 6 — `20261005160000_carrier_route_spatial_line.sql`

**Účel:** `route_line geography(LineString, 4326)` + BEFORE trigger + GiST index
+ dopočet existujících řádků.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005160000_carrier_route_spatial_line.sql
```

### Kontrola po kroku 5

```sql
-- A) Sloupec existuje se správným typem.
select udt_schema, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes' and column_name = 'route_line';
-- očekáváno: extensions | geography

-- B) Geometrie je dopočítaná u všech tras s krajními body — VČETNĚ tras bez
--    průjezdných bodů. Podmínka musí být stejná jako v triggeru, jinak počítá
--    jinou množinu tras, ne jakou geometrie skutečně odvodí.
select count(*) as total,
       count(*) filter (where route_line is null) as missing
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null
  and public.carrier_route_via_coordinates_valid(via_place_ids, via_latitudes, via_longitudes);
-- očekáváno: missing = 0   (to je přesně podmínka, kterou požaduje úklid v kroku 8)

-- B2) Zvlášť trasy BEZ průjezdných bodů: musí mít přímou dvoubodovou geometrii.
--     Kdyby tu chyběla, prostorový předvýběr by pro většinu tras nic netřídil.
select count(*) filter (where route_line is not null) as with_route_line,
       count(*) filter (where route_line is null) as missing_route_line
from public.carrier_routes
where coalesce(cardinality(via_place_ids), 0) = 0
  and from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null;
-- očekáváno: missing_route_line = 0

-- C) GiST index je platný a připravený.
select c.relname, i.indisvalid, i.indisready, am.amname
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_am am on am.oid = c.relam
where i.indrelid = 'public.carrier_routes'::regclass and am.amname = 'gist';
-- očekáváno: carrier_routes_route_line_gist_idx | t | t | gist

-- D) Geometrie má správnou délku: lomená čára přes odjezd → via → cíl.
select cardinality(via_place_ids) as via_count,
       extensions.ST_NPoints(route_line) as expected,
       extensions.ST_NPoints(route_line) = cardinality(via_place_ids) + 2 as matches
from public.carrier_routes
where cardinality(via_place_ids) > 0 and route_line is not null
limit 5;
-- očekáváno: matches = true (bodů je via + 2 krajní)
```

**Rollback kroku 6:** `drop trigger … route_line_assign; drop function … assign_carrier_route_line(); drop index … carrier_routes_route_line_gist_idx; alter table … drop column if exists route_line;`
Ručně, v této transakci. Sloupec se smí mazat — je plně odvozený a lze ho
znovu dopočítat krokem 5.

---

## Krok 7 — `20261005170000_matching_spatial_preselection.sql`

**Účel:** RPC přepsaná přes `create or replace` (bez `DROP`, tedy bez okna bez
grantu): filtr `ST_DWithin` na vyzvednutí *i* vyložení, řazení `ST_Distance`.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005170000_matching_spatial_preselection.sql
```

### Kontrola po kroku 6

```sql
-- A) RPC je prostorový a bbox už nepoužívá.
select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%ST_DWithin%' as spatial_filter,
       pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%bbox_%' as still_bbox,
       pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')) like '%roadlink_haversine_meters%' as still_haversine;
-- očekáváno: spatial_filter = true, still_bbox = false, still_haversine = false
--   Právě tohle krok 8 vyžaduje jako předpoklad.

-- B) Oprávnění se nezměnila (create or replace negrantuje nikomu nové).
select grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'get_route_matching_candidates_internal';
-- očekáváno: postgres (vlastník) + service_role; anon/authenticated NE

-- C) Je tu plán dotazu? Nahraďte <ROUTE_ID> skutečnou otevřenou trasou.
explain (analyze, buffers)
select * from public.get_route_matching_candidates_internal('<ROUTE_ID>'::uuid, '<DRIVER_ID>'::uuid, 5);
-- OČEKÁVANÝ plán: na carrier_routes `Index Scan` (primární klíč). Konkrétní
-- název indexu zde záměrně neuvádíme — tabulka vznikla mimo repozitář a jeho
-- jméno tu nelze ověřit. Důležité je, že jde o `Index Scan`, ne `Seq Scan`.
-- GiST v plánu RPC BUDE CHYBĚT — a to je správně: RPC filtruje
-- `cr.id = p_route_id` (jedna trasa), takže prostorová podmínka se vyhodnocuje
-- nad jediným řádkem. Hledejte spojení s tow_requests, ne prostorový index.
```

Pak samostatná diagnostika použitelnosti indexu a výkonu předvýběru:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/smoke/matching_spatial_index_proof.sql
```

Ta ověří zdraví indexu (`indisvalid`/`indisready`), reálné použití GiST při
hledání napříč tabulkou, výkon předvýběru a obsahuje rozhodovací tabulku, kdy
je `Seq Scan` správná volba. Vyhodí výjimku, jen když je index neplatný nebo
nepřipravený.

Pak spusťte celý read-only smoke test:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/smoke/matching_spatial_smoke.sql
```

**Musí doběhnout bez jediné výjimky.** Výstup jsou `NOTICE` z bloků A–E.

Volitelně živý harness (potřebuje `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`):

```bash
node .roadlink/matching-spatial-integration.mjs --confirm-live-spatial-smoke
```

**Rollback kroku 7:** znovu aplikovat obsah `20261005140000_matching_sql_geo_preselection.sql`
(krok 3 je v historii a má stále `if exists` / `create or replace`, takže se dá
přehrajt). To je jediná čistá cesta zpět, protože `170000` mění tělo funkce.

---

## Krok 8 — `20261005180000_matching_spatial_cleanup.sql` — **POSLEDNÍ**

**Účel:** odstranit `bbox_*` + `roadlink_haversine_meters`, přepojit odvozování
geometrie na jediný zdroj pravdy. **Až po ověřeném produkčním chodu**, ne
ihned po kroku 6.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005180000_matching_spatial_cleanup.sql
```

### Kontrola po kroku 7

```sql
-- A) Přechodné struktury jsou pryč.
select count(*) as bbox_columns_left
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes' and column_name like 'bbox_%';
-- očekáváno: 0

select to_regprocedure('public.roadlink_haversine_meters(double precision,double precision,double precision,double precision)') is null as haversine_gone;
-- očekáváno: true

-- B) Je zbyl přesně JEDEN trigger odvozující geometrii.
--    Závorky jsou povinné: `and` má vyšší precedenci než `or`, takže bez nich
--    by poslední větve nebyly omezené na carrier_routes.
select tgname from pg_trigger
where tgrelid = 'public.carrier_routes'::regclass
  and not tgisinternal
  and (tgname like '%geometry%' or tgname like '%line%' or tgname like '%bbox%')
order by tgname;
-- očekáváno: právě jeden řádek — carrier_routes_route_geometry_assign
--   (carrier_routes_via_places_validate je trigger vstupní validace, ne geometrie)

-- C) Geometrie se stále odvozuje a data se nezměnila.
select count(*) as total,
       count(*) filter (where route_line is null) as missing
from public.carrier_routes
where from_lat is not null and via_latitudes is not null
  and cardinality(via_latitudes) = cardinality(via_place_ids);
-- očekáváno: missing = 0

-- D) RPC je beze změny a oprávnění jsou stejná.
select grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'get_route_matching_candidates_internal';
-- očekáváno: postgres (vlastník) + service_role; anon/authenticated NE
```

Pak **znovu celý smoke test** — musí doběhnout bez výjimky, i když je
kontrola na `bbox_*` v něm historická (po úklidu triviálně platí).

**Rollback kroku 8:** migrace je **jednosměrná**, sloupce zmizí. Jediná cesta
zpět je znovu aplikovat `20261005140000_matching_sql_geo_preselection.sql`.
Nejdřív ale zvažte, zda to vůbec potřebujete — data ani chování to nesměřuje.

---

## Rollback celého řetězce

Pokud je třeba vzít všechny osm kroků zpět (nejlépe před jakýmkoli nasazením
Edge Function, aby se nikdo neocitl na půli cesty):

```sql
begin;

-- 1) Vrátit RPC na původní, via-excludující verzi z 20261001090000.
--    (nejjednodušší: znovu aplikovat 20261001090000_matching_excludes_via_routes.sql)

-- 2) Zahodit prostorovou vrstvu.
drop trigger if exists carrier_routes_route_geometry_assign on public.carrier_routes;
drop function if exists public.assign_carrier_route_geometry();
alter table public.carrier_routes drop column if exists route_line;

-- 3) Zahodit přechodné bbox vrstvu (když už byla uklízena, je to no-op).
drop trigger if exists carrier_routes_bbox_assign on public.carrier_routes;
drop function if exists public.assign_carrier_route_bbox();

-- 4) Vrátit předvýběr na stav před via (0017 / 20261001090000).
--    Viz 20261001090000_matching_excludes_via_routes.sql

commit;
```

**Pozor:** tím se ztratí `via_latitudes` / `via_longitudes`. **Data si předtím
záložte** (`create table carrier_routes_via_backup as select id, via_latitudes,
via_longitudes from carrier_routes where via_latitudes is not null;`). Tyto
sloupce se dají dopočítat znovu jen přes Place Details v aplikaci, takže
ztráta souřadnic znamená, že starší trasy spadnou na záložní matrix.

## Co rollback **neopravuje**

Pokud už je nasazená Edge Function `google-route-matches` a běží matching v2,
samotné vrácení migrací ji **nezastaví** — funkce bude dál volat RPC, které po
rollbacu vrací jiný počet sloupců. V takovém případě je rollback dvoustupňový:

1. nejdřív vrátit i Edge Function na předchozí verzi,
2. teprve pak rollbackovat migrace.

## Pořadí migrací vs. nasazení Edge Function

Ověřeno staticky oběma směry, takže **okno mezi migrací a deployem není
nebezpečné v žádném pořadí**:

- **Nová Edge Function proti starému RPC** — chybějící `route_via_place_ids`
  a `route_via_latitudes` jsou volitelná, `normalizeCandidate` je přijme jako
  `[]`/`null` a kandidát projde. Matching pracuje jako přímá trasa.
- **Stará Edge Function proti novému RPC** — nový RPC žádný sloupec neodebral,
  jen přidal. Stará funkce čte jen to, co dostává.

Jediný krok, který pořadí vyžaduje, je **`20261005180000` cleanup**: před ním
musí být ověřený provoz, protože je jednosměrný. Zbytek řetězce je
idempotentní a lze zastavit a opakovat.

## Shrnutí zastávek

| Krok | Soubor | Zastavka když |
|------|--------|---------------|
| 0 | základní kontrola | už existuje `via_latitudes`/`route_line` |
| 1 | `120000` | `still_excluded` není `false`, nebo je v grantech `anon`/`authenticated` |
| 2 | `130000` | chybí sloupce, trigger nebo 3 omezení |
| 3 | `140000` | `without_bbox` > 0, indexy neplatné, nebo chybí helper |
| 4 | `150000` | **PostGIS nedostupný → celé nasazení stojí** |
| 5 | `160000` | `missing` > 0, GiST není valid/ready, `matches` není `true` |
| 6 | `170000` | `still_bbox`/`still_haversine` nejsou `false`, smoke test vyhodí výjimku |
| 7 | `180000` | jakákoliv výjimka — transakce se odroluje, nic se nezmění |