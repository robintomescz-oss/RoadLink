-- Krok 2 ze 3: skutečná prostorová geometrie trasy
--
-- Proč: `bbox_*` z kroku předchozího (20261005140000) jsou čtyři obyčejné
-- sloupce. Prostorové dotazy typu „je bod blízko trasy“ se nad nimi nedají
-- obsloužit indexem. Tato migrace přidá `route_line geography(LineString, 4326)`
-- — celou napánovanou trasu včetně průjezdních bodů jako lomenou čáru — a GiST
-- index, takže `ST_DWithin` se vyhodnotí z indexu.
--
-- Bezpečnost a idempotence:
--   * nový nullable sloupec bez backfillu cizích dat,
--   * hodnotu nikdy nezadává klient — dopočítá ji BEFORE trigger ze stejných
--     ověřených souřadnic, které už slouží pro bbox,
--   * existující řádky se dopočítají jedním průchodem (`update ... set` beze
--     změny hodnot, geometrii vypočítá trigger); žádný údaj se nemaže,
--   * sloupce `bbox_*` zůstávají beze změny, aby šla předchozí migrace vrátit;
--     uklízí se až po ověření nového RPC,
--   * `search_path = ''` a všechny PostGIS funkce volané s výslovným schématem
--     `extensions.`, aby se nespoléhalo na search_path databáze.
--
-- Prázdná / vadná geometrie: když chybí jakákoli souřadnice odjezdu, cíle či
-- průjezdního bodu (nebo je mimo rozsah), zůstane `route_line` NULL. Matching
-- pak kandidáty bez geometrie nikdy nevyřadí a zařadí je na konec pořadí.

begin;

alter table public.carrier_routes
  add column if not exists route_line extensions.geography(linestring, 4326);

comment on column public.carrier_routes.route_line is
  'Soukromá geometrie celé plánované trasy (odjezd → průjezdní body → cíl) pro filtrování kandidátů přes ST_DWithin. NULL, pokud chybí souřadnice. Nikdy se nezveřejňuje.';

-- Geometrie se nikdy nezadává ručně — vždy se přepočítá z ověřených souřadnic.
create or replace function public.assign_carrier_route_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_points extensions.geography[];
begin
  if new.from_lat is null
     or new.from_lng is null
     or new.to_lat is null
     or new.to_lng is null
     or new.via_latitudes is null
     or new.via_longitudes is null
     or cardinality(new.via_latitudes) <> cardinality(new.via_place_ids)
     or cardinality(new.via_longitudes) <> cardinality(new.via_place_ids)
     or exists (
       select 1 from unnest(new.via_latitudes) as v(value)
       where value is null or value <> value or value < -90 or value > 90
     )
     or exists (
       select 1 from unnest(new.via_longitudes) as v(value)
       where value is null or value <> value or value < -180 or value > 180
     ) then
    new.route_line := null;
    return new;
  end if;

  v_points := extensions.ST_MakePoint(new.from_lng, new.from_lat)::extensions.geography
    || extensions.ST_MakePoint(new.to_lng, new.to_lat)::extensions.geography;

  if cardinality(new.via_latitudes) > 0 then
    v_points := v_points || extensions.ST_MakeLine(array(
      select extensions.ST_MakePoint(v.lng, v.lat)::extensions.geography
      from unnest(new.via_longitudes, new.via_latitudes) as v(lng, lat)
    ));
  end if;

  new.route_line := extensions.ST_MakeLine(v_points);

  return new;
end;
$$;

drop trigger if exists carrier_routes_route_line_assign on public.carrier_routes;
create trigger carrier_routes_route_line_assign
  before insert or update on public.carrier_routes
  for each row
  execute function public.assign_carrier_route_line();

revoke all on function public.assign_carrier_route_line() from public;
revoke all on function public.assign_carrier_route_line() from anon;
revoke all on function public.assign_carrier_route_line() from authenticated;

-- Dopočet existujících řádků (zápis beze změny hodnot, geometrii vypočítá trigger).
update public.carrier_routes
set from_lat = from_lat
where route_line is null;

create index if not exists carrier_routes_route_line_gist_idx
  on public.carrier_routes using gist (route_line)
  where route_line is not null;

commit;