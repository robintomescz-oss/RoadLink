# Odložené migrace RoadLink

Sem patří migrace, které jsou **záměrně mimo `supabase/migrations/`**, protože je
nemá spouštět automatický tok.

`supabase db push` bere výhradně soubory z `supabase/migrations/`. Migrace v této
složce proto **nikdy nespustí sama** a nedá se spustit omylem. Když má být
skutečně provedena, musí se sem přesunout zpět (viz níže).

## `20261005180000_matching_spatial_cleanup.sql` — úklid prostorové vrstvy

### Proč je odložená

Kroky 120000–170000 proběhly 3. 10. 2026 ručně v Supabase SQL Editoru a v databázi
se osvědčily. `180000` je **jednosměrný**: maže `bbox_min_lat`, `bbox_max_lat`,
`bbox_min_lng`, `bbox_max_lng` a funkci `assign_carrier_route_bbox()` a přejmenuje
trigger na `carrier_routes_route_geometry_assign`. **Vratnou cestu nemá.**

Má se spustit až po tom, co ukáže reálný provoz:

- `route_line` je dopočítané u všech tras, které mají úplné souřadnice,
- prostorová předselekce v RPC vrací kandidáty ve stejném pořadí jako před úklidem,
- předvýběr obdélníkem v krocích 3 a 4 se mezitím nepoužívá (krok 170000 přepsal
  tělo RPC na `route_line` + `ST_DWithin`).

Proto je požadovaná doba nejméně několik dní skutečných dotazů v produkci.

### Proč ne lež v historii migrací

Ostatních sedm kroků bylo do databáze zapsáno přes `supabase migration repair`, protože
byly skutečně aplikované a CLI je jinak považovalo za čekající. `180000` **nebyla**
aplikovaná. Zapsat ji jako `applied` by znamenalo lživý záznam a zároveň by úklid
nikdy nespuštěný — tichá propast v historii. Raději je zřetelně mimo tok.

### Jak ji spustit, až bude připravená

1. Ověřit v SQL Editoru, že jsou splněny předpoklady uvedené v hlavičce souboru.
2. Přesunout soubor zpět:
   ```bash
   git mv supabase/migrations-deferred/20261005180000_matching_spatial_cleanup.sql \
           supabase/migrations/
   ```
3. Zapsat ho do historie, aby se nespouštěl podruhé:
   ```bash
   supabase migration repair --linked --status applied 20261005180000
   ```
4. Spustit **ručně**, jednou transakcí, podle
   `docs/matching-deployment-runbook.md` — krok 8. Ideálně přes SQL Editor, protože
   `supabase db push` tady není potřeba a chtěli bychom vidět `zavre_kontrola`.
5. Zopakovat `supabase/smoke/matching_spatial_smoke.sql`. Ten už od kroku
   `ab8bab2` přijímá oba názvy triggeru, takže projdou jak před úklidem, tak po něm.
6. Soubor znovu přesunout zpět do `supabase/migrations-deferred/`, aby se historie
   a soubor znovu neshodovaly.

### Kdo hlídá, že sem zůstane

`.roadlink/via-privacy-migrations-regression.js` a `.roadlink/matching-spatial-regression.js`
selhávají, pokud se soubor objeví zpět v `supabase/migrations/` nebo zmizí odtud.
`npm run check` je tedy přímá pojistka, ne jen dokumentace.