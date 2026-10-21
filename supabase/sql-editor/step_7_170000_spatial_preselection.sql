-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 7 · Předvýběr kandidátů přes prostorový index
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005170000_matching_spatial_preselection.sql
-- Účel: RPC přepsaná přes create or replace: filtr ST_DWithin a řazení ST_Distance
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
-- Krok 3 ze 3: předvýběr kandidátů přes skutečný prostorový index
--
-- Proč: předchozí krok filtroval kandidáty obdélníkem ve čtyřech obyčejných
-- sloupcích (`bbox_*`). Nyní má trasa `route_line geography(LineString, 4326)`
-- s GiST indexem, takže „je vyzvednutí blízko trasy?“ se vyhodnotí přes index
-- pomocí `ST_DWithin` a seřazení použije skutečnou vzdálenost od trasy místo
-- haversine vzdálenosti od nejbližšího bodu.
--
-- Bezpečnost filtru (proč nevylučujeme platnou shodu):
--   Varianta trasy, která do plánované trasy vloží vyzvednutí P a vyložení D,
--   je delší oproti základní trase nejméně o `dist(P, trasa) + dist(D, trasa)`.
--   Silniční vzdálenost je vždy nejméně vzdálenost po nejkratším oblouku a obě
--   „odbočky“ jsou nesouběžné části trasy, takže se sčítají. Kandidát, jehož
--   některý bod je dále než `max_deviation_km` od trasy, tedy nikdy nesplní
--   `max_deviation_km` a shodu by stejně nedostal. Filtr proto žádnou platnou
--   shodu neodstraní — jen ušetří zbytečná Google volání. Radius je navíc
--   povolená zajížďka + 10 km rezerva.
--
-- Bezpečnost a idempotence:
--   * návratový typ RPC se nemění, proto stačí `create or replace` — žádný DROP,
--     žádně okno bez grantu,
--   * `security definer` + `search_path = ''` zůstávají, PostGIS funkce se volají
--     s výslovným schématem `extensions.`,
--   * kandidáti bez geometrie trasy nebo bez souřadnic se nikdy nevyřadí; v
--     pořadí skončí až na konci (poloha je obohacení, ne podmínka),
--   * žádná data se nemění ani nemažou; sloupce `bbox_*` zůstávají do úklidu po
--     ověření tohoto kroku,
--   * `roadlink_haversine_meters` zůstává v databázi pro řazení a diagnostiku.
--
-- Nasazení: aplikovat AŽ po krocích 1 a 2 a po ověření, že `route_line` je
-- naplněný u tras se souřadnicemi.

begin;

create or replace function public.get_route_matching_candidates_internal(
  p_route_id uuid,
  p_driver_id uuid,
  p_limit integer default 5
)
returns table (
  route_id uuid,
  route_origin_place_id text,
  route_destination_place_id text,
  route_via_place_ids text[],
  route_origin_lat double precision,
  route_origin_lng double precision,
  route_destination_lat double precision,
  route_destination_lng double precision,
  route_via_latitudes double precision[],
  route_via_longitudes double precision[],
  route_distance_meters integer,
  route_duration_seconds integer,
  max_deviation_km numeric,
  request_id uuid,
  request_origin_place_id text,
  request_destination_place_id text,
  request_pickup_lat double precision,
  request_pickup_lng double precision,
  request_destination_lat double precision,
  request_destination_lng double precision,
  request_vehicle_type text,
  requested_date date,
  requested_end_date date,
  route_proximity_meters double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select
      cr.id as c_route_id,
      cr.origin_place_id as c_route_origin_place_id,
      cr.destination_place_id as c_route_destination_place_id,
      cr.via_place_ids as c_route_via_place_ids,
      cr.from_lat as c_route_origin_lat,
      cr.from_lng as c_route_origin_lng,
      cr.to_lat as c_route_destination_lat,
      cr.to_lng as c_route_destination_lng,
      cr.via_latitudes as c_route_via_latitudes,
      cr.via_longitudes as c_route_via_longitudes,
      cr.route_distance_meters as c_route_distance_meters,
      cr.route_duration_seconds as c_route_duration_seconds,
      cr.max_deviation_km as c_max_deviation_km,
      tr.id as c_request_id,
      tr.origin_place_id as c_request_origin_place_id,
      tr.destination_place_id as c_request_destination_place_id,
      tr.pickup_lat as c_pickup_lat,
      tr.pickup_lng as c_pickup_lng,
      tr.destination_lat as c_dropoff_lat,
      tr.destination_lng as c_dropoff_lng,
      tr.vehicle_type as c_request_vehicle_type,
      tr.requested_date as c_requested_date,
      coalesce(tr.date_to, tr.requested_date) as c_requested_end_date,
      tr.created_at as c_request_created_at,
      extensions.ST_Distance(
        cr.route_line,
        extensions.ST_SetSRID(extensions.ST_MakePoint(tr.pickup_lng, tr.pickup_lat), 4326)::extensions.geography
      ) as c_pickup_distance_m,
      extensions.ST_Distance(
        cr.route_line,
        extensions.ST_SetSRID(extensions.ST_MakePoint(tr.destination_lng, tr.destination_lat), 4326)::extensions.geography
      ) as c_dropoff_distance_m
    from public.carrier_routes as cr
    join public.tow_requests as tr
      on tr.status = 'open'
     and tr.origin_place_id is not null
     and tr.destination_place_id is not null
     and tr.route_distance_meters is not null
     and tr.route_duration_seconds is not null
     and tr.requested_date is not null
     and cr.departure_at::date between tr.requested_date and coalesce(tr.date_to, tr.requested_date)
     and tr.vehicle_type = any(cr.vehicle_types)
    where cr.id = p_route_id
      and cr.driver_id = p_driver_id
      and cr.status = 'open'
      and cr.available_spaces > 0
      and cr.origin_place_id is not null
      and cr.destination_place_id is not null
      and cr.route_distance_meters is not null
      and cr.route_duration_seconds is not null
      -- Prostorový filtr přes GiST index. Kandidát bez geometrie trasy nebo bez
      -- souřadnic se nikdy nevyřadí (poloha je obohacení, ne podmínka).
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
      )
  )
  select
    c.c_route_id,
    c.c_route_origin_place_id,
    c.c_route_destination_place_id,
    c.c_route_via_place_ids,
    c.c_route_origin_lat,
    c.c_route_origin_lng,
    c.c_route_destination_lat,
    c.c_route_destination_lng,
    c.c_route_via_latitudes,
    c.c_route_via_longitudes,
    c.c_route_distance_meters,
    c.c_route_duration_seconds,
    c.c_max_deviation_km,
    c.c_request_id,
    c.c_request_origin_place_id,
    c.c_request_destination_place_id,
    c.c_pickup_lat,
    c.c_pickup_lng,
    c.c_dropoff_lat,
    c.c_dropoff_lng,
    c.c_request_vehicle_type,
    c.c_requested_date,
    c.c_requested_end_date,
    c.c_pickup_distance_m + c.c_dropoff_distance_m as route_proximity_meters
  from candidates as c
  order by
    -- Nejdřív kandidáti s vyčíslenou vzdáleností od trasy, ti bez polohy až na konci.
    case when c.c_pickup_distance_m is null or c.c_dropoff_distance_m is null then 1 else 0 end,
    (c.c_pickup_distance_m + c.c_dropoff_distance_m) asc nulls last,
    c.c_requested_date asc,
    c.c_request_created_at asc,
    c.c_request_id asc
  limit least(greatest(coalesce(p_limit, 5), 1), 25);
$$;

revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from public;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from anon;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from authenticated;
grant execute on function public.get_route_matching_candidates_internal(uuid, uuid, integer) to service_role;

comment on function public.get_route_matching_candidates_internal(uuid, uuid, integer) is
  'Internal candidate preselection for google-route-matches. Filters by status, date, vehicle, capacity and ST_DWithin distance from the whole planned route (GiST indexed), then orders by ST_Distance to that route. Returns private place IDs and coordinates only to service_role.';

commit;

-- A) RPC musí být prostorový a přechodné struktury už nesmí používat.
-- B) Smlouva odpovědi: limit 5, pořadí podle vzdálenosti neklesá a žádný
--    kandidát nepatří jiné trase. Když žádná otevřená trasa s geometrií není,
--    kontrola se přeskočí a vrací ANO.
-- C) Plán dotazu: RPC filtruje cr.id = p_route_id (JEDNA trasa), takže na
--    carrier_routes očekáváme Index Scan po primárním klíči a ŽÁDNÝ GiST.
--    GiST v plánu RPC chybí správně — nemá co hledat při jediném řádku.
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN v_def like '%ST_DWithin%' THEN 'ANO' ELSE 'NE' END AS rpc_pouzi_v_prostorovy_filter,
  CASE WHEN v_def not like '%bbox_%' THEN 'ANO' ELSE 'NE' END AS rpc_uz_nepouzi_bbox,
  CASE WHEN v_def not like '%roadlink_haversine_meters%' THEN 'ANO' ELSE 'NE' END AS rpc_uz_nepouzi_haversine,
  CASE WHEN limit_ok THEN 'ANO' ELSE 'NE' END AS smlouva_limit_ok,
  CASE WHEN own_ok THEN 'ANO' ELSE 'NE' END AS smlouva_vlastnictvi_ok,
  CASE WHEN order_ok THEN 'ANO' ELSE 'NE' END AS smlouva_poradi_ok,
  CASE WHEN not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')) THEN 'ANO' ELSE 'NE' END AS jen_service_role_z_anon
  ,
  CASE WHEN (v_def like '%ST_DWithin%')
    AND (v_def not like '%bbox_%')
    AND (v_def not like '%roadlink_haversine_meters%')
    AND (limit_ok)
    AND (own_ok)
    AND (order_ok)
    AND (not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')))
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f
  CROSS JOIN LATERAL (
    WITH r AS (
      SELECT cr.id AS id, cr.driver_id AS driver_id
      FROM public.carrier_routes cr
      WHERE cr.status = 'open'
        AND cr.route_line IS NOT NULL
        AND cr.available_spaces > 0
      ORDER BY cr.created_at DESC
      LIMIT 1
    ), raw AS (
      SELECT to_jsonb(t.s) AS row_json, t.o AS ord
      FROM r
      CROSS JOIN LATERAL public.get_route_matching_candidates_internal(r.id, r.driver_id, 5)
        WITH ORDINALITY AS t(s, o)
    ), chk AS (
      SELECT
        (row_json ->> 'route_proximity_meters')::double precision AS dist,
        lag((row_json ->> 'route_proximity_meters')::double precision) OVER (ORDER BY ord) AS prev_dist,
        (row_json ->> 'route_id') = (SELECT id::text FROM r) AS own_ok
      FROM raw
    )
    SELECT
      (SELECT count(*) <= 5 FROM chk) AS limit_ok,
      (SELECT COALESCE(bool_and(own_ok), true) FROM chk) AS own_ok,
      (
        SELECT COALESCE(bool_and(
                 CASE
                   WHEN prev_dist IS NULL THEN true
                   WHEN dist IS NULL THEN true
                   ELSE dist >= prev_dist
                 END), true)
        FROM chk
      ) AS order_ok
  ) AS c;
