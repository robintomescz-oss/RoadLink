-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 2 · Soukromé souřadnice průjezdných bodů
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005130000_matching_via_coordinates.sql
-- Účel: přidá via_latitudes/via_longitudes, validační trigger a RPC s polohou
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
-- Volná kapacita: soukromé souřadnice průjezdních bodů + matching RPC s polohou
--
-- Proč: matching potřebuje k polohovému předvýběru kandidátů a k seřazení
-- variant vložení nakládky/vykládky znát polohu celé plánované trasy. Place ID
-- samo o sobě polohu nenese a volat kvůli tomu Google by bylo drahé. Ukládáme
-- proto soukromé souřadnice průjezdních bodů stejně, jako už jsou uložené
-- souřadnice odjezdu a cíle (`from_lat/from_lng`, `to_lat/to_lng`).
--
-- Co tato migrace mění:
--   * přidává `carrier_routes.via_latitudes` a `carrier_routes.via_longitudes`
--     (nullable, max 3, jen jako soukromá data — nikdy do veřejného trhu),
--   * rozšiřuje validační trigger o kontrolu páru/rozsahu souřadnic,
--   * nahrazuje interní RPC `get_route_matching_candidates_internal` tak, aby
--     vracelo i souřadnice trasy a poptávky a umělo načíst až 25 kandidátů
--     (Edge Function z nich levně vybere nejbližší; nadále platí, že přesně
--     vyhodnocuje jen omezený počet).
--
-- Co tato migrace NEDĚLÁ:
--   * nemění RLS, veřejné marketplace RPC ani jejich výstup,
--   * neexponuje souřadnice klientovi (RPC je pouze pro service_role),
--   * nepočítá žádný polohový filtr přímo v SQL (dělá ho až Edge Function, aby
--     šel levně testovat a nemohl špatně vyřadit poptávku poblíž vzdáleného
--     průjezdního bodu),
--   * nemaže ani nepřepisuje existující data.
--
-- Soukromí: `via_latitudes`/`via_longitudes` jsou citlivá data. Veřejný feed
-- volných kapacit je záměrně nevybírá a veřejné labely zůstávají oddělené.
-- Place ID ani souřadnice se do anonymního trhu nikdy nedostanou.
--
-- Idempotence: ADD COLUMN IF NOT EXISTS, guardované CHECKy přes pg_constraint,
-- CREATE OR REPLACE trigger funkce a DROP + CREATE RPC s obnovenými granty.

begin;

alter table public.carrier_routes
  add column if not exists via_latitudes double precision[],
  add column if not exists via_longitudes double precision[];

comment on column public.carrier_routes.via_latitudes is
  'Soukromé zeměpisné šířky průjezdních bodů (max 3), stejné pořadí jako via_place_ids. Nikdy se nezveřejňuje.';
comment on column public.carrier_routes.via_longitudes is
  'Soukromé zeměpisné délky průjezdních bodů (max 3), stejné pořadí jako via_place_ids. Nikdy se nezveřejňuje.';

-- Délkové a párové CONSTRAINTy (obsah kontroluje trigger níže, protože CHECK
-- neumí poddotaz ani pohodlně projít prvky pole).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'carrier_routes_via_latitudes_len') then
    alter table public.carrier_routes
      add constraint carrier_routes_via_latitudes_len
      check (via_latitudes is null or coalesce(array_length(via_latitudes, 1), 0) <= 3);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'carrier_routes_via_longitudes_len') then
    alter table public.carrier_routes
      add constraint carrier_routes_via_longitudes_len
      check (via_longitudes is null or coalesce(array_length(via_longitudes, 1), 0) <= 3);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'carrier_routes_via_coordinates_together') then
    alter table public.carrier_routes
      add constraint carrier_routes_via_coordinates_together
      check ((via_latitudes is null) = (via_longitudes is null));
  end if;
end
$$;

-- Validace obsahu: place ID jako dřív + pár souřadnic, jejich počet a rozsah.
create or replace function public.validate_carrier_route_via_places()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.via_place_ids is not null then
    if exists (
      select 1
      from unnest(new.via_place_ids) as v(value)
      where value is null
         or btrim(value) = ''
         or value !~ '^[A-Za-z0-9_.-]+$'
    ) then
      raise exception 'Průjezdní body musí být platná Google place ID.';
    end if;

    if new.via_public_labels is not null
       and array_length(new.via_public_labels, 1) is distinct from array_length(new.via_place_ids, 1) then
      raise exception 'Počet veřejných názvů průjezdních bodů musí odpovídat počtu place ID.';
    end if;

    if new.via_latitudes is not null or new.via_longitudes is not null then
      if new.via_latitudes is null or new.via_longitudes is null then
        raise exception 'Průjezdní body musí mít buď obě souřadnice, nebo žádné.';
      end if;

      if array_length(new.via_latitudes, 1) is distinct from array_length(new.via_place_ids, 1)
         or array_length(new.via_longitudes, 1) is distinct from array_length(new.via_place_ids, 1) then
        raise exception 'Počet souřadnic průjezdních bodů musí odpovídat počtu place ID.';
      end if;

      -- `value <> value` odhalí i NaN (v Postgresu je NaN <> NaN pravda).
      if exists (
        select 1 from unnest(new.via_latitudes) as v(value)
        where value is null or value <> value or value < -90 or value > 90
      ) then
        raise exception 'Zeměpisná šířka průjezdního bodu musí být v rozsahu -90 až 90.';
      end if;

      if exists (
        select 1 from unnest(new.via_longitudes) as v(value)
        where value is null or value <> value or value < -180 or value > 180
      ) then
        raise exception 'Zeměpisná délka průjezdního bodu musí být v rozsahu -180 až 180.';
      end if;
    end if;
  elsif new.via_latitudes is not null or new.via_longitudes is not null then
    raise exception 'Souřadnice průjezdních bodů vyžadují průjezdní body.';
  end if;

  return new;
end;
$$;

drop trigger if exists carrier_routes_via_places_validate on public.carrier_routes;
create trigger carrier_routes_via_places_validate
  before insert or update on public.carrier_routes
  for each row
  execute function public.validate_carrier_route_via_places();

revoke all on function public.validate_carrier_route_via_places() from public;
revoke all on function public.validate_carrier_route_via_places() from anon;
revoke all on function public.validate_carrier_route_via_places() from authenticated;

-- Interní RPC pro Edge Function. Návratový typ se mění, proto DROP + CREATE.
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
  requested_end_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cr.id,
    cr.origin_place_id,
    cr.destination_place_id,
    cr.via_place_ids,
    cr.from_lat,
    cr.from_lng,
    cr.to_lat,
    cr.to_lng,
    cr.via_latitudes,
    cr.via_longitudes,
    cr.route_distance_meters,
    cr.route_duration_seconds,
    cr.max_deviation_km,
    tr.id,
    tr.origin_place_id,
    tr.destination_place_id,
    tr.pickup_lat,
    tr.pickup_lng,
    tr.destination_lat,
    tr.destination_lng,
    tr.vehicle_type,
    tr.requested_date,
    coalesce(tr.date_to, tr.requested_date)
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
  order by tr.requested_date asc, tr.created_at asc, tr.id asc
  limit least(greatest(coalesce(p_limit, 5), 1), 25);
$$;

revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from public;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from anon;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from authenticated;
grant execute on function public.get_route_matching_candidates_internal(uuid, uuid, integer) to service_role;

comment on function public.get_route_matching_candidates_internal(uuid, uuid, integer) is
  'Internal candidate preselection for google-route-matches. Returns private place IDs and coordinates only to service_role; never expose directly to mobile clients.';

commit;
A) Sloupce, validační trigger a tři omezení musí existovat.
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN souradnicove_sloupce = 2 THEN 'ANO' ELSE 'NE' END AS souradnicove_sloupce,
  CASE WHEN trigger_zapnut = 1 THEN 'ANO' ELSE 'NE' END AS validacni_trigger_zapnut,
  CASE WHEN omezeni = 3 THEN 'ANO' ELSE 'NE' END AS tri_omezeni,
  CASE WHEN v_def like '%route_via_latitudes%' THEN 'ANO' ELSE 'NE' END AS rpc_vraci_souradnice,
  CASE WHEN not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')) THEN 'ANO' ELSE 'NE' END AS jen_service_role_z_anon
  ,
  CASE WHEN (souradnicove_sloupce = 2)
    AND (trigger_zapnut = 1)
    AND (omezeni = 3)
    AND (v_def like '%route_via_latitudes%')
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
      (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='carrier_routes'
           AND column_name IN ('via_latitudes','via_longitudes')) AS souradnicove_sloupce,
      (SELECT count(*) FROM pg_trigger
         WHERE tgrelid='public.carrier_routes'::regclass
           AND tgname='carrier_routes_via_places_validate' AND tgenabled='O') AS trigger_zapnut,
      (SELECT count(*) FROM pg_constraint
         WHERE conrelid='public.carrier_routes'::regclass
           AND conname IN ('carrier_routes_via_latitudes_len','carrier_routes_via_longitudes_len','carrier_routes_via_coordinates_together')) AS omezeni
  ) AS c;
