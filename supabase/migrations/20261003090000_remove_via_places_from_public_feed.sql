-- Zpět na přímé trasy: odstranění průjezdních bodů z veřejného feedu
--
-- Proč: migrace `20260930125629_carrier_route_via_places.sql` přidala sloupce
-- `via_place_ids` a `via_public_labels` a veřejné RPC `get_public_marketplace_routes`
-- rozšířila o výstupní sloupec `via_labels`. Průjezdní body nemají fungující cestu
-- do matchingu a v kódu byly odstraněny (reverzní commit), takže v této DB
-- zůstávají prázdné a ve feedu jen mátly.
--
-- Co tato migrace dělá:
--   * veřejné RPC vrací původní výstup bez `via_labels`.
--
-- Co tato migrace NEDĚLÁ:
--   * nemaže `via_place_ids` ani `via_public_labels` (zůstávají nullable a prázdné),
--   * nemaže žádná data v `carrier_routes`,
--   * nemění RLS, grants ani `get_public_marketplace_requests`.
--
-- Důvod nechat sloupce: `carrier_routes` je živá tabulka a sloupce jsou nullable.
-- Jejich odstranění není pro tuto funkční změnu potřeba; je to samostatná
-- migrace s vlastním plánem a kontrolou závislostí.

begin;

-- Návratový typ se mění (ubývá `via_labels`), proto DROP + CREATE.
-- CREATE OR REPLACE by na změně výstupního seznamu selhalo.
drop function if exists public.get_public_marketplace_routes(integer, integer);

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
    cr.id,
    'carrier_route'::text,
    cr.from_public_label,
    cr.to_public_label,
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

revoke all on function public.get_public_marketplace_routes(integer, integer) from public;
revoke all on function public.get_public_marketplace_routes(integer, integer) from anon;
revoke all on function public.get_public_marketplace_routes(integer, integer) from authenticated;
grant execute on function public.get_public_marketplace_routes(integer, integer) to anon, authenticated;

comment on function public.get_public_marketplace_routes(integer, integer) is
  'Public feed of open capacity routes. Returns public area labels only; via points were removed.';

commit;
