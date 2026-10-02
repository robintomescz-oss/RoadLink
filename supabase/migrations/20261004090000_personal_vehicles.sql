-- 20261004090000 – osobní vozidla uživatele (fáze 1)
--
-- Cíl: oddělit „Moje vozidla“ (soukromá vozidla pro SOS a rychlé předvyplnění)
-- od „Přepravní vozidla“ (`carrier_vehicles`, navázaná na přepravní profil).
--
-- Tato tabulka je záměrně NEZÁVISLÁ na `carrier_profiles`:
--   * vlastnictví je `user_id = auth.uid()`, ne `carrier_profiles.user_id`,
--   * `carrier_vehicles` se netýká — žádný přesun, kopie ani přejmenování,
--   * osobní vozidla se nesmí objevit v přepravním trhu, nabídce kapacity ani
--     v matchingu. Zadání to vyžaduje a regrese `personal-vehicles-regression.js`
--     to staticky hlídá.
--
-- Co tato migrace NEDĚLÁ:
--   * nemaže ani nemění `carrier_vehicles`, `carrier_profiles` nebo `profiles`,
--   * nemaže žádná data (žádný backfill, žádný INSERT/UPDATE/DELETE/DROP),
--   * nemění RLS, grants ani RPC existujících tabulek,
--   * nevytváří katalog pojišťoven — viz níže.
--
-- Proč `insurance_provider` je text, ne cizí klíč:
-- V repu není vzor referenční tabulky pojišťoven a `carrier_insurance` (která má
-- `provider_name text`) je prázdná. Zavedení katalogu je samostatné rozhodnutí
-- pro fázi 2; do té doby stačí volitelný text.
--
-- Co se NEukládá: číslo pojistné smlouvy, VIN, telefonní kontakty, e-mail ani
-- přesná poloha. Osobní vozidlo slouží jen k identifikaci v SOS situaci.

begin;

create table if not exists public.personal_vehicles (
  id uuid primary key default gen_random_uuid(),

  -- Vlastník. Cizí user_id se podstrčit nedá: RLS to ověřuje proti auth.uid().
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Minimální sada pro bezpečné předvyplnění SOS formuláře.
  nickname text not null,
  make text not null,
  model text not null,
  year integer,

  -- Neutrální možnost 'jine'/'neznámý' je součástí enumu, ne prázdný string.
  fuel_type text,

  -- Registrační značka je volitelná a neveřejná: nikdy se nezobrazuje ve
  -- veřejném feedu ani v přepravním trhu.
  registration text,

  -- Volitelný text do doby, než vznikne katalog pojišťoven (viz hlavička).
  insurance_provider text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint personal_vehicles_nickname_length check (char_length(btrim(nickname)) between 1 and 60),
  constraint personal_vehicles_make_length check (char_length(btrim(make)) between 1 and 60),
  constraint personal_vehicles_model_length check (char_length(btrim(model)) between 1 and 60),
  constraint personal_vehicles_year_range check (year is null or year between 1900 and 2100),
  constraint personal_vehicles_fuel_type_valid check (
    fuel_type is null or fuel_type in ('benzin', 'nafta', 'elektro', 'hybrid', 'lpg', 'cng', 'jine')
  ),
  constraint personal_vehicles_registration_length check (
    registration is null or char_length(btrim(registration)) between 1 and 10
  ),
  constraint personal_vehicles_insurance_provider_length check (
    insurance_provider is null or char_length(btrim(insurance_provider)) between 1 and 80
  )
);

comment on table public.personal_vehicles is
  'Private personal vehicles of a user. Used only for SOS and quick form pre-fill; never for capacity, offers or matching.';
comment on column public.personal_vehicles.user_id is
  'Owning user. Ownership is verified against auth.uid() by RLS.';
comment on column public.personal_vehicles.registration is
  'Optional private registration plate. Never exposed in the public marketplace feed.';
comment on column public.personal_vehicles.insurance_provider is
  'Optional free-text insurer name until a provider catalogue exists (phase 2).';

-- RLS zapnutá. Bez policy by table nepropouštela řádky; policy níže jsou
-- jediné, co klient může použít.
alter table public.personal_vehicles enable row level security;

-- Čtení, úprava i mazání jsou omezené na vlastní řádky. `service_role` RLS
-- obchází, ale není zde záměrně grantnutý — tabulku čte přes klient pouze
-- přihlášený uživatel, a žádná služba ji v této fázi nepotřebuje.
create policy "Users can view their own personal vehicles"
  on public.personal_vehicles for select to authenticated
  using (user_id = auth.uid());

create policy "Users can create their own personal vehicles"
  on public.personal_vehicles for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own personal vehicles"
  on public.personal_vehicles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete their own personal vehicles"
  on public.personal_vehicles for delete to authenticated
  using (user_id = auth.uid());

-- Nové tabulky v public schématu zdědí široká práva od Supabase, proto se
-- odebírají explicitně. `anon` nedostane nic: bez přihlášení se nesmí načíst
-- žádné soukromé vozidlo.
revoke all on table public.personal_vehicles from public;
revoke all on table public.personal_vehicles from anon;
revoke all on table public.personal_vehicles from authenticated;

grant select, insert, update, delete on table public.personal_vehicles to authenticated;

-- updated_at se spravuje v aplikaci, ne triggerem: žádný trigger není potřeba
-- a jeho definice by byla další věc, kterou by bylo nutné verzovat a auditovat.

create index if not exists personal_vehicles_user_id_idx
  on public.personal_vehicles(user_id);

commit;
