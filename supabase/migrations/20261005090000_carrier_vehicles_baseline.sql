-- Baseline migrace: public.carrier_vehicles
--
-- PROČ: audit zjistil, že `carrier_vehicles` nevytváří žádná migrace v tomto
-- repozitáři. Tabulka existuje pouze v živé databázi; repo ji zná jen jako
-- cíl GRANTů (`0008_public_table_privilege_hardening.sql`) a jako dotaz v
-- `hooks/useProfile.ts`. Čistá instalace z repozitáře by ji nezaložila.
--
-- Tato migrace ji zaznamená do historie tak, aby byla reprodukovatelná.
--
-- CO JE BEZPEČNÉ VŮČI EXISTUJÍCÍ ŽIVÉ TABULCE:
--   * celé tělo je idempotentní (`if not exists`) a neobsahuje žádné DML,
--   * nepřidává ani neruší sloupec, constraint, policy ani grant — u existující
--     tabulky jsou `create ... if not exists` a `drop policy if exists` no-op,
--   * data se nemění: žádný INSERT/UPDATE/DELETE/TRUNCATE,
--   * existující řádky (3) zůstanou nedotčené.
--
-- CO MIGRACE DĚLÁ, POKUD TABULKA JEště NEEXISTUJE (čistá instalace):
--   * vytvoří ji ve stejné podobě jako živá (sloupce, typy, defaults, FK, CHECKy),
--   * zapne RLS a založí 6 policies,
--   * založí 2 indexy a 3 GRANTy.
--
-- POZNÁMKA K `ON DELETE CASCADE`: shoduje se s živou tabulkou
-- (`carrier_vehicles_carrier_id_fkey`). Změna na RESTRICT by byla bezpečnější,
-- ale měnila by chování živé tabulky — to je samostatné rozhodnutí pro fázi 2.

begin;

create table if not exists public.carrier_vehicles (
  -- Primární klíč. Živá tabulka používá gen_random_uuid() bez versionu.
  id uuid primary key default gen_random_uuid(),

  -- Vlastník je PŘEPRAVNÍ PROFIL, ne profil uživatele. Vlastnictví uživatele
  -- se odvozuje přes carrier_profiles.user_id v RLS policies níže.
  carrier_id uuid not null references public.carrier_profiles(id) on delete cascade,

  -- Název techniky; zobrazovaný v seznamu přepravních vozidel.
  name text,

  -- Jediný povinný sloupec kromě vazby: klasifikace techniky (rampa, vlek, …).
  vehicle_type text not null,

  make text,
  model text,
  year integer,
  registration_number text,

  -- Rozměry a nosnost. CHECKy jsou shodné s živou tabulkou a připouštějí NULL
  -- (neznámá hodnota), ale odmítají nulu a záporné číslo.
  max_weight_kg integer,
  max_vehicle_length_cm integer,
  max_vehicle_width_cm integer,
  max_vehicle_height_cm integer,
  capacity integer,

  -- Vybavení techniky. NOT NULL + default false, stejně jako živá tabulka.
  has_winch boolean not null default false,
  has_hydraulic_platform boolean not null default false,
  has_ramps boolean not null default false,
  has_straps boolean not null default false,
  has_jump_starter boolean not null default false,
  has_compressor boolean not null default false,

  description text,

  -- Soft stav: neaktivní technika se ve veřejném výběru nenabízí.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint carrier_vehicles_max_weight_kg_check
    check (max_weight_kg is null or max_weight_kg > 0),
  constraint carrier_vehicles_max_vehicle_length_cm_check
    check (max_vehicle_length_cm is null or max_vehicle_length_cm > 0),
  constraint carrier_vehicles_max_vehicle_width_cm_check
    check (max_vehicle_width_cm is null or max_vehicle_width_cm > 0),
  constraint carrier_vehicles_max_vehicle_height_cm_check
    check (max_vehicle_height_cm is null or max_vehicle_height_cm > 0),
  constraint carrier_vehicles_capacity_check
    check (capacity is null or capacity > 0)
);

comment on table public.carrier_vehicles is
  'Carrier vehicles (towing equipment) owned by a carrier profile. Used for capacity, offers and matching.';
comment on column public.carrier_vehicles.carrier_id is
  'Owning carrier profile. User ownership is derived via carrier_profiles.user_id in RLS.';
comment on column public.carrier_vehicles.is_active is
  'Inactive vehicles stay stored but are not offered publicly.';

-- RLS: řádky patří přepravci, jehož carrier_profiles.user_id = auth.uid().
-- U existující tabulky je to no-op, u nové se RLS zapne.
alter table public.carrier_vehicles enable row level security;

-- U existující tabulky jsou tyto DROP no-op, takže se NEpřepíší; u nové
-- tabulky nejde o nic, co by nebylo možné znovu založit.
drop policy if exists "Carriers can view their own vehicles" on public.carrier_vehicles;
create policy "Carriers can view their own vehicles"
  on public.carrier_vehicles for select to authenticated
  using (exists (
    select 1 from public.carrier_profiles
    where carrier_profiles.id = carrier_vehicles.carrier_id
      and carrier_profiles.user_id = auth.uid()
  ));

drop policy if exists "Carriers can create their own vehicles" on public.carrier_vehicles;
create policy "Carriers can create their own vehicles"
  on public.carrier_vehicles for insert to authenticated
  with check (exists (
    select 1 from public.carrier_profiles
    where carrier_profiles.id = carrier_vehicles.carrier_id
      and carrier_profiles.user_id = auth.uid()
  ));

drop policy if exists "Carriers can update their own vehicles" on public.carrier_vehicles;
create policy "Carriers can update their own vehicles"
  on public.carrier_vehicles for update to authenticated
  using (exists (
    select 1 from public.carrier_profiles
    where carrier_profiles.id = carrier_vehicles.carrier_id
      and carrier_profiles.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.carrier_profiles
    where carrier_profiles.id = carrier_vehicles.carrier_id
      and carrier_profiles.user_id = auth.uid()
  ));

drop policy if exists "Carriers can delete their own vehicles" on public.carrier_vehicles;
create policy "Carriers can delete their own vehicles"
  on public.carrier_vehicles for delete to authenticated
  using (exists (
    select 1 from public.carrier_profiles
    where carrier_profiles.id = carrier_vehicles.carrier_id
      and carrier_profiles.user_id = auth.uid()
  ));

-- Veřejné čtení aktivních vozidel: ostatní přihlášení uživatelé mohou vidět
-- techniku v active přepravcích profilech, ale nikdy cizí neaktivní.
drop policy if exists "Users can view active carrier vehicles" on public.carrier_vehicles;
create policy "Users can view active carrier vehicles"
  on public.carrier_vehicles for select to authenticated
  using (is_active = true and exists (
    select 1 from public.carrier_profiles
    where carrier_profiles.id = carrier_vehicles.carrier_id
      and carrier_profiles.status = 'active'
  ));

-- Širší politika zajišťující celé CRUD vlastníka (shodná s živou tabulkou).
drop policy if exists "carrier_vehicles_all" on public.carrier_vehicles;
create policy "carrier_vehicles_all"
  on public.carrier_vehicles for all to authenticated
  using (carrier_id in (
    select carrier_profiles.id from public.carrier_profiles
    where carrier_profiles.user_id = auth.uid()
  ))
  with check (carrier_id in (
    select carrier_profiles.id from public.carrier_profiles
    where carrier_profiles.user_id = auth.uid()
  ));

-- Nové tabulky v public schématu zdědí široká práva; odebereme je explicitně.
-- U existující tabulky jsou revoke/grant idempotentní a výsledný stav je stejný
-- jako dnes: anon nic, authenticated jen svá vozidla.
revoke all on table public.carrier_vehicles from public;
revoke all on table public.carrier_vehicles from anon;
revoke all on table public.carrier_vehicles from authenticated;

grant select, insert, update, delete on table public.carrier_vehicles to authenticated;

-- Bez TRUNCATE: i pro authenticated zůstává tabulka nedrátovatelná.
create index if not exists idx_carrier_vehicles_carrier_id
  on public.carrier_vehicles(carrier_id);
create index if not exists idx_carrier_vehicles_active
  on public.carrier_vehicles(is_active);

commit;
