-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 4 · Oprava obdélníku u tras BEZ průjezdných bodů
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005145000_matching_bbox_without_via.sql
-- Účel: helper carrier_route_via_coordinates_valid + bbox trigger, který prázdný seznam průjezdných bodů považuje za platný stav
--
-- JAK POUŽÍT
--   Supabase Dashboard → SQL Editor → New query → vložte CELÝ tento soubor → Run.
--
--   POSLEDNÍ TABULKA JE VÝSLEDEK. Má sloupec 'zavre_kontrola':
--     ANO → krok prokl, pokračujte dalším souborem.
--     NE  → něco nesedí. DALŠÍ KROK NEPUŠTĚJTE, pošlete mi tabulku.
--
--   Výstup RAISE NOTICE SQL Editor nezobrazuje, proto je kontrola na konci
--   souboru shrnující SELECT.
--
--   Každý krok je v jedné transakci. Když selže, odroluje se celý a databáze
--   zůstane beze změny. Kroky jsou idempotentní.
--
-- Bezpečnost: tento soubor upravuje databázi. Před spuštěním si udělejte bod
-- obnovy v Supabase Dashboardu → Database → Backups.
-- Oprava obdélníku tras BEZ průjezdných bodů
--
-- Proč: `assign_carrier_route_bbox()` z 20261005140000 považuje chybějící
-- `via_latitudes`/`via_longitudes` za chybějící souřadnice. Jenže trasa
-- *bez* průjezdných bodů má `via_place_ids IS NULL` a tím i
-- `via_latitudes IS NULL` — a přitom má oba krajní body zadané a geometrii
-- nepotřebuje žádnou. Výsledek: skoro každá běžná trasa skončila s
-- `bbox_* = NULL`, neprošla do částečných btree indexů a předvýběr kandidátů
-- ji nikdy netřídil. Chyba se projevila jako `bez_bbox_tras_s_ukoncene = NE`.
--
-- Co tato migrace mění:
--   * přidává `carrier_route_via_coordinates_valid(via_place_ids,
--     via_latitudes, via_longitudes)` — jediné místo, které rozhoduje, zda
--     jsou průjezdné body použitelné. PRŮJEZDNÉ BODY NEJSOU POVINNÉ: prázdný
--     seznam je platný stav, ne chybějící údaj,
--   * přepisuje `assign_carrier_route_bbox()` tak, že trasy bez průjezdných
--     bodů dostanou obdélník ze samotných krajních bodů,
--   * jedním průchodem dopočítá obdélník existujícím řádkům.
--
-- Co tato migrace NEDĚLÁ:
--   * nemění žádný uložený údaj (`from_lat`, `to_lat`, `via_*` se přepisují
--     beze změny; obdélník dopočítá BEFORE trigger),
--   * nemění RPC, RLS, grants ani veřejný feed,
--   * nesmažá ani nepřepíše žádný řádek,
--   * nevynucuje si průjezdné body — trasa bez nich zůstává plně platná.
--
-- Soukromí: `via_latitudes`/`via_longitudes` se tím nijak neexponují. Jen se
-- opravuje, kdy se od nich odvozuje geometrie.
--
-- Idempotence: CREATE OR REPLACE, `update` s podmínkou na NULL, jedna
-- transakce. Bezpečné pro opakované spuštění.

begin;

-- ── Jednotné rozhodnutí: jsou průjezdné body použitelné? ────────────────────
--
-- Klíčová změna oproti původnímu triggeru: PRÁZDNÝ seznam průjezdných bodů je
-- platný. Původní kód psal `new.via_latitudes is null` mezi podmínkami, které
-- vedou k `bbox = NULL`, a tím přesně popsal trasa BEZ průjezdných bodů jako
-- trasu bez geometrie.
create or replace function public.carrier_route_via_coordinates_valid(
  p_via_place_ids text[],
  p_via_latitudes double precision[],
  p_via_longitudes double precision[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    -- Žádné průjezdné body: jsou v pořádku, jen nesmí viset orfánské souřadnice.
    when coalesce(cardinality(p_via_place_ids), 0) = 0 then
      coalesce(cardinality(p_via_latitudes), 0) = 0
      and coalesce(cardinality(p_via_longitudes), 0) = 0
    -- Průjezdné body jsou: musí mít pár souřadnic, správný počet i rozsah.
    else
      p_via_latitudes is not null
      and p_via_longitudes is not null
      and cardinality(p_via_latitudes) = cardinality(p_via_place_ids)
      and cardinality(p_via_longitudes) = cardinality(p_via_place_ids)
      -- `value <> value` odhalí i NaN (v Postgresu je NaN <> NaN pravda).
      and not exists (
        select 1 from unnest(p_via_latitudes) as v(value)
        where value is null or value <> value or value < -90 or value > 90
      )
      and not exists (
        select 1 from unnest(p_via_longitudes) as v(value)
        where value is null or value <> value or value < -180 or value > 180
      )
  end;
$$;

revoke all on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) from public;
revoke all on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) from anon;
revoke all on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) from authenticated;

comment on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) is
  'True when a route''s via points are usable for derived geometry. An empty via list is VALID (geometry is then the origin-to-destination line); via points are never mandatory.';

-- ── Obdélník se počítá i pro trasu bez průjezdných bodů ─────────────────────

create or replace function public.assign_carrier_route_bbox()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lat double precision[];
  v_lng double precision[];
begin
  -- Chybí některý krajní bod, nebo jsou průjezdné body v rozporu se souřadnicemi
  -- → žádný obdélník (předvýběr pak kandidáta nikdy nevyřadí).
  if new.from_lat is null
     or new.from_lng is null
     or new.to_lat is null
     or new.to_lng is null
     or not public.carrier_route_via_coordinates_valid(
       new.via_place_ids, new.via_latitudes, new.via_longitudes
     ) then
    new.bbox_min_lat := null;
    new.bbox_max_lat := null;
    new.bbox_min_lng := null;
    new.bbox_max_lng := null;
    return new;
  end if;

  -- Bez průjezdných bodů je to obdélník dvou krajních bodů; s nimi obdélník
  -- celé plánované trasy. `coalesce` je nutný, protože prázdný seznam je
  -- zde legitimní stav a `null || '{}'` by zrušilo celé pole.
  v_lat := array[new.from_lat, new.to_lat] || coalesce(new.via_latitudes, '{}'::double precision[]);
  v_lng := array[new.from_lng, new.to_lng] || coalesce(new.via_longitudes, '{}'::double precision[]);

  new.bbox_min_lat := (select min(v) from unnest(v_lat) as v(value));
  new.bbox_max_lat := (select max(v) from unnest(v_lat) as v(value));
  new.bbox_min_lng := (select min(v) from unnest(v_lng) as v(value));
  new.bbox_max_lng := (select max(v) from unnest(v_lng) as v(value));

  return new;
end;
$$;

drop trigger if exists carrier_routes_bbox_assign on public.carrier_routes;
create trigger carrier_routes_bbox_assign
  before insert or update on public.carrier_routes
  for each row
  execute function public.assign_carrier_route_bbox();

revoke all on function public.assign_carrier_route_bbox() from public;
revoke all on function public.assign_carrier_route_bbox() from anon;
revoke all on function public.assign_carrier_route_bbox() from authenticated;

-- Dopočet existujících řádků. Zápis beze změny hodnot: `from_lat = from_lat`
-- jen probudí BEFORE trigger, který dopočítá obdélník. Částečné btree indexy
-- (`where bbox_min_lat is not null`) se při tomto UPDATE aktualizují samy,
-- takže nové řádky do nich vstoupí bez zásahu do databáze.
update public.carrier_routes
set from_lat = from_lat
where bbox_min_lat is null;

commit;

-- A) Tento krok OPRAVUJE CHYBU z kroku 3: trigger bbox považoval trasa bez
--    průjezdných bodů za trasu bez geometrie, takže jim bbox zůstal NULL a do
--    částečných btree indexů vůbec nevstoupily. Průjezdné body NENÍ povinné.
-- B) 'bez_bbox_tras_s_ukoncene' je teď počítáno přes VŠECHNY trasy s krajními
--    body, ne jen přes trasy s průjezdnými body jako v kroku 3.
-- C) Helper je sdílený i se dvěma dalšími triggery (krok 6 a úklid), které
--    musí rozhodovat o úplnosti souřadnic stejně.
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN helper = 1 THEN 'ANO' ELSE 'NE' END AS helper_existuje,
  CASE WHEN empty_ok THEN 'ANO' ELSE 'NE' END AS prazdny_via_je_platny,
  CASE WHEN range_ok THEN 'ANO' ELSE 'NE' END AS via_s_orezenim_odmita,
  CASE WHEN bez_bbox = 0 THEN 'ANO' ELSE 'NE' END AS bez_bbox_tras_s_ukoncene,
  CASE WHEN platne_indexy = 2 THEN 'ANO' ELSE 'NE' END AS dva_btree_indexy_platne,
  CASE WHEN not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')) THEN 'ANO' ELSE 'NE' END AS jen_service_role_z_anon
  ,
  CASE WHEN (helper = 1)
    AND (empty_ok)
    AND (range_ok)
    AND (bez_bbox = 0)
    AND (platne_indexy = 2)
    AND (not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')))
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM pg_proc
         WHERE pronamespace='public'::regnamespace
           AND proname='carrier_route_via_coordinates_valid') AS helper,
      -- Prázdný seznam průjezdných bodů = platná trasa bez průjezdných bodů.
      (SELECT public.carrier_route_via_coordinates_valid(
                '{}'::text[], NULL, NULL)
         AND public.carrier_route_via_coordinates_valid(
                ARRAY[]::text[], ARRAY[]::double precision[], ARRAY[]::double precision[])
         AND NOT public.carrier_route_via_coordinates_valid(
                '{}'::text[], ARRAY[50.0]::double precision[], ARRAY[15.0]::double precision[])) AS empty_ok,
      -- Souřadnice mimo rozsah ale spočítané správně musí odmítnout.
      (SELECT NOT public.carrier_route_via_coordinates_valid(
                ARRAY['via1']::text[], ARRAY[95.0]::double precision[], ARRAY[15.0]::double precision[])
         AND NOT public.carrier_route_via_coordinates_valid(
                ARRAY['via1']::text[], ARRAY[50.0]::double precision[], ARRAY[999.0]::double precision[])
         AND NOT public.carrier_route_via_coordinates_valid(
                ARRAY['via1']::text[], ARRAY[50.0]::double precision[], NULL)) AS range_ok,
      (SELECT count(*) FROM public.carrier_routes
         WHERE from_lat IS NOT NULL AND from_lng IS NOT NULL AND to_lat IS NOT NULL AND to_lng IS NOT NULL AND public.carrier_route_via_coordinates_valid(via_place_ids, via_latitudes, via_longitudes) AND bbox_min_lat IS NULL) AS bez_bbox,
      (SELECT count(*) FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid='public.carrier_routes'::regclass
           AND c.relname LIKE 'carrier_routes_bbox%'
           AND i.indisvalid AND i.indisready) AS platne_indexy
  ) AS c;
