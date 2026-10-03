-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 1 · Zahrnutí průjezdných bodů do matchingu
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005120000_matching_includes_via_routes.sql
-- Účel: zruší vylučování tras s průjezdnými body; RPC začne vracet route_via_place_ids
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
-- Matching v2: trasy s průjezdními body se účastní párování
--
-- Proč: migrace `20261001090000_matching_excludes_via_routes.sql` kandidáty pro
-- trasy s `via_place_ids` záměrně nevydávala, protože matching v1 uměl poptávku
-- vložit jen mezi odjezd a cíl jedné přímé trasy. Matching v2 už počítá celou
-- plánovanou trasu (`start → průjezdní body v pořadí → cíl`) a vkládá nakládku a
-- vykládku tak, aby zůstalo pořadí průjezdních bodů a nakládka byla před
-- vykládkou. Tato migrace proto výhybkovou podmínku ruší a předává Edge Function
-- i průjezdní body.
--
-- Co tato migrace mění:
--   * interní RPC `get_route_matching_candidates_internal` vrací navíc
--     `route_via_place_ids text[]` (průjezdní body v zadaném pořadí),
--   * ruší výhybkovou podmínku, která kandidáty pro trasy s průjezdními body
--     vyřazovala.
--
-- Co tato migrace NEDĚLÁ:
--   * nemění RLS, ostatní grants, veřejné marketplace RPC ani status workflow,
--   * nemaže ani nepřepisuje `via_place_ids`/`via_public_labels` a nemění data,
--   * nezavádí žádnou polohovou předvýběrovou podmínku. Souřadnice průjezdních
--     bodů nejsou uložené a odvozená ohraničující oblast by mohla špatně vyřadit
--     poptávky poblíž vzdáleného průjezdního bodu. Předvýběr proto zůstává bez
--     polohového filtru (stav, termín, typ vozidla, kapacita) a je omezený
--     počtem kandidátů.
--
-- Soukromí: RPC je INTERNAL, `security definer`, `search_path = ''`, volat ho
-- smí jen `service_role` (přes ověřenou Edge Function). Place ID se nikdy
-- nevrací klientovi ani do veřejného trhu.
--
-- Idempotence: návratový typ se mění, proto DROP + CREATE. Před DROPem se
-- odebírají oprávnění, aby nevzniklo okno bez grantu; po CREATE se granty
-- obnovují. Vše je bezpečné opakovat.

begin;

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
  route_distance_meters integer,
  route_duration_seconds integer,
  max_deviation_km numeric,
  request_id uuid,
  request_origin_place_id text,
  request_destination_place_id text,
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
    cr.route_distance_meters,
    cr.route_duration_seconds,
    cr.max_deviation_km,
    tr.id,
    tr.origin_place_id,
    tr.destination_place_id,
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
  limit least(greatest(coalesce(p_limit, 5), 1), 5);
$$;

revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from public;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from anon;
revoke all on function public.get_route_matching_candidates_internal(uuid, uuid, integer) from authenticated;
grant execute on function public.get_route_matching_candidates_internal(uuid, uuid, integer) to service_role;

comment on function public.get_route_matching_candidates_internal(uuid, uuid, integer) is
  'Internal candidate preselection for google-route-matches. Returns private place IDs (including via points) only to service_role; never expose directly to mobile clients. Preselection uses status, date, vehicle type and capacity only.';

commit;
A) Via body jsou předávány a výhybková podmínka je pryč.
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN v_def like '%route_via_place_ids%' THEN 'ANO' ELSE 'NE' END AS rpc_vraci_via_place_ids,
  CASE WHEN v_def not like '%cr.via_place_ids is not null%' THEN 'ANO' ELSE 'NE' END AS via_trasy_neni_vylouceno,
  CASE WHEN v_def like '%route_via_place_ids%' THEN 'ANO' ELSE 'NE' END AS rpc_vracia_vsechny_pole,
  CASE WHEN not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')) THEN 'ANO' ELSE 'NE' END AS jen_service_role_z_anon
  ,
  CASE WHEN (v_def like '%route_via_place_ids%')
    AND (v_def not like '%cr.via_place_ids is not null%')
    AND (v_def like '%route_via_place_ids%')
    AND (not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated')))
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f;
