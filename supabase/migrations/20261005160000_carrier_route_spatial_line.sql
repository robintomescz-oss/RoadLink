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
-- Prázdná / vadná geometrie: když chybí souřadnice odjezdu nebo cíle, nebo jsou
-- průjezdné body v rozporu se svými souřadnicemi, zůstane `route_line` NULL.
-- Matching pak kandidáty bez geometrie nikdy nevyřadí a zařadí je na konec
-- pořadí.
--
-- TRASA BEZ PRŮJEZDNÝCH BODŮ MÁ GEOMETRII. Podmínka úplnosti je sdílená s obdélníkem
-- (`carrier_route_via_coordinates_valid`, migrace 20261005145000): prázdný seznam
-- průjezdných bodů je platný stav, takže přímá trasa dostane lomenou čáru ze dvou
-- krajních bodů. Dřívější verze zde měla `new.via_latitudes is null` mezi podmínkami
-- pro NULL, a tím geometrii odebírala právě všem trasám bez průjezdných bodů.

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
     or not public.carrier_route_via_coordinates_valid(
       new.via_place_ids, new.via_latitudes, new.via_longitudes
     ) then
    new.route_line := null;
    return new;
  end if;

  -- Body se skládají v POŘADÍ cesty: odjezd → průjezdné body → cíl. Pole se
  -- staví jako pole pomocí array_agg, ne přes `||`.
  --
  -- PROČ NE `||`: operátor `||` na typu `geography` v PostGIS NESKLÁDÁ
  -- geometrie. Řadí se mezi textové/pole operátory, takže Postgres zkouší
  -- parsovat WKB jako pole a končí `malformed array literal`. Stejný
  -- operátor na poli `geography[]` skládá správně, a proto je potřeba, aby
  -- obě strany byly pole.
  --
  -- PROČ NE ST_MakeLine U JEDNOTLIVÝCH ČÁSTÍ: ST_MakeLine vrací *lomenou
  -- čáru*, ne bod. Poskládat z ní pole by dalo [bod, čára, bod] a ne
  -- jednotlivé vrcholy. Vrcholy proto sbírá array_agg nad unnest a lomená
  -- čára vznikne až jednou ze všech bodů.
  v_points := array(
    select extensions.ST_MakePoint(v.lng, v.lat)::extensions.geography
    from unnest(
      array[new.from_lng] || coalesce(new.via_longitudes, '{}'::double precision[]) || array[new.to_lng],
      array[new.from_lat] || coalesce(new.via_latitudes, '{}'::double precision[]) || array[new.to_lat]
    ) as v(lng, lat)
  );

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