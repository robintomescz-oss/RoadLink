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