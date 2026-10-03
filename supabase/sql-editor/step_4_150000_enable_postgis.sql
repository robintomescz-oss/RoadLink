-- ══════════════════════════════════════════════════════════════════════════════
-- KROK 4 · Zapnutí PostGIS — ZASTÁVKA
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
--   * poslední krok explicitně ověří, že typy `geography`/`geography linestring`
--     existují. Kdyby extension nebylo možné zavést, skript skončí chybou
--     hned a žádná další migrace se nespustí — raději zastavit než ticho
--     pokračovat bez prostorových typů,
--   * `search_path` se zde nemění; všechny dotazy v dalších migracích jsou
--     psány s explicitním schématem nebo volají funkce přes `extensions.`.
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

  if to_regtype('extensions.geography') is null then
    raise exception 'Typ extensions.geography chybí — PostGIS nebyl nainstalován do schématu extensions.';
  end if;

  if to_regtype('extensions.geography linestring') is null then
    raise exception 'Typ extensions.geography linestring chybí — PostGIS nebyl nainstalován správně.';
  end if;
end
$$;

comment on extension postgis is
  'Prostorová extension pro filtrování kandidátů podél trasy (ST_DWithin/ST_Distance s GiST indexem).';

commit;

-- Tento krok je ZASTÁVKA. Pokud skript skončí chybou, PostGIS není v plánu
-- dostupný: ZASTAVTE celé nasazení a kroky 5–7 NEPUŠTĚJTE. Krok 3 funguje
-- i bez PostGIS, jen je pomalejší.
--
-- Když geography_ty_p nebo geography_linestring není ANO, NEJDE pokračovat.-- ══ VÝSLEDek KROKU ══════════════════════════════════════════════════════════
--
-- Tohle je jediná tabulka, kterou SQL Editor zobrazí. Zkontrolujte sloupec
-- 'zavre_kontrola' a přesvědčte se, že vše je ANO.
SELECT
  CASE WHEN ext_schema = 'extensions' THEN 'ANO' ELSE 'NE' END AS extension_v_extensions,
  CASE WHEN geography_ok THEN 'ANO' ELSE 'NE' END AS geography_ty_p_existuje,
  CASE WHEN linestring_ok THEN 'ANO' ELSE 'NE' END AS geography_linestring_ok,
  CASE WHEN leaky = 0 THEN 'ANO' ELSE 'NE' END AS nic_v_public_schematu
  ,
  CASE WHEN (ext_schema = 'extensions')
    AND (geography_ok)
    AND (linestring_ok)
    AND (leaky = 0)
    THEN 'ANO — krok uspel'
    ELSE 'NE — NEPOUŠTĚJTE DALŠÍ KROK, poslete mi tuto tabulku'
  END AS zavre_kontrola
FROM (SELECT 1) AS t
  CROSS JOIN LATERAL (
    SELECT
      (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='postgis') AS ext_schema,
      (to_regtype('extensions.geography') IS NOT NULL) AS geography_ok,
      (to_regtype('extensions.geography linestring') IS NOT NULL) AS linestring_ok,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname LIKE 'spatial_%') AS leaky
  ) AS c;
