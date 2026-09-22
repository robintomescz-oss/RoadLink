-- MANUAL ONLY / DESTRUCTIVE ROLLBACK
--
-- Use only after an explicit human decision. This rollback removes the public
-- marketplace RPCs, indexes, constraints, and public label columns introduced by
-- 0014_public_marketplace_feeds.sql.
--
-- WARNING: Dropping public label columns after the app starts using them will
-- permanently delete all stored public label data:
--   public.tow_requests.pickup_public_label
--   public.tow_requests.destination_public_label
--   public.carrier_routes.from_public_label
--   public.carrier_routes.to_public_label

begin;

revoke all on function public.get_public_marketplace_requests(integer, integer) from public;
revoke all on function public.get_public_marketplace_requests(integer, integer) from anon;
revoke all on function public.get_public_marketplace_requests(integer, integer) from authenticated;
revoke all on function public.get_public_marketplace_routes(integer, integer) from public;
revoke all on function public.get_public_marketplace_routes(integer, integer) from anon;
revoke all on function public.get_public_marketplace_routes(integer, integer) from authenticated;

drop function if exists public.get_public_marketplace_requests(integer, integer);
drop function if exists public.get_public_marketplace_routes(integer, integer);

drop index if exists public.tow_requests_public_open_feed_idx;
drop index if exists public.carrier_routes_public_open_feed_idx;

alter table public.tow_requests
  drop constraint if exists tow_requests_pickup_public_label_safe,
  drop constraint if exists tow_requests_destination_public_label_safe,
  drop column if exists pickup_public_label,
  drop column if exists destination_public_label;

alter table public.carrier_routes
  drop constraint if exists carrier_routes_from_public_label_safe,
  drop constraint if exists carrier_routes_to_public_label_safe,
  drop column if exists from_public_label,
  drop column if exists to_public_label;

commit;
