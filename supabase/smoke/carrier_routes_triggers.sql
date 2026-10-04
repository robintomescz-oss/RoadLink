-- ══════════════════════════════════════════════════════════════════════════════
-- KONTROLA TRIGGERŮ NA carrier_routes (read-only) — nic nemění
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Kdy spustit: PŘED odloženým úklidem 20261005180000 (krok 8 runbooku), tedy po
-- krocích 130000 / 145000 / 160000. Ověřuje, že v databázi koexistují všechny tři
-- triggery v očekávaném stavu — teprve pak má úklid smysl pouštět.
--
-- PO ÚKLIDU (20261005180000) už `carrier_routes_bbox_assign` neexistuje a trigger
-- odvozující geometrii se jmenuje `carrier_routes_route_geometry_assign`. Tato
-- kontrola je proto branou PŘED úklidem, ne po něm. Stav po úklidu ověřuje sekce
-- B v `docs/matching-deployment-runbook.md`, krok 8, a `matching_spatial_smoke.sql`.
--
-- Jak: Supabase Dashboard → SQL Editor, nebo
--   psql "$DATABASE_URL" -f supabase/smoke/carrier_routes_triggers.sql
--
-- Skript nic NEZAPISUJE a nic NEMAŽE. Jen čte katalog.
--
-- Ověřuje tři triggery a jejich navázání:
--
--   carrier_routes_via_places_validate   -> validate_carrier_route_via_places()   (krok 130000)
--   carrier_routes_bbox_assign           -> assign_carrier_route_bbox()           (kroky 140000/145000)
--   carrier_routes_route_line_assign     -> assign_carrier_route_line()           (krok 160000)
--
-- Očekávaná konfigurace u všech tří:
--   tgenabled = 'O'   trigger běží (origin, zapnutý)
--   BEFORE INSERT OR UPDATE FOR EACH ROW
--
-- tgtype se NESMÍ porovnávat číslem. Bitová hodnota pro BEFORE INSERT OR UPDATE
-- FOR EACH ROW je 1(ROW) + 2(BEFORE) + 4(INSERT) + 16(UPDATE) = 23, ne 15 —
-- 15 by znamenalo INSERT + DELETE bez UPDATE. Místo čísla se kontroluje text
-- definice triggeru, stejně jako v docs/matching-deployment-runbook.md.
--
-- Výstup: tři řádky, sloupec 'radek_ok' musí být pokaždé 'ANO' a sloupec
-- 'celkovy_verdikt' musí být 'ANO — všechny tři triggery jsou přítomné a zapnuté'.

WITH ocekavano(poradi, trigger_name, popis, trigger_fn) AS (
  VALUES
    (1, 'carrier_routes_via_places_validate',
        'Krok 130000 — validuje via_place_ids', 'validate_carrier_route_via_places'),
    (2, 'carrier_routes_bbox_assign',
        'Kroky 140000/145000 — dopočítá bbox_min/max_lat/lng', 'assign_carrier_route_bbox'),
    (3, 'carrier_routes_route_line_assign',
        'Krok 160000 — dopočítá route_line', 'assign_carrier_route_line')
),
stav AS (
  SELECT
    o.poradi,
    o.trigger_name,
    o.popis,
    o.trigger_fn AS ocekavana_funkce,
    (t.tgname IS NOT NULL) AS existuje,
    coalesce(t.tgenabled::text, 'n/a') AS tgenabled,
    coalesce(pg_get_triggerdef(t.oid), 'n/a') AS definice,
    coalesce(f.proname, 'n/a') AS skutecna_funkce,
    CASE
      WHEN t.tgname IS NULL                       THEN 1
      WHEN t.tgenabled::text <> 'O'               THEN 1
      WHEN pg_get_triggerdef(t.oid) NOT ILIKE '%BEFORE INSERT OR UPDATE%'
                                                 THEN 1
      WHEN pg_get_triggerdef(t.oid) NOT ILIKE '%FOR EACH ROW%'        THEN 1
      WHEN f.proname IS DISTINCT FROM o.trigger_fn                    THEN 1
      ELSE 0
    END AS problematicky
  FROM ocekavano o
  LEFT JOIN pg_trigger t
    ON t.tgrelid = 'public.carrier_routes'::regclass
   AND t.tgname = o.trigger_name
   AND NOT t.tgisinternal
  LEFT JOIN pg_proc f
    ON f.oid = t.tgfoid
)
SELECT
  trigger_name,
  popis,
  existuje,
  tgenabled,
  ocekavana_funkce,
  skutecna_funkce,
  definice,
  CASE WHEN problematicky = 0 THEN 'ANO' ELSE 'NE' END AS radek_ok,
  CASE
    WHEN problematicky = 0
      THEN 'ANO — trigger zapnutý, BEFORE INSERT OR UPDATE FOR EACH ROW, správná funkce'
    WHEN existuje IS FALSE
      THEN 'NE — trigger v databázi není, příslušný krok nebyl aplikován'
    WHEN tgenabled <> 'O'
      THEN 'NE — trigger je VYPNUTÝ (tgenabled=' || tgenabled || '), data se nepřepočítávají'
    WHEN definice NOT ILIKE '%BEFORE INSERT OR UPDATE%'
      THEN 'NE — trigger není BEFORE INSERT OR UPDATE: ' || definice
    WHEN definice NOT ILIKE '%FOR EACH ROW%'
      THEN 'NE — trigger není FOR EACH ROW: ' || definice
    ELSE 'NE — trigger ukazuje na jinou funkci: ' || skutecna_funkce
  END AS zavre_kontrola,
  sum(problematicky) OVER () AS problemu_celkem,
  CASE WHEN sum(problematicky) OVER () = 0
       THEN 'ANO — všechny tři triggery jsou přítomné a zapnuté'
       ELSE 'NE — ' || sum(problematicky) OVER () || ' z ' || count(*) OVER ()
            || ' triggerů nesouhlasí, DALŠÍ POSTUP NEPOUŠTĚJTE BEZ VÝSLEDKU'
  END AS celkovy_verdikt
FROM stav
ORDER BY poradi;
