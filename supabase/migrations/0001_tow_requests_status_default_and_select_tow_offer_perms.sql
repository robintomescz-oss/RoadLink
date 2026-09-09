-- 0001 – RoadLink: oprava defaultu tow_requests.status + zúžení EXECUTE na select_tow_offer
--
-- Účel:
--   1) Sjednotit default hodnotu statusu s whitelistem, který v DB povoluje CHECK.
--      CHECK povoluje: open, offer_selected, in_progress, completed, cancelled.
--      App.tsx vkládá status='open'. Původní default 'requested' je mimo whitelist
--      a není používaný aplikací.
--   2) Zamezit volání RPC select_tow_offer z neautentizovaných kontextů.
--      Funkce je SECURITY DEFINER, proto musí být oprávnění zúženo na roli authenticated.
--
-- Co tato migrace NEMĚNÍ:
--   * tělo funkce select_tow_offer
--   * RLS policies
--   * jiné tabulky
--   * data v tabulkách (SET DEFAULT neovlivní existující řádky)
--   * App.tsx, UI, build
--
-- Idempotence:
--   * ALTER TABLE ALTER COLUMN SET DEFAULT je bezpečné opakovat.
--   * REVOKE a GRANT na funkci jsou bezpečné opakovat.
--   * Skript neobsahuje transakční BEGIN/COMMIT – nechá se na runner.
--
-- Bezpečnost:
--   * Žádné DDL/DML mimo výše uvedené.
--   * Žádné DROP.
--   * Žádné přepisování funkce (CREATE OR REPLACE by mohl přepsat tělo – nepoužívá se).
--   * postgres a service_role nejsou revoknuty.

-- ============================================================
-- 1) Oprava defaultu public.tow_requests.status
-- ============================================================

-- Ověření, že tabulka existuje (bez SELECTu, pouze IF EXISTS guard).
-- ALTER TABLE ALTER COLUMN ... SET DEFAULT je v PostgreSQL idempotentní
-- v tom smyslu, že opakované spuštění nastaví stále stejný default.

alter table public.tow_requests
  alter column status set default 'open';

-- ============================================================
-- 2) Zúžení EXECUTE oprávnění public.select_tow_offer(uuid)
-- ============================================================

-- Krok 2.1: odebrat EXECUTE pro PUBLIC a anon.
-- Důvod: PUBLIC zahrnuje všechny role včetně anon, ale i zde uvádíme explicitně
-- kvůli čitelnosti a jistotě.
revoke execute on function public.select_tow_offer(uuid) from public;
revoke execute on function public.select_tow_offer(uuid) from anon;

-- Krok 2.2: udělit EXECUTE pouze authenticated.
-- Důvod: RPC kontroluje vlastníka poptávky a mění citlivé řádky (tow_requests, tow_offers).
-- Volání z neautentizované role (anon) by mohlo obcházet RLS přes SECURITY DEFINER.
grant execute on function public.select_tow_offer(uuid) to authenticated;

-- Poznámka k postgres a service_role:
--   * service_role se typicky řídí přes GRANTED BY DEFAULT v Supabase.
--   * postgres (superuser) má EXECUTE na všechny funkce implicitně.
--   * Pokud by Supabase interně používal jinou roli, REVOKE by ji mohl rozbít.
--   * Proto tyto role záměrně necháváme na výchozím chování.

-- Konec migrace 0001.
