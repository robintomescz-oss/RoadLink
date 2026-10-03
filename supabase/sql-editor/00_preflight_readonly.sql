-- ══════════════════════════════════════════════════════════════════════════════
-- KONTROLA PŘED NASAZENÍM (read-only) — nic nemění
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Cílový projekt: RoadLink (vbmxnrhmdjmqrsdtgjkn)
--
-- Vložte do SQL Editoru a spusťte. Musí doběhnout bez chyby a bez změn.
-- Teprve potom spouštějte jednotlivé kroky.

-- A) Které kroky už jsou v databázi aplikované?
select proname,
       pg_get_functiondef(oid) like '%ST_DWithin%' as is_spatial,
       pg_get_functiondef(oid) like '%route_via_place_ids%' as has_via,
       pg_get_functiondef(oid) like '%route_proximity_meters%' as has_proximity
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'get_route_matching_candidates_internal';

-- B) Které nové sloupce už existují?
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes'
  and (column_name like 'via_%'
    or column_name like 'bbox_%'
    or column_name = 'route_line')
order by column_name;

-- C) Objem dat (pro správnou interpretaci plánů později).
--    POZOR: ptáme se na POCET sloupců misto na jejich hodnoty. Sloupec
--    route_line ani via_* na čisté databázi ještě nemusí existovat a přímý
--    dotaz na něj by skončil chybou „column does not exist“.
select
  (select count(*) from public.carrier_routes) as routes_total,
  (select count(*) from public.tow_requests) as requests_total,
  (select count(*) from public.tow_requests where status = 'open') as requests_open,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'carrier_routes'
       and column_name in (
         'via_latitudes', 'via_longitudes',
         'bbox_min_lat', 'bbox_max_lat', 'bbox_min_lng', 'bbox_max_lng',
         'route_line'
       )) as new_columns_present;

-- D) Oprávnění interního RPC — musí být jen service_role.
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'get_route_matching_candidates_internal'
order by grantee;

-- E) Záloha. V Dashboardu → Database → Backups si ověřte, že existuje
--    bod obnovy. Migrace 1–3 mění návratový typ RPC, takže je potřeba
--    mít kam se vrátit.
--
-- JAK ČÍST VÝSTUP
--   A) je prázdné  → RPC zatím neexistuje, začínáte od kroku 1.
--      je tam řádek → některý krok už prošel. NEZACÍNAJTE ODKUD UŽ BYLO.
--      Zmínka v A) vám řekne, kam až je hotovo:
--        is_spatial = true      → krok 6 prošel
--        has_via = true         → kroky 1 a 2 prošly
--        has_proximity = true   → krok 3 prošel
--   B) prázdné     → čistý start, od kroku 1.
--   C) new_columns_present
--      0            → čistý start, začínáte krokem 1.
--      1–7 a B) je prázdné → částečně aplikované. NEZACÍNAJTE od kroku 1;
--                       napište mi výstup a rozhodneme, odkud pokračovat.
--   D) jen service_role = v pořádku.
--      Když tam bude anon nebo authenticated, ZASTAVTE a napište mi to.
