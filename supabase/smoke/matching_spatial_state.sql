-- ══════════════════════════════════════════════════════════════════════════════
-- STAV PROSTOROVÉ VRSTVY carrier_routes (read-only) — PŘED úklidem i PO něm
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Jeden skript pro obě fáze odloženého úklidu 20261005180000:
--   * PŘED úklidem je to brána kroku 8 — ověří, že rollout došel až sem,
--   * PO úklidu ověří, že úklid proběhl celý a nezůstala půlka.
-- Fázi pozná sám podle databáze (bbox sloupce / názvy triggerů), nemusí se mu
-- nic předávat.
--
-- Kdy spustit: po krocích 130000–170000 (před úklidem) a znovu po úklidu.
--
-- Jak: Supabase Dashboard → SQL Editor, nebo
--   psql "$DATABASE_URL" -f supabase/smoke/matching_spatial_state.sql
--
-- Skript nic NEZAPISUJE a nic NEMAŽE. Jen čte katalog; jediná výjimka je
-- úmyslná: blok předpokladů skončí chybou, když nejsou splněné, aby operátor
-- nešel dál naslepo. To je stejné chování jako u samotné migrace 180000.
--
-- Co ověřuje:
--   A) fázi prostorové vrstvy (před úklidem / po úklidu / neznámá),
--   B) PŘEDPOKLADY migrace 180000 — přesně ty, které kontroluje ona sama:
--        * interní RPC existuje a už nesahá na `bbox_*` ani
--          `roadlink_haversine_meters`,
--        * každá trasa s úplnými souřadnicemi má `route_line` (stejný sdílený
--          helper jako trigger),
--        * GiST index nad `route_line` je platný a připravený,
--   C) TRIGGERY podle fáze:
--        PŘED úklidem: carrier_routes_via_places_validate,
--                      carrier_routes_bbox_assign,
--                      carrier_routes_route_line_assign,
--        PO úklidu:    carrier_routes_via_places_validate,
--                      carrier_routes_route_geometry_assign.
--   D) ROLLBACK — vypíše správnou cestu zpět podle zjištěné fáze. Úklid je
--      jednosměrný: vrací se znovu aplikací 20261005140000 i 20261005160000
--      a ručním zahozením nového triggeru `carrier_routes_route_geometry_assign`
--      a funkce `assign_carrier_route_geometry()`.
--
-- Očekávaný výsledek: blok B nevyhodí výjimku, blok C vypíše jen triggery své
-- fáze a `celkovy_verdikt` je 'ANO — …'. Když blok B vyhodí výjimku, úklid
-- nespouštěj — chybí příslušný krok.
--
-- tgtype se NESMÍ porovnávat číslem. Bitová hodnota pro BEFORE INSERT OR UPDATE
-- FOR EACH ROW je 1(ROW) + 2(BEFORE) + 4(INSERT) + 16(UPDATE) = 23, ne 15 —
-- 15 by znamenalo INSERT + DELETE bez UPDATE. Místo čísla se kontroluje text
-- definice triggeru, stejně jako v docs/matching-deployment-runbook.md.

-- ══ A) Fáze prostorové vrstvy ════════════════════════════════════════════════

select
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'carrier_routes'
        and column_name in ('bbox_min_lat', 'bbox_max_lat', 'bbox_min_lng', 'bbox_max_lng')
    ) then 'PŘED úklidem'
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.carrier_routes'::regclass and not tgisinternal
        and tgname in ('carrier_routes_bbox_assign', 'carrier_routes_route_line_assign')
    ) then 'PŘED úklidem'
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.carrier_routes'::regclass and not tgisinternal
        and tgname = 'carrier_routes_route_geometry_assign'
    ) then 'PO úklidu'
    else 'NEZNÁMÁ'
  end as faze,
  exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am am on am.oid = c.relam
    where i.indrelid = 'public.carrier_routes'::regclass
      and am.amname = 'gist' and i.indisvalid and i.indisready
  ) as gist_ok,
  to_regprocedure('public.roadlink_haversine_meters(double precision,double precision,double precision,double precision)') is not null as haversine_pritomen;

-- ══ B) Předpoklady migrace 180000 (tvrdá brána) ══════════════════════════════

do $$
declare
  v_function_definition text;
  v_missing_geometry integer;
begin
  if to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)') is null then
    raise exception 'CHYBA: interní RPC pro předvýběr kandidátů neexistuje. Aplikuj krok 1 (20261005120000).';
  end if;

  select pg_get_functiondef(to_regprocedure('public.get_route_matching_candidates_internal(uuid,uuid,integer)'))
    into v_function_definition;

  if v_function_definition like '%bbox_%' then
    raise exception 'CHYBA: RPC stále používá bbox_* sloupce. Úklid 20261005180000 by skončil výjimkou. Aplikuj krok 7 (20261005170000).';
  end if;

  if v_function_definition like '%roadlink_haversine_meters%' then
    raise exception 'CHYBA: RPC stále používá roadlink_haversine_meters. Aplikuj krok 7 (20261005170000).';
  end if;

  -- Stejná podmínka jako v assign_carrier_route_geometry() a v úklidu: kdyby se
  -- lišila, kontrolovala by jinou množinu tras, než jakou geometrie odvozuje.
  select count(*) into v_missing_geometry
  from public.carrier_routes as cr
  where cr.from_lat is not null and cr.from_lng is not null
    and cr.to_lat is not null and cr.to_lng is not null
    and public.carrier_route_via_coordinates_valid(
      cr.via_place_ids, cr.via_latitudes, cr.via_longitudes
    )
    and cr.route_line is null;

  if v_missing_geometry > 0 then
    raise exception 'CHYBA: % tras má úplné souřadnice, ale route_line je NULL. Úklid by zahodil obdélník bez náhrady. Aplikuj krok 6 (20261005160000).', v_missing_geometry;
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am am on am.oid = c.relam
    where i.indrelid = 'public.carrier_routes'::regclass
      and am.amname = 'gist' and i.indisvalid and i.indisready
  ) then
    raise exception 'CHYBA: na carrier_routes není platný GiST index pro route_line. Aplikuj krok 6 (20261005160000).';
  end if;

  raise notice 'B) PŘEDPOKLADY OK: RPC je prostorový, každá trasa s úplnými souřadnicemi má route_line, GiST index je platný. Úklid 20261005180000 může bezpečně proběhnout.';
end;
$$;

-- ══ C) Triggery podle fáze ═══════════════════════════════════════════════════

with faze as (
  select case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'carrier_routes'
        and column_name in ('bbox_min_lat', 'bbox_max_lat', 'bbox_min_lng', 'bbox_max_lng')
    ) then 'pred'
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.carrier_routes'::regclass and not tgisinternal
        and tgname in ('carrier_routes_bbox_assign', 'carrier_routes_route_line_assign')
    ) then 'pred'
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.carrier_routes'::regclass and not tgisinternal
        and tgname = 'carrier_routes_route_geometry_assign'
    ) then 'po'
    else 'neznama'
  end as faze
),
ocekavano(poradi, trigger_name, popis, trigger_fn, plati) as (
  values
    (1, 'carrier_routes_via_places_validate',
        'validace via_place_ids — v obou fázích', 'validate_carrier_route_via_places', 'vzdy'),
    (2, 'carrier_routes_bbox_assign',
        'dočasný obdélník — jen PŘED úklidem', 'assign_carrier_route_bbox', 'pred'),
    (3, 'carrier_routes_route_line_assign',
        'geometrie PŘED úklidem', 'assign_carrier_route_line', 'pred'),
    (4, 'carrier_routes_route_geometry_assign',
        'geometrie PO úklidu — jediný zdroj pravdy', 'assign_carrier_route_geometry', 'po')
),
stav as (
  select
    o.poradi,
    o.trigger_name,
    o.popis,
    case f.faze when 'pred' then 'PŘED úklidem' when 'po' then 'PO úklidu' else 'NEZNÁMÁ' end as faze_popis,
    o.trigger_fn as ocekavana_funkce,
    (t.tgname is not null) as existuje,
    coalesce(t.tgenabled::text, 'n/a') as tgenabled,
    coalesce(pg_get_triggerdef(t.oid), 'n/a') as definice,
    coalesce(p.proname, 'n/a') as skutecna_funkce,
    case
      when t.tgname is null then 1
      when t.tgenabled::text <> 'O' then 1
      when pg_get_triggerdef(t.oid) not ilike '%BEFORE INSERT OR UPDATE%' then 1
      when pg_get_triggerdef(t.oid) not ilike '%FOR EACH ROW%' then 1
      when p.proname is distinct from o.trigger_fn then 1
      else 0
    end as problematicky
  from ocekavano o
  cross join faze f
  left join pg_trigger t
    on t.tgrelid = 'public.carrier_routes'::regclass
   and t.tgname = o.trigger_name
   and not t.tgisinternal
  left join pg_proc p on p.oid = t.tgfoid
  where o.plati = 'vzdy' or o.plati = f.faze
)
select
  trigger_name,
  popis,
  faze_popis,
  existuje,
  tgenabled,
  ocekavana_funkce,
  skutecna_funkce,
  definice,
  case when problematicky = 0 then 'ANO' else 'NE' end as radek_ok,
  case
    when problematicky = 0
      then 'ANO — trigger zapnutý, BEFORE INSERT OR UPDATE FOR EACH ROW, správná funkce'
    when existuje is false
      then 'NE — trigger v databázi není, příslušný krok nebyl aplikován'
    when tgenabled <> 'O'
      then 'NE — trigger je VYPNUTÝ (tgenabled=' || tgenabled || '), data se nepřepočítávají'
    when definice not ilike '%BEFORE INSERT OR UPDATE%'
      then 'NE — trigger není BEFORE INSERT OR UPDATE: ' || definice
    when definice not ilike '%FOR EACH ROW%'
      then 'NE — trigger není FOR EACH ROW: ' || definice
    else 'NE — trigger ukazuje na jinou funkci: ' || skutecna_funkce
  end as zavre_kontrola,
  sum(problematicky) over () as problemu_celkem,
  case when sum(problematicky) over () = 0
       then 'ANO — všechny triggery odpovídají fázi „' || max(faze_popis) over () || '“'
       else 'NE — ' || sum(problematicky) over () || ' z ' || count(*) over ()
            || ' triggerů nesouhlasí, DALŠÍ POSTUP NEPOUŠTĚJTE BEZ VÝSLEDKU'
  end as celkovy_verdikt
from stav
order by poradi;

-- ══ D) Rollback podle fáze ═══════════════════════════════════════════════════

do $$
declare
  v_faze text;
begin
  select case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'carrier_routes'
        and column_name in ('bbox_min_lat', 'bbox_max_lat', 'bbox_min_lng', 'bbox_max_lng')
    ) then 'pred'
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.carrier_routes'::regclass and not tgisinternal
        and tgname in ('carrier_routes_bbox_assign', 'carrier_routes_route_line_assign')
    ) then 'pred'
    when exists (
      select 1 from pg_trigger
      where tgrelid = 'public.carrier_routes'::regclass and not tgisinternal
        and tgname = 'carrier_routes_route_geometry_assign'
    ) then 'po'
    else 'neznama'
  end into v_faze;

  if v_faze = 'neznama' then
    raise notice 'D) STAV NEZNÁMÝ: chybí geometrický trigger. Nepokračuj, dokud se stav neshoduje s runbookem.';
  else
    raise notice 'D) ROLLBACK (úklid 20261005180000 je jednosměrný): znovu aplikuj 20261005140000 i 20261005160000 a ručně zahodit trigger carrier_routes_route_geometry_assign a funkci assign_carrier_route_geometry(). Pozor: samotné 20261005140000 původní topologii triggerů neobnoví.';
  end if;
end;
$$;
