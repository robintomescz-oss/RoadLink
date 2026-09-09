-- 0001_rollback.sql – manuální rollback migrace 0001
--
-- POZOR: Tento skript obnovuje PŮVODNÍ chování.
-- Nepouštět běžně. Spustit jen tehdy, pokud je potřeba vzít 0001 zpět.
--
-- Co dělá:
--   1) Vrátí default tow_requests.status na 'requested' (původní hodnota).
--   2) Obnoví EXECUTE pro PUBLIC a anon (odvolá GRANT pro authenticated).
--      Tím se vrátí stav PŘED migrací 0001.
--
-- Bezpečnost:
--   * Nemění tělo funkce, RLS, data.
--   * Postgres a service_role nejsou dotčeny.

-- 1) Vrácení defaultu
alter table public.tow_requests
  alter column status set default 'requested';

-- 2) Vrácení oprávnění funkce do stavu PŘED 0001
revoke execute on function public.select_tow_offer(uuid) from authenticated;
grant execute on function public.select_tow_offer(uuid) to public;
grant execute on function public.select_tow_offer(uuid) to anon;
-- Pozn.: Supabase standardně nechává EXECUTE pro PUBLIC/anon u SECURITY DEFINER
-- funkcí, takže tento rollback kopíruje výchozí chování platformy.

-- Konec rollbacku 0001.
