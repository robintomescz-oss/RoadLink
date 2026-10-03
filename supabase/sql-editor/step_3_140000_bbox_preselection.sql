-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 3 · Polohový předvýběr kandidátů (přechodné bbox)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005140000_matching_sql_geo_preselection.sql
-- Účel: přidá bbox_* sloupce, btree indexy, roadlink_haversine_meters a RPC s polohovým filtrem
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
-- Polohový předvýběr kandidátů v SQL (bbox + pořadí podle blízkosti)
--
-- Proč: dosud Edge Function načítala široké okno kandidátů (20) a nejbližší
-- vybírala až v TypeScriptu. Tím se přes databází tahaly soukromé place ID i
-- souřadnice zbytečně velkého počtu řádků a logika předvýběru byla rozdělená na
-- dvě místa. Tato migrace přesune polohový výběr do RPC: databáze sama vrátí
-- nejbližší poptávky podél CELÉ plánované trasy (včetně průjezdních bodů).
--
-- Co tato migrace mění:
--   * přidá `carrier_routes.bbox_min_lat/max_lat/min_lng/max_lng` — ohraničující
--     obdélník celé naplánované trasy, dopočítaný triggerem ze souřadnic odjezdu,
--     cíle a průjezdních bodů,
--   * přidá btree indexy nad ohraničujícími sloupci,
--   * přidá internou immutable funkci `roadlink_haversine_meters`,
--   * přepíše `get_route_matching_candidates_internal`: polohový filtr, výpočet
--     vzdálenosti kandidáta od trasy a pořadí podle blízkosti (před termínem),
--     vrátí i `route_proximity_meters`.
--
-- Bezpečnost filtru: každý bod trasy leží uvnitř ohraničujícího obdélníku, takže
-- jakýkoli bod ve vzdálenosti menší než m od trasy do rozšířeného obdélníku
-- bezpečně leží. Rozšíření = max_deviation_km (výchozí 20 km) + 10 km rezerva,
-- u zeměpisné délky s rezervou pro 60. rovnoběžku, aby filtr nikdy nebyl
-- přísnější než skutečná vzdálenost. Kandidáti bez souřadnic se filtru
-- vyhnou a v pořadí skončí až na konci — poloha je obohacení, ne podmínka.
--
-- Co tato migrace NEDĚLÁ:
--   * nemění RLS, veřejné marketplace RPC ani jejich výstup,
--   * neexponuje souřadnice ani bbox klientovi (výstup jen `service_role`),
--   * nemaže žádný údaj — bbox se jen dopočítá (při INSERT/UPDATE i jedním
--     průchodem nad existujícími řádky),
--   * nepožaduje žádnou databázovou extension. Btree indexy na dvou sloupcích
--     obdélníku plné prostorové dotazy neobsluží; to je vědomé omezení a důvod,
--     proč je bbox i tak přínosem (menší přenos řádků a správné pořadí). Plný
--     prostorový index by byl až po doplnění prostorové extension.
--
-- Idempotence: ADD COLUMN IF NOT EXISTS, guardované CHECKy, CREATE OR REPLACE
-- trigger funkce, indexy `if not exists`, DROP + CREATE RPC s obnovenými granty.

begin;

-- ── Ohraničující obdélník plánované trasy ────────────────────────────────────

alter table public.carrier_routes
  add column if not exists bbox_min_lat double precision,
  add column if not exists bbox_max_lat double precision,
  add column if not exists bbox_min_lng double precision,
  add column if not exists bbox_max_lng double precision;

comment on column public.carrier_routes.bbox_min_lat is
  'Soukromá minimální zeměpisná šířka celé plánované trasy (odjezd + průjezd + cíl). NULL, pokud chybí souřadnice.';
comment on column public.carrier_routes.bbox_max_lat is
  'Soukromá maximální zeměpisná šířka celé plánované trasy. NULL, pokud chybí souřadnice.';
comment on column public.carrier_routes.bbox_min_lng is
  'Soukromá minimální zeměpisná délka celé plánované trasy. NULL, pokud chybí souřadnice.';
comment on column public.carrier_routes.bbox_max_lng is
  'Soukromá maximální zeměpisná délka celé plánované trasy. NULL, pokud chybí souřadnice.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'carrier_routes_bbox_together') then
    alter table public.carrier_routes
      add constraint carrier_routes_bbox_together
      check (
        (bbox_min_lat is null) = (bbox_max_lat is null)
        and (bbox_min_lng is null) = (bbox_max_lng is null)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'carrier_routes_bbox_range') then
    alter table public.carrier_routes
      add constraint carrier_routes_bbox_range
      check (
        bbox_min_lat is null or (
          bbox_min_lat >= -90 and bbox_max_lat <= 90
          and bbox_min_lng >= -180 and bbox_max_lng <= 180
          and bbox_min_lat <= bbox_max_lat
          and bbox_min_lng <= bbox_max_lng
        )
      );
  end if;
end
$$;

-- Bbox se nikdy nezadává ručně — vždy se dopočítá z ověřených souřadnic.
create or replace function public.assign_carrier_route_bbox()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lat double precision[];
  v_lng double precision[];
begin
  if new.from_lat is null
     or new.from_lng is null
     or new.to_lat is null
     or new.to_lng is null
     or new.via_latitudes is null
     or new.via_longitudes is null
     or cardinality(new.via_latitudes) <> cardinality(new.via_place_ids)
     or cardinality(new.via_longitudes) <> cardinality(new.via_place_ids)
     or exists (
       select 1 from unnest(new.via_latitudes) as v(value)
       where value is null or value <> value or value < -90 or value > 90
     )
     or exists (
       select 1 from unnest(new.via_longitudes) as v(value)
       where value is null or value <> value or value < -180 or value > 180
     ) then
    new.bbox_min_lat := null;
    new.bbox_max_lat := null;
    new.bbox_min_lng := null;
    new.bbox_max_lng := null;
    return new;
  end if;

  v_lat := array[new.from_lat, new.to_lat] || new.via_latitudes;
  v_lng := array[new.from_lng, new.to_lng] || new.via_longitudes;

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

-- Existující řádky se obdélníku dopočítají jednou při této migraci. Zápis je
-- beze změny hodnot (bbox dopočítá BEFORE trigger), žádný údaj se nemaže.
update public.carrier_routes
set from_lat = from_lat
where bbox_min_lat is null;

create index if not exists carrier_routes_bbox_lat_idx
  on public.carrier_routes (bbox_min_lat, bbox_max_lat)
  where bbox_min_lat is not null;

create index if not exists carrier_routes_bbox_lng_idx
  on public.carrier_routes (bbox_min_lng, bbox_max_lng)
  where bbox_min_lng is not null;

-- ── Vzdálenost po povrchu Země (immutable, pro pořadí kandidátů) ───────────

create or replace function public.roadlink_haversine_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(
    least(1.0, sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    ))
  );
$$;

revoke all on function public.roadlink_haversine_meters(double precision, double precision, double precision, double precision) from public;
revoke all on function public.roadlink_haversine_meters(double precision, double precision, double precision, double precision) from anon;
revoke all on function public.roadlink_haversine_meters(double precision, double precision, double precision, double precision) from authenticated;

comment on function public.roadlink_haversine_meters(double precision, double precision, double precision, double precision) is
  'Immutable great-circle distance in meters between two WGS84 points. Used only for internal candidate ordering.';

-- ── Interní RPC: polohový filtr a pořadí podle blízkosti ───────────────────

revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from public;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from anon;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from authenticated;
drop function if exists public.get_route_matching_candidates_internal(uuid, uuid, integer);

create function public.get_route_matching_candidates_internal(
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
      cr.bbox_min_lat as c_bbox_min_lat,
      cr.bbox_max_lat as c_bbox_max_lat,
      cr.bbox_min_lng as c_bbox_min_lng,
      cr.bbox_max_lng as c_bbox_max_lng,
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
      array[cr.from_lat, cr.to_lat] || coalesce(cr.via_latitudes, '{}'::double precision[]) as c_lat_points,
      array[cr.from_lng, cr.to_lng] || coalesce(cr.via_longitudes, '{}'::double precision[]) as c_lng_points
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
  ),
  scored as (
    select
      c.*,
      (
        select min(public.roadlink_haversine_meters(c.c_pickup_lat, c.c_pickup_lng, p.lat, p.lng))
        from unnest(c.c_lat_points, c.c_lng_points) as p(lat, lng)
      ) as c_pickup_distance_m,
      (
        select min(public.roadlink_haversine_meters(c.c_dropoff_lat, c.c_dropoff_lng, p.lat, p.lng))
        from unnest(c.c_lat_points, c.c_lng_points) as p(lat, lng)
      ) as c_dropoff_distance_m
    from candidates as c
  ),
  expanded as (
    select
      s.*,
      -- Rozšíření obdélníku: povolená zajížďka + rezerva 10 km.
      (greatest(coalesce(s.c_max_deviation_km, 20), 0) + 10) / 110.574 as c_margin_lat,
      -- U délky počítáme s 60. rovnoběžkou, aby filtr nebyl přísnější než realita.
      (greatest(coalesce(s.c_max_deviation_km, 20), 0) + 10)
        / (
          111.320 * greatest(
            cos(radians(least(60, greatest(-60, greatest(abs(coalesce(s.c_bbox_min_lat, 0)), abs(coalesce(s.c_bbox_max_lat, 0))))))),
            0.5
          )
        ) as c_margin_lng
    from scored as s
  )
  select
    e.c_route_id,
    e.c_route_origin_place_id,
    e.c_route_destination_place_id,
    e.c_route_via_place_ids,
    e.c_route_origin_lat,
    e.c_route_origin_lng,
    e.c_route_destination_lat,
    e.c_route_destination_lng,
    e.c_route_via_latitudes,
    e.c_route_via_longitudes,
    e.c_route_distance_meters,
    e.c_route_duration_seconds,
    e.c_max_deviation_km,
    e.c_request_id,
    e.c_request_origin_place_id,
    e.c_request_destination_place_id,
    e.c_pickup_lat,
    e.c_pickup_lng,
    e.c_dropoff_lat,
    e.c_dropoff_lng,
    e.c_request_vehicle_type,
    e.c_requested_date,
    e.c_requested_end_date,
    e.c_pickup_distance_m + e.c_dropoff_distance_m as route_proximity_meters
  from expanded as e
  where
    -- Ohraničující filtr: kandidát projde, pokud alespoň jeden jeho bod leží
    -- v rozšířeném obdélníku trasy. Bez souřadnic se nikdy nevyřazuje.
    (
      e.c_bbox_min_lat is null
      or e.c_pickup_lat is null or e.c_dropoff_lat is null
      or e.c_pickup_lat between e.c_bbox_min_lat - e.c_margin_lat and e.c_bbox_max_lat + e.c_margin_lat
      or e.c_dropoff_lat between e.c_bbox_min_lat - e.c_margin_lat and e.c_bbox_max_lat + e.c_margin_lat
    )
    and (
      e.c_bbox_min_lng is null
      or e.c_pickup_lng is null or e.c_dropoff_lng is null
      or e.c_pickup_lng between e.c_bbox_min_lng - e.c_margin_lng and e.c_bbox_max_lng + e.c_margin_lng
      or e.c_dropoff_lng between e.c_bbox_min_lng - e.c_margin_lng and e.c_bbox_max_lng + e.c_margin_lng
    )
  order by
    -- Nejdřív kandidáti s vyčíslenou vzdáleností od trasy, ti bez polohy až na konci.
    case when e.c_pickup_distance_m is null or e.c_dropoff_distance_m is null then 1 else 0 end,
    (e.c_pickup_distance_m + e.c_dropoff_distance_m) asc nulls last,
    e.c_requested_date asc,
    e.c_request_created_at asc,
    e.c_request_id asc
  limit least(greatest(coalesce(p_limit, 5), 1), 25);
$$;

revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from public;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from anon;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from authenticated;
grant execute on function public.get_route_matching_candidates_internal(uuid, uuid, integer) to service_role;

comment on function public.get_route_matching_candidates_internal(uuid, uuid, integer) is
  'Internal candidate preselection for google-route-matches. Filters by status, date, vehicle, capacity and a bounding box around the whole planned route, then orders by haversine distance to the route. Returns private place IDs and coordinates only to service_role.';

commit;

-- A) NEJDŮLEŽITĚJŠÍ KROK PRO ZBÝVAJÍCÍ ŘETĚZEC. Obdélník se musí dopočítat
--    u VŠECH tras s úplnými souřadnicemi; jinak na stavbě stojí celý zbytek.
-- B) Oba btree indexy musí být platné a připravené.
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN bez_bbox = 0 THEN 'ANO' ELSE 'NE' END AS bez_bbox_tras_s_ukoncene,
  CASE WHEN platne_indexy = 2 THEN 'ANO' ELSE 'NE' END AS dva_btree_indexy_platne,
  CASE WHEN helper = 1 THEN 'ANO' ELSE 'NE' END AS haversine_helper_existuje,
  CASE WHEN v_def not like '%bbox%' THEN 'ANO' ELSE 'NE' END AS rpc_uz_nepouzi_bbox_pred,
  CASE WHEN not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')) THEN 'ANO' ELSE 'NE' END AS jen_service_role_z_anon
  ,
  CASE WHEN (bez_bbox = 0)
    AND (platne_indexy = 2)
    AND (helper = 1)
    AND (v_def not like '%bbox%')
    AND (not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')))
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM public.carrier_routes
         WHERE from_lat IS NOT NULL AND from_lng IS NOT NULL
           AND to_lat IS NOT NULL AND to_lng IS NOT NULL
           AND bbox_min_lat IS NULL) AS bez_bbox,
      (SELECT count(*) FROM pg_proc
         WHERE pronamespace='public'::regnamespace
           AND proname='roadlink_haversine_meters') AS helper,
      (SELECT count(*) FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid='public.carrier_routes'::regclass
           AND c.relname LIKE 'carrier_routes_bbox%'
           AND i.indisvalid AND i.indisready) AS platne_indexy
  ) AS c;
