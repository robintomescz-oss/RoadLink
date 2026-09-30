begin;

-- INTERNAL ONLY. This RPC is called exclusively by the authenticated matching
-- Edge Function through the service role. Mobile/anon/authenticated clients
-- must never receive place IDs or precise matching inputs directly.
create or replace function public.get_route_matching_candidates_internal(
  p_route_id uuid,
  p_driver_id uuid,
  p_limit integer default 5
)
returns table (
  route_id uuid,
  route_origin_place_id text,
  route_destination_place_id text,
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
  'Internal candidate preselection for google-route-matches. Returns private place IDs only to service_role; never expose directly to mobile clients.';

commit;
