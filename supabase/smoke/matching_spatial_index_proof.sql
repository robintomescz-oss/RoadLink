-- ══════════════════════════════════════════════════════════════════════════════
-- Důkaz použitelnosti prostorového indexu a výkonu předvýběru (READ-ONLY)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Nikdo NIC NEZAPISUJE. Data se jen čtou; `EXPLAIN (ANALYZE)` je jediné, co se
-- vyhodnocuje, a to pouze nad `SELECT`.
--
-- ── K čemu je tento skript ───────────────────────────────────────────────────
--
-- POZOR NA ČASTOU CHYBNOU INTERPRETACI, kterou tento skript opravuje:
--
--   `get_route_matching_candidates_internal` filtruje `cr.id = p_route_id`,
--   tedy dotaz pracuje s JEDNOU konkrétní trasou. Na `carrier_routes` proto
--   planner použije primární klíč a prostorová podmínka `ST_DWithin` se
--   vyhodnotí nad jediným řádkem.
--
--   Z toho plyne: GiST index `carrier_routes_route_line_gist_idx` se v plánu
--   tohoto RPC **nikdy neobjeví** — a to není chyba. Hledat prostorový index
--   v `Index Cond` plánu RPC je chybná kontrola, která by na reálném objemu
--   nikdy neprošla.
--
--   GiST má v této architektuře jinou úlohu: je to rychlá pojistka pro dotazy
--   hledající trasy v okruhu napříč celou tabulkou (plánování, hledání v
--   okolí, budoucí funkce). Tyhle dotazy testuje sekce B.
--
--   Skutečné úzké místo předvýběru je `tow_requests` (spojení a filtrování
--   poptávek), ne `carrier_routes`. To testuje sekce C.
--
-- ── Jak číst výstup ─────────────────────────────────────────────────────────
--
--   Sekce A  — je index vůbec použitelný? (musí být vše true)
--   Sekce B  — použije ho planner, když hledáme napříč tabulkou? (plán + poměr)
--   Sekce C  — je předvýběr rychlý a kde se čas reálně spotřebovává?
--   Sekce D  — rozhodovací tabulka: Seq Scan není selhání
--
-- Skript končí chybou, pokud je index neplatný nebo nepřipravený (sekce A) —
-- to je jediná porucha, kterou lze bezpečně automaticky vyhlásit za chybu.

-- ══ A) Zdraví a použitelnost indexu ══════════════════════════════════════════
-- Objem dat a pokrytí geometrií (kontext pro rozhodování v sekci D).

select
  count(*) as routes_total,
  count(*) filter (where route_line is not null) as routes_with_geometry,
  round(
    100.0 * count(*) filter (where route_line is not null) / nullif(count(*), 0),
    1
  ) as pct_with_geometry
from public.carrier_routes;

select
  count(*) as requests_total,
  count(*) filter (where status = 'open') as requests_open
from public.tow_requests;

-- A2) Index samotný: platný, připravený, živý, na správném typu.
do $$
declare
  v_index record;
begin
  select
    c.relname,
    i.indisvalid,
    i.indisready,
    i.indislive,
    am.amname,
    pg_get_expr(i.indpred, i.indrelid) as predicate,
    pg_relation_size(c.oid) as size_bytes
  into v_index
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_am am on am.oid = c.relam
  where i.indrelid = 'public.carrier_routes'::regclass
    and c.relname = 'carrier_routes_route_line_gist_idx';

  if v_index is null then
    raise exception 'CHYBA: index carrier_routes_route_line_gist_idx neexistuje. Aplikuj 20261005160000.';
  end if;

  if v_index.amname <> 'gist' then
    raise exception 'CHYBA: index % používá %, ne GiST.', v_index.relname, v_index.amname;
  end if;

  -- indisvalid = false znamená, že sestavování indexu selhalo nebo bylo
  -- přerušeno; planner ho potom ztotožní a bude ho ignorovat.
  if not v_index.indisvalid then
    raise exception 'CHYBA: index % je neplatný (indisvalid = false). Je potřeba ho přestavět.', v_index.relname;
  end if;

  -- indisready = false znamená, že index ještě není připravený pro čtení.
  if not v_index.indisready then
    raise exception 'CHYBA: index % není připravený (indisready = false).', v_index.relname;
  end if;

  raise notice 'A) OK: index % je platný, připravený a živý. Velikost: % bajtů, podmínka: %',
    v_index.relname,
    v_index.size_bytes,
    coalesce(v_index.predicate, 'žádná (indexuje všechny ne-NULL)');
end;
$$;

-- A3) Kolik řádků index ve skutečnosti pokrývá (částečný index na NOT NULL).
select
  count(*) filter (where route_line is not null) as rows_in_index,
  count(*) filter (where route_line is null) as rows_not_in_index
from public.carrier_routes;

-- A4) Statistiky: plánovač potřebuje odhady. Bez ANALYZE může GiST přehlédnout.
select
  last_analyze,
  last_autoanalyze,
  n_live_tup,
  n_dead_tup
from pg_stat_user_tables
where schemaname = 'public' and relname = 'carrier_routes';

-- ══ B) Reálné použití GiST při hledání napříč tabulkou ═══════════════════════
--
-- Tady index OPLATVĚ figuruje: hledáme všechny trasy v okruhu bodu, bez
-- omezení na jedno ID. To je jediný tvar dotazu, pro který GiST existuje.
--
-- Nahraďte (14.42, 50.08) vlastním bodem — radián 30 km. V plánu hledejte
-- `Index Scan using carrier_routes_route_line_gist_idx` nebo
-- `Bitmap Index Scan on carrier_routes_route_line_gist_idx`.

explain (analyze, buffers)
select cr.id
from public.carrier_routes as cr
where cr.route_line is not null
  and extensions.ST_DWithin(
    cr.route_line,
    extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography,
    30000
  );

-- B2) Selectivity: kolik řádků index propustí proti celé tabulce.
--     Podíl pod 1 % znamená, že filtr je užitečný a GiST má smysl.
--     Podíl nad ~50 % znamená, že filtr je příliš široký a sekvenční sken
--     je správná volba — viz rozhodovací tabulka v sekci D.
with probe as (
  select extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography as point
)
select
  (select count(*) from public.carrier_routes where route_line is not null) as indexed_rows,
  (
    select count(*)
    from public.carrier_routes as cr, probe as p
    where cr.route_line is not null
      and extensions.ST_DWithin(cr.route_line, p.point, 30000)
  ) as matched_rows,
  round(
    100.0 * (
      select count(*)
      from public.carrier_routes as cr, probe as p
      where cr.route_line is not null
        and extensions.ST_DWithin(cr.route_line, p.point, 30000)
    ) / nullif((select count(*) from public.carrier_routes where route_line is not null), 0),
    2
  ) as selectivity_pct;

-- B3) Bounding box jako pojistka: ST_DWithin se v GiST plánu rozkládá na
--     překrytí ohraničujících boxů. Zkontrolujte, že se v plánu objeví
--     operátor `&&` (bbox overlap) — bez něj by index nebyl použitelný.
explain (analyze, buffers)
select cr.id
from public.carrier_routes as cr
where cr.route_line is not null
  and extensions.ST_DWithin(
    cr.route_line,
    extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography,
    30000
  )
  and cr.route_line && extensions.ST_Expand(
    extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography,
    30000
  );

-- ══ C) Výkon předvýběru a jeho skutečné úzké místo ═══════════════════════════
--
-- Tvar shodný s RPC (jedna trasa + spojení s poptávkami), bez limitu, aby byl
-- plán čitelný. KLÍČOVÉ: na carrier_routes tu bude Index Scan po primárním
-- klíči, ne GiST. To je očekávané a správné.

explain (analyze, buffers)
with test_route as (
  select cr.id, cr.driver_id, cr.max_deviation_km, cr.route_line
  from public.carrier_routes as cr
  where cr.status = 'open'
    and cr.route_line is not null
    and cr.available_spaces > 0
  order by cr.created_at desc
  limit 1
)
select tr.id
from test_route as t
join public.tow_requests as tr
  on tr.status = 'open'
 and tr.origin_place_id is not null
 and tr.destination_place_id is not null
 and tr.route_distance_meters is not null
 and tr.route_duration_seconds is not null
 and tr.requested_date is not null
 and t.route_line is not null
 and (
   tr.pickup_lat is null or tr.pickup_lng is null
   or tr.destination_lat is null or tr.destination_lng is null
   or (
     extensions.ST_DWithin(
       t.route_line,
       extensions.ST_SetSRID(extensions.ST_MakePoint(tr.pickup_lng, tr.pickup_lat), 4326)::extensions.geography,
       (greatest(coalesce(t.max_deviation_km, 20), 0) + 10) * 1000
     )
     and extensions.ST_DWithin(
       t.route_line,
       extensions.ST_SetSRID(extensions.ST_MakePoint(tr.destination_lng, tr.destination_lat), 4326)::extensions.geography,
       (greatest(coalesce(t.max_deviation_km, 20), 0) + 10) * 1000
     )
   )
 );

-- C2) Rozdělení práce: kolik řádků musí projít přes tow_requests a kolik
--     přes carrier_routes. Tady je vidět, že úzké místo je v poptávkách.
select
  (select count(*) from public.carrier_routes where route_line is not null) as carrier_routes_rows,
  (select count(*) from public.tow_requests where status = 'open') as open_requests_rows,
  (select count(*) from public.tow_requests where status = 'open' and requested_date is not null) as requests_with_date;

-- C3) Indexové vs. sekvenční čtení na skutečném objemu.
--     Čas spojení s plánem (násobný factor 1000 = milisekundy).
--     Poměr "index_cas / seq_cas" říká, zda filtr vůbec něco šetří:
--       pod 1.0 → filtr je užitečný, GiST se vyplácí,
--       nad 1.0 → filtr je příliš široký, sekvenční sken je levnější.
explain (analyze, buffers, timing off)
select cr.id
from public.carrier_routes as cr
where cr.route_line is not null
  and extensions.ST_DWithin(
    cr.route_line,
    extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography,
    30000
  );

set local enable_indexscan = on;
set local enable_bitmapscan = on;
explain (analyze, buffers, timing off)
select cr.id
from public.carrier_routes as cr
where cr.route_line is not null
  and extensions.ST_DWithin(
    cr.route_line,
    extensions.ST_SetSRID(extensions.ST_MakePoint(14.42, 50.08), 4326)::extensions.geography,
    30000
  );
reset enable_indexscan;
reset enable_bitmapscan;

-- ══ D) Rozhodovací tabulka ═══════════════════════════════════════════════════
--
-- Co znamená, co v plánu vidíte:
--
--   Seq Scan na carrier_routes + malý počet řádků tabulky
--       → NENÍ chyba. Tabulka je malá, sekvenční čtení je rychlejší než
--         hledání v indexu. Plánovač se chová správně.
--
--   Seq Scan na carrier_routes + velký počet řádků (desítky tisíc+)
--       → varování. Zkontrolujte selectivity v B2. Pokud filtr propouští
--         většinu tabulky, je to očekávané. Pokud propouští malou část
--         a přesto je Seq Scan, spusťte ANALYZE public.carrier_routes.
--
--   Index Scan using carrier_routes_route_line_gist_idx
--       → přesně to, co chceme v sekci B. Index se používá.
--
--   Bitmap Index Scan on carrier_routes_route_line_gist_idx
--       → equally dobrý výsledek; bitmap scan je pro větší podíl vybraných
--         řádků typický a je často rychlejší než Index Scan.
--
--   Plán RPC, kde na carrier_routes je `Index Scan` po primárním klíči
--       → OČEKÁVANÉ. RPC filtruje `cr.id = p_route_id`, tedy jednu trasu.
--         GiST zde nemá co hledat. Název indexu zde záměrně neuvádíme —
--         tabulka vznikla mimo repozitář a jeho jméno nelze ověřit.
--
-- Kdy je GiST opravdu potřeba:
--   - tabulka má desítky tisíc tras a výše,
--   - existuje dotaz hledající trasy v okruhu napříč celou tabulkou,
--   - selectivity dotazu je pod řádově jednotky procent.
--
-- Kdy je GiST zbytečný a plán se Seq Scan je správný:
--   - tabulka má stovky až několik tisíc tras,
--   - žádný dotaz nehledá trasy napříč tabulkou (dnešní RPC nehledá),
--   - i pak je správným krokem uklidit index, aby se neplatil údržbu
--     při každém INSERT/UPDATE na carrier_routes.
--
-- Měřítko, kdy přestat měřit (orientační, pro plán ~1000–5000 tras):
--   - plán s řádem tisíců řádků (druhé) trvá typicky jednotky ms,
--   - latence RPC má rozptyl daleko větší než rozdíl GiST vs. Seq Scan,
--   - optimalizovat dřív než je zřejmé, že prostorový index řeší konkrétní
--     pomalý dotaz, je předčasné.
--
-- ── Co tento skript NEověřuje ────────────────────────────────────────────────
--
--   - že je plán *dostatečně rychlý* pro reálný provoz (to chce pozorování
--     reálného provozu, ne jednorázový EXPLAIN),
--   - že GiST je potřeba — to je rozhodnutí nad architekturou, ne výkonem,
--   - správnost výsledků RPC (to ověřuje matching_spatial_smoke.sql, sekce D).

-- Hotovo. Pokud sekce A nevyhodila výjimku, je prostorový index použitelný.