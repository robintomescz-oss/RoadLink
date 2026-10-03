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
--   Skript se má dokončit bez chyby a na konci vypsat NOTICE s výsledkem.
--
--   • Migrace je v jedné transakci. Když selže, odroluje se celá a databáze
--     zůstane beze změny.
--   • KROK je bezpečné pustit opakovaně (idempotentní).
--   • PO TOMTO KROKU nic jiného nespouštějte — nejdřív zkontrolujte výstup.
--
-- Bezpečnost: tento soubor upravuje databázi. Před spuštěním si udělejte
-- bod obnovy v Supabase Dashboardu → Database → Backups.
`;

const steps = [
  {
    order: 1,
    file: "20261005120000_matching_includes_via_routes.sql",
    out: "step_1_120000_via_routes.sql",
    title: "Zahrnutí průjezdných bodů do matchingu",
    purpose: "zruší vylučování tras s průjezdnými body; RPC začne vracet route_via_place_ids",
    verify: `
-- ══ KONTROLA KROKU 1 (read-only) ═══════════════════════════════════════════

-- A) Via body jsou předávány a výhybková podmínka je pryč.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)'))
    into v_def;

  if v_def is null then
    raise exception 'CHYBA: RPC po kroku 1 neexistuje.';
  end if;

  if v_def like '%route_via_place_ids%' then
    raise notice 'A) OK: RPC vrací route_via_place_ids.';
  else
    raise exception 'CHYBA: RPC nevrací route_via_place_ids.';
  end if;

  if v_def like '%cr.via_place_ids is not null%' then
    raise exception 'CHYBA: RPC stále vylučuje trasy s průjezdními body.';
  end if;

  raise notice 'A) OK: trasy s průjezdními body nejsou vylučovány.';
end;
$$;

-- B) Oprávnění: EXECUTE smí jen service_role. Pokud vidíte anon nebo
--    authenticated, migrace se neaplikovala celá — STOP.
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'get_route_matching_candidates_internal'
order by grantee;

-- C) Vyhodnoťte B): očekáváno je JEDEN řádek se service_role.
--    Pokud jsou tam i řádky s jiným grantee, migraci vracetejte.
`,
  },
  {
    order: 2,
    file: "20261005130000_matching_via_coordinates.sql",
    out: "step_2_130000_via_coordinates.sql",
    title: "Soukromé souřadnice průjezdných bodů",
    purpose: "přidá via_latitudes/via_longitudes, validační trigger a RPC s polohou",
    verify: `
-- ══ KONTROLA KROKU 2 (read-only) ═══════════════════════════════════════════

-- A) Sloupce jsou přítomné a mají správný typ.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes'
  and column_name in ('via_latitudes', 'via_longitudes')
order by column_name;
-- očekáváno: oba řádky, double precision[]

-- B) Validační trigger existuje a je zapnutý.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.carrier_routes'::regclass
  and tgname = 'carrier_routes_via_places_validate';
-- očekáváno: jeden řádek, tgenabled = O

-- C) Tři omezení jsou založená.
select conname from pg_constraint
where conrelid = 'public.carrier_routes'::regclass
  and conname in (
    'carrier_routes_via_latitudes_len',
    'carrier_routes_via_longitudes_len',
    'carrier_routes_via_coordinates_together'
  )
order by conname;
-- očekáváno: 3 řádky

-- D) Oprávnění nadále jen service_role.
select grantee from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'get_route_matching_candidates_internal'
order by grantee;
`,
  },
  {
    order: 3,
    file: "20261005140000_matching_sql_geo_preselection.sql",
    out: "step_3_140000_bbox_preselection.sql",
    title: "Polohový předvýběr kandidátů (přechodné bbox)",
    purpose: "přidá bbox_* sloupce, btree indexy, roadlink_haversine_meters a RPC s polohovým filtrem",
    verify: `
-- ══ KONTROLA KROKU 3 (read-only) ═══════════════════════════════════════════

-- A) Obdélník se dopočítal u všech tras s úplnými souřadnicemi.
select count(*) as total,
       count(*) filter (where bbox_min_lat is null) as without_bbox
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null;
-- očekáváno: without_bbox = 0

-- B) Oba btree indexy jsou platné a připravené.
select c.relname, i.indisvalid, i.indisready
from pg_index i
join pg_class c on c.oid = i.indexrelid
where i.indrelid = 'public.carrier_routes'::regclass
  and c.relname like 'carrier_routes_bbox%'
order by c.relname;
-- očekáváno: 2 řádky, vše true

-- C) Helper existuje a je immutable.
select proname, provolatile
from pg_proc
where oid = to_regprocedure('public.roadlink_haversine_meters(double precision,double precision,double precision,double precision)');
-- očekáváno: roadlink_haversine_meters | i

-- D) Oprávnění nadále jen service_role.
select grantee from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'get_route_matching_candidates_internal'
order by grantee;
`,
  },
  {
    order: 4,
    file: "20261005150000_enable_postgis.sql",
    out: "step_4_150000_enable_postgis.sql",
    title: "Zapnutí PostGIS — ZASTÁVKA",
    purpose: "create extension if not exists postgis do schématu extensions",
    verify: `
-- ══ KONTROLA KROKU 4 (read-only) ═══════════════════════════════════════════
--
-- Tento krok je ZASTÁVKA. Pokud skript skončí chybou, PostGIS není v plánu
-- dostupný. V takovém případě ZASTAVTE celé nasazení a nepusťte kroky 5–7.
-- Krok 3 (bbox) funguje i bez PostGIS, jen je pomalejší.

-- A) Extension je nainstalovaná ve schématu extensions.
select extname, extnamespace::regnamespace::text as schema
from pg_extension
where extname = 'postgis';
-- očekáváno: postgis | extensions

-- B) Prostorové typy existují.
select to_regtype('extensions.geography') is not null as geography_ok,
       to_regtype('extensions.geography linestring') is not null as linestring_ok;
-- očekáváno: obě true
--   Pokud je geography_ok = false, ZASTAVTE. Nepouštějte krok 5.

-- C) PostGIS nezanechal nic v public schématu.
select n.nspname, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'spatial_%';
-- očekáváno: 0 řádků
`,
  },
  {
    order: 5,
    file: "20261005160000_carrier_route_spatial_line.sql",
    out: "step_5_160000_route_line.sql",
    title: "Skutečná prostorová geometrie trasy",
    purpose: "přidá route_line geography(LineString,4326), BEFORE trigger, dopočet a GiST index",
    verify: `
-- ══ KONTROLA KROKU 5 (read-only) ═══════════════════════════════════════════

-- A) Sloupec existuje se správným typem.
select udt_schema, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'carrier_routes'
  and column_name = 'route_line';
-- očekáváno: extensions | geography

-- B) Geometrie je dopočítaná u všech tras s úplnými souřadnicemi.
--    Přesně to je podmínka, kterou požaduje úklid v kroku 7.
select count(*) as total,
       count(*) filter (where route_line is null) as missing
from public.carrier_routes
where from_lat is not null and from_lng is not null
  and to_lat is not null and to_lng is not null
  and via_latitudes is not null and via_longitudes is not null
  and cardinality(via_latitudes) = cardinality(via_place_ids)
  and cardinality(via_longitudes) = cardinality(via_place_ids);
-- očekáváno: missing = 0

-- C) GiST index je platný a připravený.
select c.relname, i.indisvalid, i.indisready, am.amname
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_am am on am.oid = c.relam
where i.indrelid = 'public.carrier_routes'::regclass
  and am.amname = 'gist';
-- očekáváno: carrier_routes_route_line_gist_idx | t | t | gist

-- D) Geometrie má správný počet bodů: odjezd + via + cíl.
select cardinality(via_place_ids) as via_count,
       extensions.ST_NPoints(route_line) as npoints,
       extensions.ST_NPoints(route_line) = cardinality(via_place_ids) + 2 as matches
from public.carrier_routes
where cardinality(via_place_ids) > 0 and route_line is not null
limit 5;
-- očekáváno: matches = true ve všech řádcích
`,
  },
  {
    order: 6,
    file: "20261005170000_matching_spatial_preselection.sql",
    out: "step_6_170000_spatial_preselection.sql",
    title: "Předvýběr kandidátů přes prostorový index",
    purpose: "RPC přepsaná přes create or replace: filtr ST_DWithin a řazení ST_Distance",
    verify: `
-- ══ KONTROLA KROKU 6 (read-only) ═══════════════════════════════════════════

-- A) RPC je prostorový a přechodné struktury už nepoužívá.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)'))
    into v_def;

  if v_def like '%ST_DWithin%' then
    raise notice 'A) OK: RPC používá prostorový filtr ST_DWithin.';
  else
    raise exception 'CHYBA: RPC neobsahuje ST_DWithin.';
  end if;

  if v_def like '%bbox_%' or v_def like '%roadlink_haversine_meters%' then
    raise exception 'CHYBA: RPC stále používá bbox_* nebo roadlink_haversine_meters.';
  end if;

  raise notice 'A) OK: RPC je prostorový, bbox_* ani helper už nepoužívá.';
end;
$$;

-- B) Oprávnění se nezměnila (create or replace negrantuje nikomu nové).
select grantee from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'get_route_matching_candidates_internal'
order by grantee;
-- očekáváno: service_role

-- C) Plán dotazu. RPC filtruje cr.id = p_route_id, tedy JEDNU trasu, proto
--    na carrier_routes očekáváme Index Scan po primárním klíči a ŽÁDNÝ GiST.
--    GiST v plánu RPC chybí správně — nemá co hledat při jediném řádku.
--    Skutečné úzké místo je spojení s tow_requests.
explain (analyze, buffers)
select * from public.get_route_matching_candidates_internal(
  (select cr.id from public.carrier_routes cr where cr.status = 'open' order by cr.created_at desc limit 1),
  (select cr.driver_id from public.carrier_routes cr where cr.status = 'open' order by cr.created_at desc limit 1),
  5
);

-- D) Smlouva odpovědi: limit dodržen, pořadí podle vzdálenosti neklesá,
--    cizí trasa se nevrátí.
do $$
declare
  v_route record;
  v_rows jsonb;
  v_item jsonb;
  v_count integer;
  v_prev double precision := null;
  v_seen_null boolean := false;
begin
  select cr.id, cr.driver_id
    into v_route
  from public.carrier_routes cr
  where cr.status = 'open' and cr.route_line is not null and cr.available_spaces > 0
  order by cr.created_at desc
  limit 1;

  if v_route is null then
    raise notice 'D) PŘESKOČENO: žádná otevřená trasa s geometrií.';
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    into v_rows
  from public.get_route_matching_candidates_internal(v_route.id, v_route.driver_id, 5) as s;

  v_count := jsonb_array_length(v_rows);

  if v_count > 5 then
    raise exception 'CHYBA: RPC vrátilo % řádků, limit je 5.', v_count;
  end if;

  for v_item in select * from jsonb_array_elements(v_rows)
  loop
    if (v_item ->> 'route_proximity_meters') is null then
      v_seen_null := true;
    else
      if v_seen_null then
        raise exception 'CHYBA: kandidát s vypočtenou vzdáleností následuje za kandidátem bez vzdálenosti.';
      end if;
      if v_prev is not null
         and (v_item ->> 'route_proximity_meters')::double precision < v_prev then
        raise exception 'CHYBA: pořadí podle vzdálenosti od trasy je porušeno.';
      end if;
      v_prev := (v_item ->> 'route_proximity_meters')::double precision;
    end if;

    if (v_item ->> 'route_id') is distinct from v_route.id::text then
      raise exception 'CHYBA: RPC vrátilo kandidáta k jiné trase.';
    end if;
  end loop;

  raise notice 'D) OK: RPC vrátilo % kandidátů (limit 5), smlouva dodržena.', v_count;
end;
$$;
`,
  },
];

const preflight = `-- ══════════════════════════════════════════════════════════════════════════════
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
select
  (select count(*) from public.carrier_routes) as routes_total,
  (select count(*) from public.carrier_routes where route_line is not null) as routes_with_geometry,
  (select count(*) from public.tow_requests) as requests_total,
  (select count(*) from public.tow_requests where status = 'open') as requests_open;

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
--   D) jen service_role = v pořádku.
--      Když tam bude anon nebo authenticated, ZASTAVTE a napište mi to.
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
-- POŘADÍ — vložujte soubory po řadě, JEDEN na dotaz, pokaždé čekejte na
-- výsledek a zkontrolujte ho. Každý soubor má na konci kontrolní dotazy
-- s očekávaným výsledkem.
--
--   00_preflight_readonly.sql      kontrola předem, nic nemění
--   step_1_120000_via_routes.sql
--   step_2_130000_via_coordinates.sql
--   step_3_140000_bbox_preselection.sql
--   step_4_150000_enable_postgis.sql      ZASTÁVKA pokud selže
--   step_5_160000_route_line.sql
--   step_6_170000_spatial_preselection.sql
--
-- CO TU ZAMYŠLENĚ NENÍ
--   krok 20261005180000 (spatial_cleanup). Je jednosměrný — odstraňuje
--   bbox_* sloupce a nepřehrává se. Patří až po ověřeném provozu
--   v produkci, nejdříve za pár dní reálných dotazů.
--
--   Edge Function google-route-matches se nasazuje až PO zeleném
--   smoke testu z kroku 6.
--
-- VYHRA
--   Každý krok je v jedné transakci. Selhání = automatický rollback,
--   databáze zůstane beze změny. Kroky jsou idempotentní, opakované
--   spuštění je bezpečné.
`;

function build() {
  const outputs = new Map();

  outputs.set("00_preflight_readonly.sql", preflight);

  for (const step of steps) {
    const source = fs.readFileSync(path.join(migrationsDir, step.file), "utf8").replace(/\r\n/g, "\n").trim();
    outputs.set(step.out, `${header(step.order, step.file, step.title, step.purpose)}${source}\n${step.verify}`);
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

  // Cizí soubory v adresáři by znamenaly, že balíček není čistý.
  const stale = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter((name) => !outputs.has(name))
    : [];

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