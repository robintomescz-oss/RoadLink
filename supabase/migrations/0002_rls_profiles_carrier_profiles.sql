-- 0002 – RoadLink: RLS politiky pro profiles a carrier_profiles
--
-- Účel:
--   1) Zapnout RLS na profiles a carrier_profiles.
--   2) Povolit uživateli číst a měnit pouze svůj vlastní záznam.
--   3) Multi-role na jeden účet: tentýž auth.uid() smí mít oba záznamy
--      (profiles i carrier_profiles) současně. RLS NESMÍ blokovat driver
--      funkce jen proto, že profiles.role = 'customer'.
--
-- Předpoklady (ověřené v předchozím auditu):
--   * auth.users -> profiles vazba je aplikační (bez DB FK), ale profiles.id
--     se vkládá rovno auth.users.id.
--   * carrier_profiles.user_id má FK na profiles.id.
--   * V app se carrier_profiles vytváří s user_id = auth.user.id.
--   * App může založit carrier_profiles kdykoli po registraci (při prvním
--     přepnutí na driver roli) – viz úprava loadCarrierProfile v App.tsx.
--
-- Co tato migrace NEMĚNÍ:
--   * RLS policies jiných tabulek (tow_requests, tow_offers, carrier_vehicles,
--     carrier_verification, carrier_insurance, carrier_routes).
--   * tělo select_tow_offer.
--   * výchozí migration 0001 (default status, EXECUTE oprávnění).
--   * data v tabulkách.
--   * App.tsx (úprava App.tsx je samostatný krok).
--
-- Idempotence:
--   * DROP POLICY IF EXISTS + CREATE POLICY je bezpečné opakovat.
--   * ALTER TABLE ... ENABLE ROW LEVEL SECURITY je idempotentní.
--   * Příkazy lze bezpečně spustit vícekrát.
--
-- Bezpečnost:
--   * Žádné DROP, TRUNCATE, UPDATE/INSERT nad daty.
--   * Žádné přepisování funkcí.
--   * Žádné změny v jiných tabulkách.

-- ============================================================
-- 1) profiles
-- ============================================================

alter table public.profiles
  enable row level security;

-- Čtení: uživatel smí číst pouze svůj vlastní profil.
-- service_role obchází RLS (BYPASSRLS), takže admin operace zůstávají funkční.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- Vložení: uživatel smí vložit záznam pouze se svým vlastním id.
-- Tím je zaručeno, že nikdo nemůže podvrhnout profiles.id někoho jiného.
-- Pozn.: registrace v App.tsx (signUp + profiles.insert) tento vzor dodržuje.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

-- Update: uživatel smí měnit pouze svůj vlastní profil.
-- Multi-role NEomezuje: tentýž user může mít i carrier_profiles,
-- protože profiles.role NESMÍ blokovat driver flow.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Delete: smazání vlastního profilu. Defaultně nechceme, aby si uživatelé
-- mohli mazat profily (kaskáda by smazala i jejich zakázky/nabídky).
-- Proto delete policy NEPOVOLUJEME – mazání je admin only přes service_role.
-- Tím se zabrání zneužití: "smazat profil a založit nový čistý".
-- Pokud by se v budoucnu delete povolil, je nutné explicitně řešit kaskádu
-- a dopad na tow_requests/customer_id.

-- ============================================================
-- 2) carrier_profiles
-- ============================================================

alter table public.carrier_profiles
  enable row level security;

-- Čtení: držitel carrier_profiles smí číst svůj vlastní záznam.
-- Multi-role: i když profiles.role = 'customer', pokud má user řádek
-- v carrier_profiles, smí ho číst (pro driver UI).
drop policy if exists "carrier_profiles_select_own" on public.carrier_profiles;
create policy "carrier_profiles_select_own"
  on public.carrier_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

-- Vložení: uživatel smí vložit carrier_profiles POUZE se svým user_id.
-- Tím je zaručeno, že nikdo nemůže podvrhnout carrier_profiles.user_id.
-- Toto se hodí pro nový use case v App.tsx: loadCarrierProfile vytvoří
-- profil automaticky, pokud chybí.
drop policy if exists "carrier_profiles_insert_own" on public.carrier_profiles;
create policy "carrier_profiles_insert_own"
  on public.carrier_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Update: držitel smí měnit pouze svůj carrier_profiles.
-- user_id je v WITH CHECK – chrání proti přesunu profilu na jiného usera.
drop policy if exists "carrier_profiles_update_own" on public.carrier_profiles;
create policy "carrier_profiles_update_own"
  on public.carrier_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete: opět admin only. Uživatel nesmí mazat svůj carrier_profiles
-- sám, aby se nemohl vyhýbat review procesu.
-- (Pokud se v budoucnu povolí, je nutné řešit kaskádu na carrier_vehicles,
--  carrier_verification, carrier_insurance, carrier_routes.)

-- Konec migrace 0002.
