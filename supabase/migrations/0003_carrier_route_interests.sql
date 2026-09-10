-- M2.5b: discovery interest only; offers and transport lifecycle stay unchanged.
-- Review and apply manually. Do not run the matching rollback as a forward migration.
-- Identity: tow_requests.customer_id and carrier_routes.driver_id are auth user IDs
-- (profiles.id), not carrier_profiles.id.
-- Parent-table SELECT privileges/RLS still apply to the EXISTS checks below.
-- Verify those live policies before deployment: the local schema.sql is an old
-- scaffold and does not contain the current parent-table definitions or policies.
-- This migration does not bypass or change parent RLS. Inaccessible parents
-- fail closed. Status/capacity checks apply when inserting, not retroactively.
-- Deliberately fail if the table already exists instead of accepting unknown
-- columns, constraints or permissive policies from an earlier deployment.

begin;

create table public.carrier_route_interests (
  id uuid primary key default gen_random_uuid(),
  carrier_route_id uuid not null
    references public.carrier_routes(id) on delete cascade,
  tow_request_id uuid not null
    references public.tow_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint carrier_route_interests_route_request_key
    unique (carrier_route_id, tow_request_id)
);

alter table public.carrier_route_interests enable row level security;

-- Remove any inherited/default API grants; V1 has no UPDATE access.
revoke all privileges on table public.carrier_route_interests
  from public, anon, authenticated;
grant select, insert, delete on table public.carrier_route_interests
  to authenticated;

create policy carrier_route_interests_select_participant
  on public.carrier_route_interests
  for select to authenticated
  using (
    exists (
      select 1 from public.tow_requests as request
      where request.id = carrier_route_interests.tow_request_id
        and request.customer_id = (select auth.uid())
    )
    or exists (
      select 1 from public.carrier_routes as route
      where route.id = carrier_route_interests.carrier_route_id
        and route.driver_id = (select auth.uid())
    )
  );

create policy carrier_route_interests_insert_request_owner
  on public.carrier_route_interests
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tow_requests as request
      where request.id = carrier_route_interests.tow_request_id
        and request.customer_id = (select auth.uid())
        and request.status = 'open'
    )
    and exists (
      select 1 from public.carrier_routes as route
      where route.id = carrier_route_interests.carrier_route_id
        and route.status = 'open'
        and route.available_spaces > 0
    )
  );

create policy carrier_route_interests_delete_request_owner
  on public.carrier_route_interests
  for delete to authenticated
  using (
    exists (
      select 1 from public.tow_requests as request
      where request.id = carrier_route_interests.tow_request_id
        and request.customer_id = (select auth.uid())
    )
  );

commit;
