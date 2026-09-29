-- 0015 – RoadLink: ověřené metriky trasy (place ID, vzdálenost, trvání)
--
-- Stav: PŘIPRAVENO K REVIEW, NENÍ APLIKOVÁNO na žádnou databázi (preview ani produkci).
-- Migrace se aplikuje ručně až po review, testech a schválení (viz supabase/migrations/README.md).
--
-- Účel: matching v1 potřebuje u poptávek i volných kapacit vědět, které ověřené
-- lokality trasa spojuje a jak je dlouhá. Migrace přidává pouze odkaz na ověřenou
-- lokalitu (Google place ID) a výsledek výpočtu trasy; přesné adresy a souřadnice
-- zůstávají v existujících sloupcích beze změny.
--
-- Co tato migrace NEMĚNÍ:
--   * RLS policies, existující RPC ani status workflow,
--   * veřejné marketplace RPC (get_public_marketplace_requests/routes) ani jejich výstup,
--   * žádná DML data: bez backfillu, bez TRUNCATE/DELETE/DROP,
--   * žádné granty: authenticated už má na obou tabulkách INSERT (0008), takže
--     nové sloupce nepotřebují nové oprávnění (stejná úvaha jako u 0013).
--
-- Soukromí: place ID a metriky trasy jsou soukromé údaje a nesmí se objevit ve
-- veřejném trhu. Anon nemá na tyto tabulky žádný přímý přístup (0008) a veřejné
-- RPC vrací pevný seznam sloupců (0014); klient navíc odmítá neznámá soukromá
-- pole (lib/publicMarket.ts → PUBLIC_MARKETPLACE_FORBIDDEN_FIELDS). Veřejné
-- labely měst/oblastí (*_public_label) zůstávají oddělené od přesných adres.
--
-- Polyline trasy se záměrně neukládá: matching v1 umí vzdálenost i dobu ověřit
-- znovu z place ID (Compute Routes) a žádný dnešní čtenář geometrii trasy
-- nepotřebuje. Uložení geometrie by pouze zvětšilo objem soukromých dat.
--
-- Idempotence: ADD COLUMN IF NOT EXISTS je bezpečné opakovat; kontrolní CHECK
-- vzniká spolu se sloupcem a pojmenované table-level constrainty jsou guardované
-- přes pg_constraint, takže se při opakovaném běhu neduplikují.

begin;

-- Poptávky přepravy: oba konce trasy a vypočtená délka/doba.
alter table public.tow_requests
  add column if not exists origin_place_id text
    check (origin_place_id is null or (btrim(origin_place_id) <> '' and char_length(origin_place_id) <= 255)),
  add column if not exists destination_place_id text
    check (destination_place_id is null or (btrim(destination_place_id) <> '' and char_length(destination_place_id) <= 255)),
  add column if not exists route_distance_meters integer
    check (route_distance_meters is null or route_distance_meters >= 0),
  add column if not exists route_duration_seconds integer
    check (route_duration_seconds is null or route_duration_seconds >= 0);

-- Volná kapacita přepravce: stejný kontrakt, aby matching porovnával obě strany stejně.
alter table public.carrier_routes
  add column if not exists origin_place_id text
    check (origin_place_id is null or (btrim(origin_place_id) <> '' and char_length(origin_place_id) <= 255)),
  add column if not exists destination_place_id text
    check (destination_place_id is null or (btrim(destination_place_id) <> '' and char_length(destination_place_id) <= 255)),
  add column if not exists route_distance_meters integer
    check (route_distance_meters is null or route_distance_meters >= 0),
  add column if not exists route_duration_seconds integer
    check (route_duration_seconds is null or route_duration_seconds >= 0);

-- Pojmenovaná table-level kontrola pro obě tabulky: čtveřice metrik je buď
-- celá nevyplněná (historické řádky zůstávají validní), nebo celá vyplněná.
-- Částečně vyplněná čtveřice by znamenala trasu bez ověřeného konce, proto je
-- neplatná. Guard přes pg_constraint drží migraci idempotentní i pro constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tow_requests_route_metrics_all_or_none'
      and conrelid = 'public.tow_requests'::regclass
  ) then
    alter table public.tow_requests
      add constraint tow_requests_route_metrics_all_or_none
      check (
        (origin_place_id is null and destination_place_id is null
          and route_distance_meters is null and route_duration_seconds is null)
        or
        (origin_place_id is not null and destination_place_id is not null
          and route_distance_meters is not null and route_duration_seconds is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'carrier_routes_route_metrics_all_or_none'
      and conrelid = 'public.carrier_routes'::regclass
  ) then
    alter table public.carrier_routes
      add constraint carrier_routes_route_metrics_all_or_none
      check (
        (origin_place_id is null and destination_place_id is null
          and route_distance_meters is null and route_duration_seconds is null)
        or
        (origin_place_id is not null and destination_place_id is not null
          and route_distance_meters is not null and route_duration_seconds is not null)
      );
  end if;
end $$;

comment on column public.tow_requests.origin_place_id is
  'Private verified Google place ID of the pickup. Never returned by anonymous marketplace RPCs.';
comment on column public.tow_requests.destination_place_id is
  'Private verified Google place ID of the destination. Never returned by anonymous marketplace RPCs.';
comment on column public.tow_requests.route_distance_meters is
  'Private Compute Routes distance for origin_place_id -> destination_place_id. Never exposed publicly.';
comment on column public.tow_requests.route_duration_seconds is
  'Private Compute Routes duration in seconds for the requested route. Never exposed publicly.';

comment on column public.carrier_routes.origin_place_id is
  'Private verified Google place ID of the route start. Never returned by anonymous marketplace RPCs.';
comment on column public.carrier_routes.destination_place_id is
  'Private verified Google place ID of the route end. Never returned by anonymous marketplace RPCs.';
comment on column public.carrier_routes.route_distance_meters is
  'Private Compute Routes distance of the carrier route. Never exposed publicly.';
comment on column public.carrier_routes.route_duration_seconds is
  'Private Compute Routes duration in seconds of the carrier route. Never exposed publicly.';

commit;
