-- Úklid po ověření prostorového předvýběru
--
-- Proč: mezikrok `20261005140000` přidal dočasné čtyři sloupce `bbox_*`,
-- btree indexy a helper `roadlink_haversine_meters`. Od kroku
-- `20261005170000` je předvýběr filtruje skutečná geometrie `route_line`
-- přes GiST index a řadí ji `ST_Distance`, takže tyto objekty jsou mrtvé
-- váhy. Tato migrace je ukládí a nechá v databázi jediný zdroj pravdy pro
-- odvozenou geometrii.
--
-- POZOR NA POŘADÍ: aplikovat AŽ po krocích 150000, 160000, 170000 a po
-- úspěšném `supabase/smoke/matching_spatial_smoke.sql`. Pokud předpoklady
-- neplatí, skript skončí výjimkou a NIC neuklízí.
--
-- Předpoklady (skontroluje je první blok, jinak výjimka):
--   1. RPC `get_route_matching_candidates_internal` už nesahá na `bbox_*`
--      ani na `roadlink_haversine_meters` — tedy je použitý prostorový krok,
--   2. každá trasa s úplnými souřadnicemi má `route_line` — uklizení obdélníku
--      tedy neztratí žádný použitelný filtr,
--   3. GiST index nad `route_line` existuje, je platný a připravený.
--
-- Co dělá:
--   * odstraní trigger `carrier_routes_bbox_assign`, funkci
--     `assign_carrier_route_bbox()` a sloupce `bbox_min_lat/max_lat/
--     min_lng/max_lng` (jejich CHECKy a btree indexy zmizí s nimi),
--   * odstraní helper `roadlink_haversine_meters`,
--   * přepojí odvozování geometrie na jediný trigger
--     `carrier_routes_route_geometry_assign` s funkcí
--     `assign_carrier_route_geometry()` a zahodí starou
--     `assign_carrier_route_line()`.
--
-- Co NEdělá:
--   * nemění `route_line`, souřadnice ani žádná data,
--   * nemění RLS, grants ani RPC (jen je předběžně ověří),
--   * nesahá na `carrier_routes_via_places_validate` — validace vstupu zůstává
--     ve své funkci záměrně oddělená od odvozování; jediným zdrojem pravdy pro
--     odvozenou geometrii je nový trigger,
--   * neprovádí žádné UPDATE/DELETE nad daty.
--
-- Vracitelnost: migrace je idempotentní a bezpečná pro opakované spuštění,
-- ale vrátit se zpět nelze (sloupce jsou odstraněna). Pokud je potřeba, je
-- návratová cesta znovu aplikovat 20261005140000.

begin;

-- ── 1) Předpoklady: uklízíme jen to, co už není používané ───────────────────

do $$
declare
  v_function_definition text;
  v_missing_geometry integer;
begin
  if to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)') is null then
    raise exception 'CHYBA: interní RPC pro předvýběr kandidátů neexistuje.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)'))
    into v_function_definition;

  if v_function_definition like '%bbox_%' then
    raise exception 'CHYBA: RPC stále používá bbox_* sloupce. Nejdřív aplikuj 20261005170000.';
  end if;

  if v_function_definition like '%roadlink_haversine_meters%' then
    raise exception 'CHYBA: RPC stále používá roadlink_haversine_meters. Nejdřív aplikuj 20261005170000.';
  end if;

  -- Podmínka musí být stejná jako v `assign_carrier_route_geometry()` jinak by
  -- kontrolovala jinou množinu tras, ne jakou geometrie opravdu nedává.
  select count(*) into v_missing_geometry
  from public.carrier_routes as cr
  where cr.from_lat is not null
    and cr.from_lng is not null
    and cr.to_lat is not null
    and cr.to_lng is not null
    and public.carrier_route_via_coordinates_valid(
      cr.via_place_ids, cr.via_latitudes, cr.via_longitudes
    )
    and cr.route_line is null;

  if v_missing_geometry > 0 then
    raise exception 'CHYBA: % tras má úplné souřadnice, ale route_line je NULL. Nejdřív opravte trigger nebo backfill.', v_missing_geometry;
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am am on am.oid = c.relam
    where i.indrelid = 'public.carrier_routes'::regclass
      and am.amname = 'gist'
      and i.indisvalid
      and i.indisready
  ) then
    raise exception 'CHYBA: na carrier_routes není platný GiST index pro route_line. Nejdřív aplikuj 20261005160000.';
  end if;

  raise notice 'Úklid: předpoklady splněny (RPC je prostorový, geometrie je kompletní, GiST index je platný).';
end;
$$;

-- ── 2) Odstranění dočasného obdélníku ────────────────────────────────────────

drop trigger if exists carrier_routes_bbox_assign on public.carrier_routes;
drop function if exists public.assign_carrier_route_bbox();

drop index if exists public.carrier_routes_bbox_lat_idx;
drop index if exists public.carrier_routes_bbox_lng_idx;

alter table public.carrier_routes
  drop column if exists bbox_min_lat,
  drop column if exists bbox_max_lat,
  drop column if exists bbox_min_lng,
  drop column if exists bbox_max_lng;

-- ── 3) Jediný zdroj pravdy pro odvozenou geometrii ──────────────────────────

create or replace function public.assign_carrier_route_geometry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_points extensions.geography[];
begin
  -- Neúplné nebo vadné souřadnice znamenají žádnou geometrii. Vstupní platnost
  -- přitom hlídá `carrier_routes_via_places_validate`; tady se jen odvozuje.
  -- Podmínka je sdílená s obdélníkem (20261005145000): trasa BEZ průjezdných
  -- bodů je platná a geometrii má — prázdný seznam není chybějící údaj.
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

  v_points := extensions.ST_MakePoint(new.from_lng, new.from_lat)::extensions.geography
    || extensions.ST_MakePoint(new.to_lng, new.to_lat)::extensions.geography;

  if cardinality(new.via_latitudes) > 0 then
    v_points := v_points || extensions.ST_MakeLine(array(
      select extensions.ST_MakePoint(v.lng, v.lat)::extensions.geography
      from unnest(new.via_longitudes, new.via_latitudes) as v(lng, lat)
    ));
  end if;

  new.route_line := extensions.ST_MakeLine(v_points);

  return new;
end;
$$;

drop trigger if exists carrier_routes_route_line_assign on public.carrier_routes;

create trigger carrier_routes_route_geometry_assign
  before insert or update on public.carrier_routes
  for each row
  execute function public.assign_carrier_route_geometry();

drop function if exists public.assign_carrier_route_line();

revoke all on function public.assign_carrier_route_geometry() from public;
revoke all on function public.assign_carrier_route_geometry() from anon;
revoke all on function public.assign_carrier_route_geometry() from authenticated;

comment on function public.assign_carrier_route_geometry() is
  'Single source of truth for derived route geometry: builds carrier_routes.route_line from verified coordinates. Never accepts a client-supplied geometry.';

-- ── 4) Odstranění nepoužívaného helperu ─────────────────────────────────────

drop function if exists public.roadlink_haversine_meters(double precision, double precision, double precision, double precision);

commit;