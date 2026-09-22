begin;

-- Public labels are deliberately separate from precise address fields.
-- They are nullable so older/private records are not automatically exposed.
alter table public.tow_requests
  add column if not exists pickup_public_label text,
  add column if not exists destination_public_label text;

alter table public.carrier_routes
  add column if not exists from_public_label text,
  add column if not exists to_public_label text;

alter table public.tow_requests
  add constraint tow_requests_pickup_public_label_safe
    check (pickup_public_label is null or (btrim(pickup_public_label) <> '' and char_length(pickup_public_label) <= 80)),
  add constraint tow_requests_destination_public_label_safe
    check (destination_public_label is null or (btrim(destination_public_label) <> '' and char_length(destination_public_label) <= 80));

alter table public.carrier_routes
  add constraint carrier_routes_from_public_label_safe
    check (from_public_label is null or (btrim(from_public_label) <> '' and char_length(from_public_label) <= 80)),
  add constraint carrier_routes_to_public_label_safe
    check (to_public_label is null or (btrim(to_public_label) <> '' and char_length(to_public_label) <= 80));

comment on column public.tow_requests.pickup_public_label is
  'Sanitized public origin label for anonymous marketplace cards. Do not backfill from precise address without explicit review.';
comment on column public.tow_requests.destination_public_label is
  'Sanitized public destination label for anonymous marketplace cards. Do not backfill from precise address without explicit review.';
comment on column public.carrier_routes.from_public_label is
  'Sanitized public origin label for anonymous marketplace cards. Do not backfill from precise address without explicit review.';
comment on column public.carrier_routes.to_public_label is
  'Sanitized public destination label for anonymous marketplace cards. Do not backfill from precise address without explicit review.';

-- Live audit found only primary-key indexes on these feed tables, so add narrow
-- partial indexes for the exact public feed predicates and stable ordering.
create index if not exists tow_requests_public_open_feed_idx
  on public.tow_requests (created_at desc, id desc)
  where status = 'open';

create index if not exists carrier_routes_public_open_feed_idx
  on public.carrier_routes (departure_at asc nulls last, created_at desc, id desc)
  where status = 'open';

create function public.get_public_marketplace_requests(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  public_id uuid,
  item_type text,
  origin_label text,
  destination_label text,
  vehicle_type text,
  vehicle_mobility text,
  requested_date date,
  date_to date,
  time_preference text,
  created_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tr.id as public_id,
    'tow_request'::text as item_type,
    tr.pickup_public_label as origin_label,
    tr.destination_public_label as destination_label,
    tr.vehicle_type,
    tr.vehicle_mobility,
    tr.requested_date,
    tr.date_to,
    tr.time_preference,
    tr.created_at,
    tr.status
  from public.tow_requests as tr
  where tr.status = 'open'
  order by tr.created_at desc, tr.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

create function public.get_public_marketplace_routes(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  public_id uuid,
  item_type text,
  origin_label text,
  destination_label text,
  vehicle_types text[],
  departure_at timestamptz,
  available_spaces integer,
  price numeric,
  created_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cr.id as public_id,
    'carrier_route'::text as item_type,
    cr.from_public_label as origin_label,
    cr.to_public_label as destination_label,
    cr.vehicle_types,
    cr.departure_at,
    cr.available_spaces,
    cr.price,
    cr.created_at,
    cr.status
  from public.carrier_routes as cr
  where cr.status = 'open'
  order by cr.departure_at asc nulls last, cr.created_at desc, cr.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

revoke all on function public.get_public_marketplace_requests(integer, integer) from public;
revoke all on function public.get_public_marketplace_requests(integer, integer) from anon;
revoke all on function public.get_public_marketplace_requests(integer, integer) from authenticated;
revoke all on function public.get_public_marketplace_routes(integer, integer) from public;
revoke all on function public.get_public_marketplace_routes(integer, integer) from anon;
revoke all on function public.get_public_marketplace_routes(integer, integer) from authenticated;

grant execute on function public.get_public_marketplace_requests(integer, integer) to anon, authenticated;
grant execute on function public.get_public_marketplace_routes(integer, integer) to anon, authenticated;

commit;
