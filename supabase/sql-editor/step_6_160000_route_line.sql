-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 6 · Skutečná prostorová geometrie trasy
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005160000_carrier_route_spatial_line.sql
-- Účel: přidá route_line geography(LineString,4326), BEFORE trigger, dopočet a GiST index
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
-- Krok 2 ze 3: skutečná prostorová geometrie trasy
--
-- Proč: `bbox_*` z kroku předchozího (20261005140000) jsou čtyři obyčejné
-- sloupce. Prostorové dotazy typu „je bod blízko trasy“ se nad nimi nedají
-- obsloužit indexem. Tato migrace přidá `route_line geography(LineString, 4326)`
-- — celou napánovanou trasu včetně průjezdních bodů jako lomenou čáru — a GiST
-- index, takže `ST_DWithin` se vyhodnotí z indexu.
--
-- Bezpečnost a idempotence:
--   * nový nullable sloupec bez backfillu cizích dat,
--   * hodnotu nikdy nezadává klient — dopočítá ji BEFORE trigger ze stejných
--     ověřených souřadnic, které už slouží pro bbox,
--   * existující řádky se dopočítají jedním průchodem (`update ... set` beze
--     změny hodnot, geometrii vypočítá trigger); žádný údaj se nemaže,
--   * sloupce `bbox_*` zůstávají beze změny, aby šla předchozí migrace vrátit;
--     uklízí se až po ověření nového RPC,
--   * `search_path = ''` a všechny PostGIS funkce volané s výslovným schématem
--     `extensions.`, aby se nespoléhalo na search_path databáze.
--
-- Prázdná / vadná geometrie: když chybí souřadnice odjezdu nebo cíle, nebo jsou
-- průjezdné body v rozporu se svými souřadnicemi, zůstane `route_line` NULL.
-- Matching pak kandidáty bez geometrie nikdy nevyřadí a zařadí je na konec
-- pořadí.
--
-- TRASA BEZ PRŮJEZDNÝCH BODŮ MÁ GEOMETRII. Podmínka úplnosti je sdílená s obdélníkem
-- (`carrier_route_via_coordinates_valid`, migrace 20261005145000): prázdný seznam
-- průjezdných bodů je platný stav, takže přímá trasa dostane lomenou čáru ze dvou
-- krajních bodů. Dřívější verze zde měla `new.via_latitudes is null` mezi podmínkami
-- pro NULL, a tím geometrii odebírala právě všem trasám bez průjezdných bodů.

begin;

alter table public.carrier_routes
  add column if not exists route_line extensions.geography(linestring, 4326);

comment on column public.carrier_routes.route_line is
  'Soukromá geometrie celé plánované trasy (odjezd → průjezdní body → cíl) pro filtrování kandidátů přes ST_DWithin. NULL, pokud chybí souřadnice. Nikdy se nezveřejňuje.';

-- Geometrie se nikdy nezadává ručně — vždy se přepočítá z ověřených souřadnic.
create or replace function public.assign_carrier_route_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_points extensions.geography[];
begin
  if new.from_lat is null
     or new.from_lng is null
     or new.to_lat is null
     or new.to_lng is null
     or not public.carrier_route_via_coordinates_valid(
       new.via_place_ids, new.via_latitudes, new.via_longitudes
     ) then
    new.route_line := null;
    return new;
  end if;

  -- Body se skládají v POŘADÍ cesty: odjezd → průjezdné body → cíl. Pole se
  -- staví jako pole pomocí array_agg, ne přes `||`.
  --
  -- PROČ NE `||`: operátor `||` na typu `geography` v PostGIS NESKLÁDÁ
  -- geometrie. Řadí se mezi textové/pole operátory, takže Postgres zkouší
  -- parsovat WKB jako pole a končí `malformed array literal`. Stejný
  -- operátor na poli `geography[]` skládá správně, a proto je potřeba, aby
  -- obě strany byly pole.
  --
  -- PROČ NE ST_MakeLine U JEDNOTLIVÝCH ČÁSTÍ: ST_MakeLine vrací *lomenou
  -- čáru*, ne bod. Poskládat z ní pole by dalo [bod, čára, bod] a ne
  -- jednotlivé vrcholy. Vrcholy proto sbírá array_agg nad unnest a lomená
  -- čára vznikne až jednou ze všech bodů.
  v_points := array(
    select extensions.ST_MakePoint(v.lng, v.lat)::extensions.geography
    from unnest(
      array[new.from_lng] || coalesce(new.via_longitudes, '{}'::double precision[]) || array[new.to_lng],
      array[new.from_lat] || coalesce(new.via_latitudes, '{}'::double precision[]) || array[new.to_lat]
    ) as v(lng, lat)
  );

  new.route_line := extensions.ST_MakeLine(v_points);

  return new;
end;
$$;

drop trigger if exists carrier_routes_route_line_assign on public.carrier_routes;
create trigger carrier_routes_route_line_assign
  before insert or update on public.carrier_routes
  for each row
  execute function public.assign_carrier_route_line();

revoke all on function public.assign_carrier_route_line() from public;
revoke all on function public.assign_carrier_route_line() from anon;
revoke all on function public.assign_carrier_route_line() from authenticated;

-- Dopočet existujících řádků (zápis beze změny hodnot, geometrii vypočítá trigger).
update public.carrier_routes
set from_lat = from_lat
where route_line is null;

create index if not exists carrier_routes_route_line_gist_idx
  on public.carrier_routes using gist (route_line)
  where route_line is not null;

commit;

-- A) 'bez_chybejici_geometrie' je přesně podmínka, kterou požaduje úklid.
--    Kdyby nebylo ANO, úklid NEAPLIKUJTE.
-- B) 'pocet_bodu_souhlasi' ověřuje, že lomená čára má odjezd + via + cíl.
-- C) Trasa BEZ průjezdných bodů má mít geometrii ze dvou krajních bodů.
--    'geometrie_bez_via_existuje' to hlídá a je podmínkou celého prostorového
--    předvýběru: bez ní by většina tras neměla co prosorový index hledat.
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN udt_schema = 'extensions' AND udt_name = 'geography' THEN 'ANO' ELSE 'NE' END AS typ_je_extensions_geography,
  CASE WHEN missing = 0 THEN 'ANO' ELSE 'NE' END AS bez_chybejici_geometrie,
  CASE WHEN gist_ok = 1 THEN 'ANO' ELSE 'NE' END AS gist_index_platny,
  CASE WHEN npoints_ok THEN 'ANO' ELSE 'NE' END AS pocet_bodu_souhlasí,
  CASE WHEN npoints_bez_via_ok THEN 'ANO' ELSE 'NE' END AS geometrie_bez_via_existuje,
  CASE WHEN not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')) THEN 'ANO' ELSE 'NE' END AS jen_service_role_z_anon
  ,
  CASE WHEN (udt_schema = 'extensions' AND udt_name = 'geography')
    AND (missing = 0)
    AND (gist_ok = 1)
    AND (npoints_ok)
    AND (npoints_bez_via_ok)
    AND (not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')))
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT
      (SELECT udt_schema FROM information_schema.columns
         WHERE table_schema='public' AND table_name='carrier_routes' AND column_name='route_line') AS udt_schema,
      (SELECT udt_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='carrier_routes' AND column_name='route_line') AS udt_name,
      (SELECT count(*) FROM public.carrier_routes
         WHERE from_lat IS NOT NULL AND from_lng IS NOT NULL AND to_lat IS NOT NULL AND to_lng IS NOT NULL AND public.carrier_route_via_coordinates_valid(via_place_ids, via_latitudes, via_longitudes) AND route_line IS NULL) AS missing,
      (SELECT count(*) FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_am am ON am.oid = c.relam
         WHERE i.indrelid='public.carrier_routes'::regclass
           AND am.amname='gist' AND i.indisvalid AND i.indisready) AS gist_ok,
      (SELECT COALESCE(bool_and(
                extensions.ST_NPoints(cr.route_line) = cardinality(cr.via_place_ids) + 2), true)
         FROM public.carrier_routes cr
         WHERE cardinality(cr.via_place_ids) > 0 AND cr.route_line IS NOT NULL) AS npoints_ok,
      -- Trasa bez průjezdných bodů = lomená čára ze dvou krajních bodů.
      (SELECT COALESCE(bool_and(
                extensions.ST_NPoints(cr.route_line) = 2
                AND cr.route_line IS NOT NULL), true)
         FROM public.carrier_routes cr
         WHERE coalesce(cardinality(cr.via_place_ids), 0) = 0
           AND cr.from_lat IS NOT NULL AND cr.from_lng IS NOT NULL
           AND cr.to_lat IS NOT NULL AND cr.to_lng IS NOT NULL) AS npoints_bez_via_ok
  ) AS c;
