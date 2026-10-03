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
