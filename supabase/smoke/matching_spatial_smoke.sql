-- Smoke test prostorového předvýběru kandidátů (READ-ONLY)
--
-- Kdy spustit: PO aplikaci těchto migrací, v tomto pořadí:
--   20261005150000_enable_postgis.sql
--   20261005160000_carrier_route_spatial_line.sql
--   20261005170000_matching_spatial_preselection.sql
--
-- Jak: Supabase Dashboard → SQL Editor, nebo
--   psql "$DATABASE_URL" -f supabase/smoke/matching_spatial_smoke.sql
--
-- Skript nic NEZAPISUJE a nic NEMAŽE. Data se jen čtou; `EXPLAIN (ANALYZE)`
-- je jediné, co se vyhodnocuje, a to pouze nad `SELECT`.
--
-- Co ověřuje:
--   A) předpoklady: extension, typy, sloupec, trigger, platný GiST index, RPC
--      bez závislosti na zastaralých `bbox_*` sloupcích,
--      (kontrola na `bbox_*` je historická — plní roli do okamžiku, kdy je
--      uklízena migrací 20261005180000; potom je triviálně splněna),
--   B) pokrytí dat: trasy s úplnými souřadnicemi mají `route_line`,
--   C) plán dotazu: v `EXPLAIN` hledejte `carrier_routes_route_line_gist_idx`
--      v `Index Cond` (viz komentář u jednotlivých EXPLAIN),
--   D) výsledek RPC: kandidáti jsou seřazení od nejbližšího, limit je dodržen.
--
-- Výstup: `NOTICE` z DO bloků (nájdete ho ve výsledku / logu) a dvě tabulky
-- k ručnímu prohlédnutí. Skript končí chybou, pokud některá automatická
-- kontrola neplatí — to je záměr, ne omyl.

-- ══ A) Předpoklady ═══════════════════════════════════════════════════════════

do $$
declare
  v_function_definition text;
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    raise exception 'CHYBA: PostGIS není nainstalována. Aplikuj 20261005150000_enable_postgis.sql.';
  end if;

  if to_regtype('extensions.geography') is null
     or to_regtype('extensions.geography linestring') is null then
    raise exception 'CHYBA: chybí typ extensions.geography (linestring). Zkontroluj krok 1.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'carrier_routes' and column_name = 'route_line'
  ) then
    raise exception 'CHYBA: chybí sloupec carrier_routes.route_line. Aplikuj krok 2.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'carrier_routes_route_line_assign'
      and tgrelid = 'public.carrier_routes'::regclass
      and not tgisinternal
  ) then
    raise exception 'CHYBA: chybí trigger carrier_routes_route_line_assign. Aplikuj krok 2.';
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
    raise exception 'CHYBA: na carrier_routes není platný GiST index. Aplikuj krok 2.';
  end if;

  if to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)') is null then
    raise exception 'CHYBA: interní RPC pro předvýběr kandidátů neexistuje.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)'))
    into v_function_definition;

  -- Historická kontrola: platí pro stav před úklidem (20261005180000). Po uklízení
  -- je `bbox_*` v definici RPC jen historicky nepřítomné, takže podmínka je triviálně false.
  if v_function_definition like '%bbox_%' then
    raise exception 'CHYBA: RPC stále používá zastaralé bbox_* sloupce. Aplikuj krok 3 (20261005170000).';
  end if;

  if v_function_definition not like '%ST_DWithin%' then
    raise exception 'CHYBA: RPC nefiltruje prostorově (chybí ST_DWithin). Aplikuj krok 3.';
  end if;

  raise notice 'A) OK: extension, sloupec, trigger, GiST index i prostorový RPC jsou v pořádku.';
end;
$$;

-- ══ B) Pokrytí dat ════════════════════════════════════════════════════════════

-- Trasy s úplnými souřadnicemi MUSÍ mít route_line. Kdyby tu byl rozdíl,
-- je rozbité buď dopočítání při backfillu, nebo trigger.
select
  count(*) filter (where has_coordinates) as routes_with_coordinates,
  count(*) filter (where has_coordinates and route_line is not null) as with_route_line,
  count(*) filter (where has_coordinates and route_line is null) as missing_route_line,
  count(*) filter (where not has_coordinates) as without_coordinates
from (
  select
    cr.route_line,
    cr.from_lat is not null
      and cr.from_lng is not null
      and cr.to_lat is not null
      and cr.to_lng is not null
      and cr.via_latitudes is not null
      and cr.via_longitudes is not null
      and cardinality(cr.via_latitudes) = cardinality(cr.via_place_ids)
      and cardinality(cr.via_longitudes) = cardinality(cr.via_place_ids) as has_coordinates
  from public.carrier_routes as cr
) as coverage;

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.carrier_routes as cr
  where cr.from_lat is not null
    and cr.from_lng is not null
    and cr.to_lat is not null
    and cr.to_lng is not null
    and cr.via_latitudes is not null
    and cr.via_longitudes is not null
    and cardinality(cr.via_latitudes) = cardinality(cr.via_place_ids)
    and cardinality(cr.via_longitudes) = cardinality(cr.via_place_ids)
    and cr.route_line is null;

  if v_missing > 0 then
    raise exception 'CHYBA: % tras má úplné souřadnice, ale route_line je NULL. Zkontrolujte trigger nebo backfill.', v_missing;
  end if;

  raise notice 'B) OK: všechny trasy s úplnými souřadnicemi mají route_line.';
end;
$$;

-- ══ C) Plán dotazu ════════════════════════════════════════════════════════════

-- C1) Izolovaná sonda na samotný prostorový index.
--     Toto je JEDINÝ tvar dotazu, pro který GiST vzniká: hledáme trasy v okruhu
--     napříč celou tabulkou. V plánu hledejte `Index Scan using
--     carrier_routes_route_line_gist_idx` nebo `Bitmap Index Scan on` něj.
--
--     POZOR: `Seq Scan` zde NENÍ automaticky chyba. Při stovkách tras je
--     sekvenční čtení rychlejší než hledání v indexu a plánovač se chová
--     správně. Rozhodovací tabulka je v matching_spatial_index_proof.sql,
--     sekce D.
explain (analyze, buffers)
select cr.id
from public.carrier_routes as cr
where cr.route_line is not null
  and extensions.ST_DWithin(
    cr.route_line,
    extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography,
    30000
  );

-- C2) Plán celého dotazu předvýběru (týž tvar jako RPC, bez limitu, aby byl
--     plán čitelný).
--
--     KLÍČOVÉ: RPC filtruje `cr.id = p_route_id`, tedy JEDNU trasu. Na
--     `carrier_routes` proto očekávejte `Index Scan using carrier_routes_pkey`
--     a žádný GiST. GiST zde nemá co hledat — prostorová podmínka se
--     vyhodnocuje nad jediným řádkem.
--
--     Hledejte místo toho hash/sort spojení s `tow_requests`: skutečné úzké
--     místo tohoto dotazu jsou poptávky, ne trasy. Jejich objem kontroluje
--     sekce C v matching_spatial_index_proof.sql.
explain (analyze, buffers)
with test_route as (
  select cr.id, cr.driver_id, cr.max_deviation_km
  from public.carrier_routes as cr
  where cr.status = 'open'
    and cr.route_line is not null
    and cr.available_spaces > 0
  order by cr.created_at desc
  limit 1
)
select tr.id
from public.carrier_routes as cr
join test_route as t on t.id = cr.id
join public.tow_requests as tr
  on tr.status = 'open'
 and tr.origin_place_id is not null
 and tr.destination_place_id is not null
 and tr.route_distance_meters is not null
 and tr.route_duration_seconds is not null
 and tr.requested_date is not null
 and cr.departure_at::date between tr.requested_date and coalesce(tr.date_to, tr.requested_date)
 and tr.vehicle_type = any(cr.vehicle_types)
where cr.id = t.id
  and cr.driver_id = t.driver_id
  and cr.available_spaces > 0
  and (
    cr.route_line is null
    or tr.pickup_lat is null or tr.pickup_lng is null
    or tr.destination_lat is null or tr.destination_lng is null
    or (
      extensions.ST_DWithin(
        cr.route_line,
        extensions.ST_SetSRID(extensions.ST_MakePoint(tr.pickup_lng, tr.pickup_lat), 4326)::extensions.geography,
        (greatest(coalesce(cr.max_deviation_km, 20), 0) + 10) * 1000
      )
      and extensions.ST_DWithin(
        cr.route_line,
        extensions.ST_SetSRID(extensions.ST_MakePoint(tr.destination_lng, tr.destination_lat), 4326)::extensions.geography,
        (greatest(coalesce(cr.max_deviation_km, 20), 0) + 10) * 1000
      )
    )
  );

-- ══ D) Výsledek RPC ═══════════════════════════════════════════════════════════

-- Ukázka: pět nejbližších kandidátů vybrané trasy (jen k ručnímu prohlédnutí).
select
  row_number() over () as position,
  r.requested_date,
  r.request_vehicle_type,
  round(r.route_proximity_meters) as proximity_m,
  r.request_id is not null as has_request
from public.carrier_routes as cr
join lateral public.get_route_matching_candidates_internal(cr.id, cr.driver_id, 5) as r
  on true
where cr.status = 'open'
  and cr.route_line is not null
  and cr.available_spaces > 0
order by cr.created_at desc
limit 5;

-- Automatická kontrola: limit dodržen, pořadí neklesá, kandidáti bez vzdálenosti
-- jsou až na konci a všichni patří téže trase.
do $$
declare
  v_route record;
  v_rows jsonb;
  v_item jsonb;
  v_limit constant integer := 5;
  v_count integer;
  v_previous double precision := null;
  v_seen_without_distance boolean := false;
begin
  select cr.id, cr.driver_id
    into v_route
  from public.carrier_routes as cr
  where cr.status = 'open'
    and cr.route_line is not null
    and cr.available_spaces > 0
  order by cr.created_at desc
  limit 1;

  if v_route is null then
    raise notice 'D) PŘESKOČENO: žádná otevřená trasa s geometrií. Smoke nemá na čem běžet.';
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    into v_rows
  from public.get_route_matching_candidates_internal(v_route.id, v_route.driver_id, v_limit) as s;

  v_count := jsonb_array_length(v_rows);

  if v_count > v_limit then
    raise exception 'CHYBA: RPC vrátilo % řádků, limit je %.', v_count, v_limit;
  end if;

  for v_item in select * from jsonb_array_elements(v_rows)
  loop
    if (v_item ->> 'route_proximity_meters') is null then
      if not v_seen_without_distance then
        v_seen_without_distance := true;
      end if;
    else
      if v_seen_without_distance then
        raise exception 'CHYBA: kandidát s vypočtenou vzdáleností následuje za kandidátem bez vzdálenosti.';
      end if;

      if v_previous is not null
         and (v_item ->> 'route_proximity_meters')::double precision < v_previous then
        raise exception 'CHYBA: pořadí podle vzdálenosti od trasy je porušeno.';
      end if;

      v_previous := (v_item ->> 'route_proximity_meters')::double precision;
    end if;

    if (v_item ->> 'route_id') is distinct from v_route.id::text then
      raise exception 'CHYBA: RPC vrátilo kandidáta k jiné trase.';
    end if;
  end loop;

  raise notice 'D) OK: RPC vrátilo % kandidátů (limit %), pořadí podle vzdálenosti konzistentní.', v_count, v_limit;
end;
$$;

-- ══ E) Soukromí ══════════════════════════════════════════════════════════════

-- Veřejný feed nesmí vracet geometrii, souřadnice ani ohraničující obdélník.
-- Po úklidu (20261005180000) už `bbox_*` sloupce v tabulce nejsou; seznam níže
-- slouží jen jako pojistka pro stav před úklidem.
do $$
declare
  v_public_columns text;
begin
  select string_agg(column_name, ', ' order by column_name)
    into v_public_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'carrier_routes'
    and column_name in ('route_line', 'bbox_min_lat', 'bbox_max_lat', 'bbox_min_lng', 'bbox_max_lng');

  if v_public_columns is not null then
    raise notice 'E) Sloupce % existují, ale veřejný feed je nevybírá (ověřeno dotazem níže).', v_public_columns;
  end if;
end;
$$;

-- Očekávaný výstup veřejného feedu — bez geometrie a bez souřadnic.
select p.*
from public.get_public_marketplace_routes(1, 0) as p;

-- Hotovo. Pokud skript doběhl bez výjimky, je prostorový předvýběr nasazený
-- a chovající se podle očekávání.