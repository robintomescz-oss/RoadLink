-- MANUAL ONLY — do not place this file in supabase/migrations.
-- Removes only the internal matching candidate RPC introduced by migration 0017.
-- It does not delete transport data and does not modify existing RLS policies.

begin;

drop function if exists public.get_route_matching_candidates_internal(uuid, uuid, integer);

commit;
