-- ══════════════════════════════════════════════════════════════════════════════
-- KONTROLA PŘED NASAZENÍM (read-only) — nic nemění
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Cílový projekt: RoadLink (vbmxnrhmdjmqrsdtgjkn)
--
-- Vložte do SQL Editoru a spusťte. Musí doběhnout bez chyby a bez změn.
-- Teprve potom spouštějte jednotlivé kroky. Zkontrolujte sloupec
-- 'zavre_kontrola' a řádky 'is_spatial' / 'has_via' / 'has_proximity'.

SELECT
  CASE WHEN f.proname IS NOT NULL THEN 'ANO' ELSE 'NE' END AS rpc_existuje,
  CASE
    WHEN f.proname IS NULL THEN 'ANO — zacnete krokem 1'
    WHEN pg_get_functiondef(f.oid) LIKE '%ST_DWithin%' THEN 'ANO — krok 6 uz prosel'
    ELSE 'NE — krok 6 jeste neprosel'
  END AS is_spatial,
  CASE
    WHEN f.proname IS NULL THEN 'NE'
    WHEN pg_get_functiondef(f.oid) LIKE '%route_via_place_ids%' THEN 'ANO — kroky 1 a 2 prosel'
    ELSE 'NE — kroky 1 a 2 jeste neprosel'
  END AS has_via,
  CASE
    WHEN f.proname IS NULL THEN 'NE'
    WHEN pg_get_functiondef(f.oid) LIKE '%route_proximity_meters%' THEN 'ANO — krok 3 prosel'
    ELSE 'NE — krok 3 jeste neprosel'
  END AS has_proximity,
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM information_schema.routine_privileges
         WHERE routine_schema='public' AND routine_name='get_route_matching_candidates_internal'
           AND grantee IN ('anon','authenticated')
       ) THEN 'ANO — anon ani authenticated nemaji pristup'
       ELSE 'NE — ZASTAVTE, nektery z nich ma pristup!' END AS soukromi,
  -- 'postgres' je vlastník funkce, takže jeho EXECUTE je v pořádku a očekáváme
  -- ho. 'anon' ani 'authenticated' tam být nesmějí — to je sloupec soukromi.
  CASE
    WHEN col.new_columns = 0 THEN 'ANO — cisty start, zacnete krokem 1'
    WHEN col.new_columns IS NULL THEN 'ANO — tabulka carrier_routes jeste neexistuje'
    ELSE 'NE — neco uz bylo aplikovano, NEZACÍNAJTE OD KROKU 1'
  END AS sloupce_stav,
  CASE
    WHEN f.proname IS NULL OR col.new_columns = 0 THEN 'ANO — muzete zacit krokem 1'
    ELSE 'NE — nejdrive mi poslete tento vystup, rozhodneme odkud pokracovat'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
LEFT JOIN LATERAL (
  SELECT proname, oid
  FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname='get_route_matching_candidates_internal'
  LIMIT 1
) AS f ON true
CROSS JOIN LATERAL (
  SELECT count(*) AS new_columns
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='carrier_routes'
    AND column_name IN ('via_latitudes','via_longitudes','bbox_min_lat','bbox_max_lat',
                        'bbox_min_lng','bbox_max_lng','route_line')
) AS col;

-- Objemy pro interpretaci plánu později. Počet sloupců se zjišťuje přes
-- information_schema, ne přímým čtením dat: na čisté databázi by přímý dotaz
-- na route_line skončil chybou "column does not exist".
SELECT
  (SELECT count(*) FROM public.carrier_routes) AS routes_total,
  (SELECT count(*) FROM public.tow_requests) AS requests_total,
  (SELECT count(*) FROM public.tow_requests WHERE status='open') AS requests_open;

-- Záloha. V Dashboardu → Database → Backups si ověřte, že existuje bod obnovy.
-- Migrace 1–3 mění návratový typ RPC, takže je potřeba mít kam se vrátit.
