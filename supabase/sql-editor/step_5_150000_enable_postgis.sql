-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 5 · Zapnutí PostGIS — ZASTÁVKA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Zdroj: supabase/migrations/20261005150000_enable_postgis.sql
-- Účel: create extension if not exists postgis do schématu extensions
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
-- Krok 1 ze 3: prostorová extension (PostGIS)
--
-- Proč: dosud se ohraničující obdélník trasy (`bbox_*`) ukládal do čtyř
-- obyčejných sloupců a plné prostorové dotazy nešlo obsloužit indexem. PostGIS
-- umožní uložit trasu jako `geography(LineString)` a filtrovat přes GiST index
-- přímo v databázi.
--
-- Bezpečnost a idempotence:
--   * `create extension if not exists` je idempotentní a extension je čistě
--     aditivní — nemění data ani oprávnění existujících tabulek,
--   * extension je ukládána do schématu `extensions` (konvence Supabase), aby
--     nezahlcovala `public` a nepřepsala existující objekty,
--   * poslední krok explicitně ověří, že typ `geography` a prostorové funkce,
--     které používají další kroky, opravdu existují. Kdyby extension nebylo
--     možné zavést, skript skončí chybou hned a žádná další migrace se
--     nespustí — raději zastavit než ticho pokračovat bez prostorových typů,
--   * `search_path` se zde nemění; všechny dotazy v dalších migracích jsou
--     psány s explicitním schématem nebo volají funkce přes `extensions.`.
--
-- POZOR NA KONTROLU TYPU: `to_regtype('extensions.geography linestring')`
-- NEFUNGUJE. Postgres ve vstupu regtype nepřijímá typmod oddělený mezerou a
-- skončí to `syntax error at or near "linestring"` — tedy chybou PARSE, ne
-- nálezem chybějícího typu. Místo toho se typ hledá přímo v katalogu `pg_type`
-- a místo typmodu se ověřují funkce, které další kroky skutečně volají. To je
-- i silnější kontrola: ptá se, jestli prostorový filtr bude fungovat, ne jen
-- jestli existuje řádek v katalogu.
--
-- Nasazení: tato migrace se aplikuje samostatně a jako první. Pokud Supabase
-- projekt PostGIS nemá v plánu, migrace skončí chybou a další dvě se
-- nespouštějí — v takovém případě zůstává v platnosti předchozí bbox řešení.

begin;

create extension if not exists postgis schema extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    raise exception 'PostGIS se nepodařilo zavést. Zkontrolujte, zda je v Supabase plánu dostupný.';
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'extensions'
      and t.typname = 'geography'
      and t.typtype = 'b'
  ) then
    raise exception 'Typ extensions.geography chybí — PostGIS nebyl nainstalován do schématu extensions.';
  end if;

  -- Funkce, bez kterých by krok 7 (ST_DWithin jako filtr) a krok 6 (ST_MakeLine
  -- jako odvozená geometrie) nemohly pracovat.
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions'
      and p.proname in ('st_dwithin', 'st_makeline', 'st_makepoint', 'st_distance')
  ) then
    raise exception 'Chybí prostorové funkce v schématu extensions (ST_DWithin/ST_MakeLine/ST_MakePoint/ST_Distance) — prostorový předvýběr by nefungoval.';
  end if;
end
$$;

comment on extension postgis is
  'Prostorová extension pro filtrování kandidátů podél trasy (ST_DWithin/ST_Distance s GiST indexem).';

commit;

-- Tento krok je ZASTÁVKA. Pokud skript skončí chybou, PostGIS není v plánu
-- dostupný: ZASTAVTE celé nasazení a kroky 6–7 NEPUŠTĚJTE. Kroky 3 a 4 fungují
-- i bez PostGIS, jen je předvýběr pomalejší.
--
-- Když geography_ty_p_existuje nebo prostorove_funkce_ok není ANO, NEJDE pokračovat.-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN ext_schema = 'extensions' THEN 'ANO' ELSE 'NE' END AS extension_v_extensions,
  CASE WHEN geography_ok THEN 'ANO' ELSE 'NE' END AS geography_ty_p_existuje,
  CASE WHEN spatial_fns_ok THEN 'ANO' ELSE 'NE' END AS prostorove_funkce_ok,
  CASE WHEN leaky = 0 THEN 'ANO' ELSE 'NE' END AS nic_v_public_schematu
  ,
  CASE WHEN (ext_schema = 'extensions')
    AND (geography_ok)
    AND (spatial_fns_ok)
    AND (leaky = 0)
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT
      (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='postgis') AS ext_schema,
      -- Typ i funkce se ověřují přes katalog. Regtype vstup s typmodem
      -- odděleným mezerou je syntakticky chybný a spadl by na parse chybě,
      -- ne na nálezu typu.
      (SELECT EXISTS (
         SELECT 1 FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname='extensions' AND t.typname='geography' AND t.typtype='b'
       )) AS geography_ok,
      -- Počet PŘETÍŽENÍ nelze porovnávat: ST_MakePoint má v PostGIS pět
      -- variant (2D, 3D, 4D, s měřítkem) a ST_DWithin/ST_Distance existují
      -- pro geometry i geography. Porovnávat rows by tedy nikdy neplatilo.
      -- Ptáme se na POČET JMEN, ne na počet řádků v katalogu.
      (SELECT count(DISTINCT p.proname) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname='extensions'
           AND p.proname IN ('st_dwithin','st_makeline','st_makepoint','st_distance')) = 4 AS spatial_fns_ok,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname LIKE 'spatial_%') AS leaky
  ) AS c;
