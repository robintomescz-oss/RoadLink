begin;

-- Průjezdní body volné kapacity (např. "Cheb → Praha přes Plzeň").
--
-- Ukládáme POUZE Google place ID, nikdy adresu ani souřadnice — stejně jako
-- u odjezdu a cíle. Pole je nullable a prázdné pole znamená přímou trasu,
-- takže staré řádky i nové trasy bez průjezdu zůstávají v pořádku.
--
-- Veřejné labely se ukládají odděleně do via_public_labels, aby se do
-- anonymního trhu dostal jen město/obec, nikdy přesná adresa.
--
-- Průjezdní body jsou veřejné: limit 3 odpovídá tomu, co přepravce reálně
-- potřebuje, a zároveň hlídá délku trasy. Google Routes má limit 25
-- intermediates, ale delší trasa ztrácí smysl jako „volné místo k odvozu".
alter table public.carrier_routes
  add column if not exists via_place_ids text[],
  add column if not exists via_public_labels text[];

comment on column public.carrier_routes.via_place_ids is
  'Place ID průjezdních bodů trasy (max 3). Prázdné = přímá trasa bez průjezdu.';
comment on column public.carrier_routes.via_public_labels is
  'Veřejné názvy oblastí průjezdních bodů (město/obec), nikdy přesné adresy.';

-- Řádné typy a délky stejně jako u ostatních veřejných labelů.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'carrier_routes_via_place_ids_len'
  ) then
    alter table public.carrier_routes
      add constraint carrier_routes_via_place_ids_len
      check (via_place_ids is null or coalesce(array_length(via_place_ids, 1), 0) <= 3);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'carrier_routes_via_public_labels_len'
  ) then
    alter table public.carrier_routes
      add constraint carrier_routes_via_public_labels_len
      check (via_public_labels is null or coalesce(array_length(via_public_labels, 1), 0) <= 3);
  end if;

  -- Place ID je neprůhledný token se stejnou znakovou sadou jako origin/destination.
  -- POZOR: Postgres v CHECK constraintu nepřipouští poddotaz, proto tvar place ID
  -- kontroluje trigger (funkce validate_carrier_route_via_places) níže.
  -- V CHECK zůstává jen délka, která je na poli.

  -- Obě pole patří ksobě: buď jsou obě, nebo žádné.
  if not exists (
    select 1 from pg_constraint where conname = 'carrier_routes_via_labels_together'
  ) then
    alter table public.carrier_routes
      add constraint carrier_routes_via_labels_together
      check ((via_place_ids is null) = (via_public_labels is null));
  end if;
end
$$;

-- Validace obsahu průjezdních bodů. CHECK sem subquery nepropustí, proto
-- používáme BEFORE INSERT/UPDATE trigger. Bez něj by do pole mohla proniknout
-- prázdná hodnota nebo text, který není place ID (např. volná adresa).
-- Trigger je vlastní funkce tabulky, ne výchozí systémová — SECURITY DEFINER
-- není potřeba, protože nesmí přistupovat k žádné jiné tabulce.
create or replace function public.validate_carrier_route_via_places()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.via_place_ids is not null then
    if exists (
      select 1
      from unnest(new.via_place_ids) as v(value)
      where value is null
         or btrim(value) = ''
         or value !~ '^[A-Za-z0-9_.-]+$'
    ) then
      raise exception 'Průjezdní body musí být platná Google place ID.';
    end if;

    if new.via_public_labels is not null
       and array_length(new.via_public_labels, 1) is distinct from array_length(new.via_place_ids, 1) then
      raise exception 'Počet veřejných názvů průjezdních bodů musí odpovídat počtu place ID.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists carrier_routes_via_places_validate on public.carrier_routes;
create trigger carrier_routes_via_places_validate
  before insert or update on public.carrier_routes
  for each row
  execute function public.validate_carrier_route_via_places();

revoke all on function public.validate_carrier_route_via_places() from public;
revoke all on function public.validate_carrier_route_via_places() from anon;
revoke all on function public.validate_carrier_route_via_places() from authenticated;

-- Veřejný feed volných kapacit: přidáváme průjezdní labely, aby bylo vidět
-- "Cheb → Plzeň → Praha". Vrací se POUZE veřejné názvy oblastí — place ID ani
-- přesné adresy do anonymního výsledku nikdy nesmějí.
--
-- Změna RETURNS TABLE vyžaduje DROP + CREATE (Postgres nepřijme
-- CREATE OR REPLACE s jiným návratovým typem). Před DROPem jsou výslovně
-- odebrána oprávnění, aby nevzniklo okno, kdy je funkce bez grantu.
revoke all on function public.get_public_marketplace_routes(integer, integer) from public;
revoke all on function public.get_public_marketplace_routes(integer, integer) from anon;
revoke all on function public.get_public_marketplace_routes(integer, integer) from authenticated;
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
  via_labels text[],
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
    cr.via_public_labels as via_labels,
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
grant execute on function public.get_public_marketplace_routes(integer, integer) to anon, authenticated;

commit;
