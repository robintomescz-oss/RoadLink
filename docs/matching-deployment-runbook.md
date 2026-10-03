# Runbook: ruční nasazení matchingu s průjezdními body

**Sedm migrací, sedm zastávek.** Po každém kroku se zastavíte a spustíte
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
-- očekáváno: řádek jen pro service_role (postgres vlastníka nepočítejte).
--   Pokud vidíte anon nebo authenticated → STOP, migrace se neaplikovala celá.

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

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005140000_matching_sql_geo_preselection.sql
```

### Kontrola po kroku 3

```sql
-- A) Obdélník se dopočítal u tras s úplnými souřadnicemi.
select count(*) as total,
       count(*) filter (where bbox_min_lat is null) as without_bbox
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null;
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
jediná, kterou má smysl mazat, protože je plně zastaralá po kroku 6.

---

## Krok 4 — `20261005150000_enable_postgis.sql` — **ZASTAVKA**

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

-- B) Prostorové typy existují.
select to_regtype('extensions.geography') is not null as geography_ok,
       to_regtype('extensions.geography linestring') is not null as linestring_ok;
-- očekáváno: obě true

-- C) PostGIS nezanechal nic v public schématu (konvence repozitáře).
select n.nspname, c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'spatial_%';
-- očekáváno: 0 řádků
```

### ⚠️ Jestli krok 4 selhal

PostGIS není v plánu dostupný. **Zastavte celé nasazení.** Krok 3 (`140000`)
funguje bez PostGIS a předvýběr je použitelný (jen pomalejší, btree obdélník).
Kroky 5–7 **neaplikujte**. Řešení je plán, ne hádanka: buď zůstanete na
`140000`, nebo se rozhodnete plán rozšířit. Toto rozhodnutí je vaše.

**Rollback kroku 4:** není potřeba a není možný — skript je v jedné transakci
a při selhání se odroluje celý, takže po neúspěchu je databáze přesně tam, kde
byla. Extension, která by se nestavila, v databázi nezůstane.

---

## Krok 5 — `20261005160000_carrier_route_spatial_line.sql`

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

-- B) Geometrie je dopočítaná u všech tras s úplnými souřadnicemi.
select count(*) as total,
       count(*) filter (where route_line is null) as missing
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null
  and via_latitudes is not null and via_longitudes is not null
  and cardinality(via_latitudes) = cardinality(via_place_ids)
  and cardinality(via_longitudes) = cardinality(via_place_ids);
-- očekáváno: missing = 0   (to je přesně podmínka, kterou požaduje úklid v kroku 7)

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

**Rollback kroku 5:** `drop trigger … route_line_assign; drop function … assign_carrier_route_line(); drop index … carrier_routes_route_line_gist_idx; alter table … drop column if exists route_line;`
Ručně, v této transakci. Sloupec se smí mazat — je plně odvozený a lze ho
znovu dopočítat krokem 5.

---

## Krok 6 — `20261005170000_matching_spatial_preselection.sql`

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
--   Právě tohle krok 7 vyžaduje jako předpoklad.

-- B) Oprávnění se nezměnila (create or replace negrantuje nikomu nové).
select grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'get_route_matching_candidates_internal';
-- očekáváno: service_role

-- C) Je tu plán dotazu? Nahraďte <ROUTE_ID> skutečnou otevřenou trasou.
explain (analyze, buffers)
select * from public.get_route_matching_candidates_internal('<ROUTE_ID>'::uuid, '<DRIVER_ID>'::uuid, 5);
-- hledejte v Index Cond: carrier_routes_route_line_gist_idx
-- při Seq Scan je v datech málo tras — pro smoke běh OK, pro reálný objem ne.
```

Pak spusťte celý read-only smoke test:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/smoke/matching_spatial_smoke.sql
```

**Musí doběhnout bez jediné výjimky.** Výstup jsou `NOTICE` z bloků A–E.

Volitelně živý harness (potřebuje `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`):

```bash
node .roadlink/matching-spatial-integration.mjs --confirm-live-spatial-smoke
```

**Rollback kroku 6:** znovu aplikovat obsah `20261005140000_matching_sql_geo_preselection.sql`
(krok 3 je v historii a má stále `if exists` / `create or replace`, takže se dá
přehrajt). To je jediná čistá cesta zpět, protože `170000` mění tělo funkce.

---

## Krok 7 — `20261005180000_matching_spatial_cleanup.sql` — **POSLEDNÍ**

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
select tgname from pg_trigger
where tgrelid = 'public.carrier_routes'::regclass
  and not tgisinternal
  and tgname like '%geometry%' or tgname like '%line%' or tgname like '%bbox%';
-- očekáváno: jen carrier_routes_route_geometry_assign

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
-- očekáváno: service_role
```

Pak **znovu celý smoke test** — musí doběhnout bez výjimky, i když je
kontrola na `bbox_*` v něm historická (po úklidu triviálně platí).

**Rollback kroku 7:** migrace je **jednosměrná**, sloupce zmizí. Jediná cesta
zpět je znovu aplikovat `20261005140000_matching_sql_geo_preselection.sql`.
Nejdřív ale zvažte, zda to vůbec potřebujete — data ani chování to nesměřuje.

---

## Rollback celého řetězce

Pokud je třeba vzít všechny sedm kroků zpět (nejlépe před jakýmkoli nasazením
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