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