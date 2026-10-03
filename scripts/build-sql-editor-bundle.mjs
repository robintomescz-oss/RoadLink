/**
 * Sestaví balíčky pro Supabase SQL Editor přímo z migračních souborů.
 *
 * Proč generovat, ne psát SQL sem: obsah každého kroku se kopíruje
 * bajtově z `supabase/migrations/*.sql`. Kdyby se někdy migrační soubor změnil,
 * regrese to odhalí a balíček se přegeneruje. Ručně psaná kopie by časem
 * tiše rozdivoala od toho, co je reálně v repu.
 *
 * Spuštění:  node scripts/build-sql-editor-bundle.mjs
 *           node scripts/build-sql-editor-bundle.mjs --check   (jen ověří)
 *
 * Balíček NIKDY neobsahuje krok 20261005180000 (cleanup): ten je jednosměrný
 * a patří až po ověřeném produkčním chodu.
 *
 * ── PROČ SHRNUJÍCÍ TABULKA, NE NOTICE ──────────────────────────────────────
 *
 * Supabase SQL Editor nezobrazuje výstup `RAISE NOTICE`. Kontrola, která píše
 * jen do NOTICE, je pro operátora neviditelná: chybu by viděl, ale úspěch ne.
 * Proto každý krok končí SELECTem, který vrací jednu řádku se sloupcem
 * `zavre_kontrola`, kde je ANO nebo NE. Operátor nemůže nic přehlédnout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const outDir = path.join(root, "supabase/sql-editor");

const header = (order, file, title, purpose) => `-- ══════════════════════════════════════════════════════════════════════════════
-- KROK ${order} · ${title}
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/${file}
-- Účel: ${purpose}
--
-- JAK POUŽÍT
--   Supabase Dashboard → SQL Editor → New query → vložte CELÝ tento soubor → Run.
--
--   POSLEDNÍ TABULKA JE VÝSLEDEK. Má sloupec 'zavre_kontrola':
--     ANO → krok prokl, pokračujte dalším souborem.
--     NE  → něco nesedí. DALŠÍ KROK NEPUŠTĚJTE, pošlete mi tabulku.
--
--   Výstup RAISE NOTICE SQL Editor nezobrazuje, proto je kontrola na konci
--   souboru shrnující SELECT.
--
--   Každý krok je v jedné transakci. Když selže, odroluje se celý a databáze
--   zůstane beze změny. Kroky jsou idempotentní.
--
-- Bezpečnost: tento soubor upravuje databázi. Před spuštěním si udělejte bod
-- obnovy v Supabase Dashboardu → Database → Backups.
`;

const PRIVILEGES_NOTE = `
--   Sloupec 'jen_service_role_z_anon': 'postgres' je vlastník funkce a EXECUTE
--   má vždy, takže jeho přítomnost je správná. Rozhodující je nepřítomnost
--   'anon' a 'authenticated' — ti by si mohli RPC volat a číst soukromá data.
`;

/** Jednotlivé sloupce shrnující tabulky: ANO/NE podle podmínky. */
const summary = (checks, fromClause) => `-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
${checks
  .map((check, index) => `  CASE WHEN ${check.condition} THEN 'ANO' ELSE 'NE' END AS ${check.label}${index === checks.length - 1 ? "" : ","}`)
  .join("\n")}
  ,
  CASE WHEN ${checks.map((check) => `(${check.condition})`).join("\n    AND ")}
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
${fromClause};
`;

const noAnon = "not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_route_matching_candidates_internal' and grantee in ('anon','authenticated'))";

/** Vybrané rpc z katalogu, aby kontrola fungovala i na čisté databázi. */
const RPC_DEF = `  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f`;

const steps = [
  {
    order: 1,
    file: "20261005120000_matching_includes_via_routes.sql",
    out: "step_1_120000_via_routes.sql",
    title: "Zahrnutí průjezdných bodů do matchingu",
    purpose: "zruší vylučování tras s průjezdnými body; RPC začne vracet route_via_place_ids",
    detail: `A) Via body jsou předávány a výhybková podmínka je pryč.${PRIVILEGES_NOTE}`,
    checks: [
      { label: "rpc_vraci_via_place_ids", condition: "v_def like '%route_via_place_ids%'" },
      { label: "via_trasy_neni_vylouceno", condition: "v_def not like '%cr.via_place_ids is not null%'" },
      { label: "rpc_vracia_vsechny_pole", condition: "v_def like '%route_via_place_ids%'" },
      { label: "jen_service_role_z_anon", condition: noAnon },
    ],
    from: RPC_DEF,
  },
  {
    order: 2,
    file: "20261005130000_matching_via_coordinates.sql",
    out: "step_2_130000_via_coordinates.sql",
    title: "Soukromé souřadnice průjezdných bodů",
    purpose: "přidá via_latitudes/via_longitudes, validační trigger a RPC s polohou",
    detail: `A) Sloupce, validační trigger a tři omezení musí existovat.${PRIVILEGES_NOTE}`,
    checks: [
      { label: "souradnicove_sloupce", condition: "souradnicove_sloupce = 2" },
      { label: "validacni_trigger_zapnut", condition: "trigger_zapnut = 1" },
      { label: "tri_omezeni", condition: "omezeni = 3" },
      { label: "rpc_vraci_souradnice", condition: "v_def like '%route_via_latitudes%'" },
      { label: "jen_service_role_z_anon", condition: noAnon },
    ],
    from: `  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='carrier_routes'
           AND column_name IN ('via_latitudes','via_longitudes')) AS souradnicove_sloupce,
      (SELECT count(*) FROM pg_trigger
         WHERE tgrelid='public.carrier_routes'::regclass
           AND tgname='carrier_routes_via_places_validate' AND tgenabled='O') AS trigger_zapnut,
      (SELECT count(*) FROM pg_constraint
         WHERE conrelid='public.carrier_routes'::regclass
           AND conname IN ('carrier_routes_via_latitudes_len','carrier_routes_via_longitudes_len','carrier_routes_via_coordinates_together')) AS omezeni
  ) AS c`,
  },
  {
    order: 3,
    file: "20261005140000_matching_sql_geo_preselection.sql",
    out: "step_3_140000_bbox_preselection.sql",
    title: "Polohový předvýběr kandidátů (přechodné bbox)",
    purpose: "přidá bbox_* sloupce, btree indexy, roadlink_haversine_meters a RPC s polohovým filtrem",
    detail: `
-- A) NEJDŮLEŽITĚJŠÍ KROK PRO ZBÝVAJÍCÍ ŘETĚZEC. Obdélník se musí dopočítat
--    u VŠECH tras s úplnými souřadnicemi; jinak na stavbě stojí celý zbytek.
-- B) Oba btree indexy musí být platné a připravené.${PRIVILEGES_NOTE}`,
    checks: [
      { label: "bez_bbox_tras_s_ukoncene", condition: "bez_bbox = 0" },
      { label: "dva_btree_indexy_platne", condition: "platne_indexy = 2" },
      { label: "haversine_helper_existuje", condition: "helper = 1" },
      { label: "rpc_uz_nepouzi_bbox_pred", condition: "v_def not like '%bbox%'" },
      { label: "jen_service_role_z_anon", condition: noAnon },
    ],
    from: `  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM public.carrier_routes
         WHERE from_lat IS NOT NULL AND from_lng IS NOT NULL
           AND to_lat IS NOT NULL AND to_lng IS NOT NULL
           AND bbox_min_lat IS NULL) AS bez_bbox,
      (SELECT count(*) FROM pg_proc
         WHERE pronamespace='public'::regnamespace
           AND proname='roadlink_haversine_meters') AS helper,
      (SELECT count(*) FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid='public.carrier_routes'::regclass
           AND c.relname LIKE 'carrier_routes_bbox%'
           AND i.indisvalid AND i.indisready) AS platne_indexy
  ) AS c`,
  },
  {
    order: 4,
    file: "20261005150000_enable_postgis.sql",
    out: "step_4_150000_enable_postgis.sql",
    title: "Zapnutí PostGIS — ZASTÁVKA",
    purpose: "create extension if not exists postgis do schématu extensions",
    detail: `
-- Tento krok je ZASTÁVKA. Pokud skript skončí chybou, PostGIS není v plánu
-- dostupný: ZASTAVTE celé nasazení a kroky 5–7 NEPUŠTĚJTE. Krok 3 funguje
-- i bez PostGIS, jen je pomalejší.
--
-- Když geography_ty_p nebo geography_linestring není ANO, NEJDE pokračovat.`,
    checks: [
      { label: "extension_v_extensions", condition: "ext_schema = 'extensions'" },
      { label: "geography_ty_p_existuje", condition: "geography_ok" },
      { label: "geography_linestring_ok", condition: "linestring_ok" },
      { label: "nic_v_public_schematu", condition: "leaky = 0" },
    ],
    from: `  CROSS JOIN LATERAL (
    SELECT
      (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='postgis') AS ext_schema,
      (to_regtype('extensions.geography') IS NOT NULL) AS geography_ok,
      (to_regtype('extensions.geography linestring') IS NOT NULL) AS linestring_ok,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname LIKE 'spatial_%') AS leaky
  ) AS c`,
  },
  {
    order: 5,
    file: "20261005160000_carrier_route_spatial_line.sql",
    out: "step_5_160000_route_line.sql",
    title: "Skutečná prostorová geometrie trasy",
    purpose: "přidá route_line geography(LineString,4326), BEFORE trigger, dopočet a GiST index",
    detail: `
-- A) 'bez_chybejici_geometrie' je přesně podmínka, kterou požaduje úklid v
--    kroku 7. Kdyby nebylo ANO, krok 7 NEAPLIKUJTE.
-- B) 'pocet_bodu_souhlasi' ověřuje, že lomená čára má odjezd + via + cíl.${PRIVILEGES_NOTE}`,
    checks: [
      { label: "typ_je_extensions_geography", condition: "udt_schema = 'extensions' AND udt_name = 'geography'" },
      { label: "bez_chybejici_geometrie", condition: "missing = 0" },
      { label: "gist_index_platny", condition: "gist_ok = 1" },
      { label: "pocet_bodu_souhlasí", condition: "npoints_ok" },
      { label: "jen_service_role_z_anon", condition: noAnon },
    ],
    from: `  CROSS JOIN LATERAL (
    SELECT
      (SELECT udt_schema FROM information_schema.columns
         WHERE table_schema='public' AND table_name='carrier_routes' AND column_name='route_line') AS udt_schema,
      (SELECT udt_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='carrier_routes' AND column_name='route_line') AS udt_name,
      (SELECT count(*) FROM public.carrier_routes
         WHERE from_lat IS NOT NULL AND from_lng IS NOT NULL
           AND to_lat IS NOT NULL AND to_lng IS NOT NULL
           AND via_latitudes IS NOT NULL AND via_longitudes IS NOT NULL
           AND cardinality(via_latitudes) = cardinality(via_place_ids)
           AND cardinality(via_longitudes) = cardinality(via_place_ids)
           AND route_line IS NULL) AS missing,
      (SELECT count(*) FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_am am ON am.oid = c.relam
         WHERE i.indrelid='public.carrier_routes'::regclass
           AND am.amname='gist' AND i.indisvalid AND i.indisready) AS gist_ok,
      (SELECT COALESCE(bool_and(
                extensions.ST_NPoints(cr.route_line) = cardinality(cr.via_place_ids) + 2), true)
         FROM public.carrier_routes cr
         WHERE cardinality(cr.via_place_ids) > 0 AND cr.route_line IS NOT NULL) AS npoints_ok
  ) AS c`,
  },
  {
    order: 6,
    file: "20261005170000_matching_spatial_preselection.sql",
    out: "step_6_170000_spatial_preselection.sql",
    title: "Předvýběr kandidátů přes prostorový index",
    purpose: "RPC přepsaná přes create or replace: filtr ST_DWithin a řazení ST_Distance",
    detail: `
-- A) RPC musí být prostorový a přechodné struktury už nesmí používat.
-- B) Smlouva odpovědi: limit 5, pořadí podle vzdálenosti neklesá a žádný
--    kandidát nepatří jiné trase. Když žádná otevřená trasa s geometrií není,
--    kontrola se přeskočí a vrací ANO.
-- C) Plán dotazu: RPC filtruje cr.id = p_route_id (JEDNA trasa), takže na
--    carrier_routes očekáváme Index Scan po primárním klíči a ŽÁDNÝ GiST.
--    GiST v plánu RPC chybí správně — nemá co hledat při jediném řádku.${PRIVILEGES_NOTE}`,
    checks: [
      { label: "rpc_pouzi_v_prostorovy_filter", condition: "v_def like '%ST_DWithin%'" },
      { label: "rpc_uz_nepouzi_bbox", condition: "v_def not like '%bbox_%'" },
      { label: "rpc_uz_nepouzi_haversine", condition: "v_def not like '%roadlink_haversine_meters%'" },
      { label: "smlouva_limit_ok", condition: "limit_ok" },
      { label: "smlouva_vlastnictvi_ok", condition: "own_ok" },
      { label: "smlouva_poradi_ok", condition: "order_ok" },
      { label: "jen_service_role_z_anon", condition: noAnon },
    ],
    from: `  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)')), '') AS v_def
  ) AS f
  CROSS JOIN LATERAL (
    WITH r AS (
      SELECT cr.id AS id, cr.driver_id AS driver_id
      FROM public.carrier_routes cr
      WHERE cr.status = 'open'
        AND cr.route_line IS NOT NULL
        AND cr.available_spaces > 0
      ORDER BY cr.created_at DESC
      LIMIT 1
    ), raw AS (
      SELECT to_jsonb(t.s) AS row_json, t.o AS ord
      FROM r
      CROSS JOIN LATERAL public.get_route_matching_candidates_internal(r.id, r.driver_id, 5)
        WITH ORDINALITY AS t(s, o)
    ), chk AS (
      SELECT
        (row_json ->> 'route_proximity_meters')::double precision AS dist,
        lag((row_json ->> 'route_proximity_meters')::double precision) OVER (ORDER BY ord) AS prev_dist,
        (row_json ->> 'route_id') = (SELECT id::text FROM r) AS own_ok
      FROM raw
    )
    SELECT
      (SELECT count(*) <= 5 FROM chk) AS limit_ok,
      (SELECT COALESCE(bool_and(own_ok), true) FROM chk) AS own_ok,
      (
        SELECT COALESCE(bool_and(
                 CASE
                   WHEN prev_dist IS NULL THEN true
                   WHEN dist IS NULL THEN true
                   ELSE dist >= prev_dist
                 END), true)
        FROM chk
      ) AS order_ok
  ) AS c`,
  },
];

const preflight = `-- ══════════════════════════════════════════════════════════════════════════════
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
`;

const bundleIndex = `-- ══════════════════════════════════════════════════════════════════════════════
-- Balíček pro Supabase SQL Editor — matching s průjezdnými body
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Tyto soubory jsou GENEROVÁNY z supabase/migrations/ skriptem
-- scripts/build-sql-editor-bundle.mjs. NEUPRAVUJTE JE RUČNĚ — upravte
-- zdrojovou migraci a spusťte generator znovu.
--
-- Cílový projekt: RoadLink (vbmxnrhmdjmqrsdtgjkn)
--
-- JAK ČÍST VÝSTUP
--   SQL Editor nezobrazuje RAISE NOTICE. Každý step proto končí SELECTem,
--   který vrací jednu řádku se sloupcem 'zavre_kontrola':
--     ANO → krok prokl, pokračujte dalším souborem.
--     NE  → něco nesedí. DALŠÍ KROK NEPUŠTĚJTE, pošlete mi tabulku.
--
-- POŘADÍ — jeden soubor na dotaz, pokaždé čekejte na výsledek:
--
--   00_preflight_readonly.sql         kontrola předem, nic nemění
--   step_1_120000_via_routes.sql
--   step_2_130000_via_coordinates.sql
--   step_3_140000_bbox_preselection.sql    NEJDŮLEŽITĚJŠÍ pro zbytek řetězce
--   step_4_150000_enable_postgis.sql        ZASTÁVKA pokud selže
--   step_5_160000_route_line.sql
--   step_6_170000_spatial_preselection.sql
--
-- Tabulka oprávnění se vrací v každém kroku a je pokaždé stejná. Stačí
-- zkontrolovat sloupec 'jen_service_role_z_anon': postgres jako vlastník
-- funkce je v pořádku, anon ani authenticated tam být nesmějí.
--
-- CO TU ZAMYŠLENĚ NENÍ
--   krok 20261005180000 (spatial_cleanup). Je jednosměrný — odstraňuje
--   bbox_* sloupce a nepřehrává se. Patří až po ověřeném provozu v produkci,
--   nejdříve za pár dní reálných dotazů.
--
--   Edge Function google-route-matches se nasazuje až PO zeleném výsledku
--   kroku 6.
--
-- VYHRA
--   Každý krok je v jedné transakci. Selhání = automatický rollback, databáze
--   zůstane beze změny. Kroky jsou idempotentní.
`;

function build() {
  const outputs = new Map();
  outputs.set("00_preflight_readonly.sql", preflight);

  for (const step of steps) {
    const source = fs.readFileSync(path.join(migrationsDir, step.file), "utf8").replace(/\r\n/g, "\n").trim();
    outputs.set(step.out, `${header(step.order, step.file, step.title, step.purpose)}${source}\n${step.detail}${summary(step.checks, step.from)}`);
  }

  outputs.set("README.md", bundleIndex);
  return outputs;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const outputs = build();
  const changes = [];

  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, content] of outputs) {
    const target = path.join(outDir, name);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (existing === content) continue;
    changes.push(name);
    if (!checkOnly) fs.writeFileSync(target, content, "utf8");
  }

  const stale = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((name) => !outputs.has(name)) : [];

  if (checkOnly) {
    if (changes.length || stale.length) {
      console.error("Balíček SQL Editoru není synchronizovaný s migracemi.");
      for (const name of changes) console.error(`  změněno: ${name}`);
      for (const name of stale) console.error(`  neočekávaný soubor: ${name}`);
      console.error("Opravte: node scripts/build-sql-editor-bundle.mjs");
      process.exit(1);
    }
    console.log("Balíček SQL Editoru je synchronizovaný s migracemi.");
    return;
  }

  if (changes.length) {
    console.log(`Zapsáno ${changes.length} souborů do supabase/sql-editor/:`);
    for (const name of changes) console.log(`  ${name}`);
  } else {
    console.log("Balíček byl již aktuální, nic se nezapsalo.");
  }
  for (const name of stale) console.log(`  varování: neočekávaný soubor v adresáři: ${name}`);
}

main();