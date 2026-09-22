-- Manual rollback ONLY for 0003_carrier_route_interests.sql.
-- Do not include this file in forward migration execution.
-- WARNING: removes all saved interests. Export them first if retention is needed.
-- Parent routes, requests, offers and their RLS remain unchanged.
-- No CASCADE: unexpected external dependencies must block rollback.

begin;
drop table if exists public.carrier_route_interests;
commit;
