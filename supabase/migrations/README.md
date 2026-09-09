# Supabase migrations – RoadLink

Tento adresář obsahuje SQL migrace pro Supabase databázi RoadLink.

## Struktura

- `0001_*.sql` – první verze migrace (připravená, ale **nespuštěná**).
- `0001_rollback.sql` – manuální rollback (obnovení původního stavu). Nespouštět běžně, jen pokud je potřeba vzít změnu zpět.
- `schema.sql` (v nadřazeném adresáři) – původní scaffold z rané fáze projektu. Není zdrojem pravdy, slouží jen pro orientaci. Skutečné schéma žije v Supabase.

## Konvence pojmenování

`NNNN_popis.sql` – čtyřmístné pořadové číslo s podtržítkem a krátkým popisem.
Lexikografické řazení = pořadí provedení.

## Jak spustit

Migrace se v tomto projektu zatím nespouští automatizovaně (žádný Supabase CLI, žádný CI).
Jsou navrženy tak, aby šly spustit ručně:

1. Supabase Dashboard → SQL Editor
2. Vložit obsah `0001_*.sql`
3. Spustit celý skript najednou (je idempotentní)

Nebo lokálně s `psql`:
```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_*.sql
```

## Pravidla

- Každá migrace je idempotentní (lze spustit opakovaně bez chyby).
- V těle migrace se **nesmí** měnit RLS policies, pokud to není výslovně účel migrace.
- Migrace nikdy neobsahuje credentials, secrets ani klíče.
- Po každé migraci se doporučuje ověřit výsledek SELECTem z katalogu (viz validační dotazy níže).

## Validační dotazy po spuštění 0001

```sql
-- 1) Ověření defaultu tow_requests.status
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tow_requests'
  AND column_name = 'status';
-- očekáváno: column_default = 'open'

-- 2) Ověření CHECK constraintu (whitelist hodnot statusu)
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.tow_requests'::regclass
  AND contype = 'c'
  AND conname LIKE '%status%';

-- 3) Ověření EXECUTE oprávnění select_tow_offer
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'select_tow_offer';
-- očekáváno: PUBLIC a anon = bez řádku; authenticated, postgres, service_role = EXECUTE
```

## 0001 – co mění a co ne

| Co | Mění se? | Důvod |
|---|---|---|
| `tow_requests.status` default | ANO (`'requested'` → `'open'`) | Aplikace v App.tsx vkládá `status: 'open'`; konzistence s CHECK whitelistem |
| `tow_requests.status` CHECK | NE | Whitelist `open/offer_selected/in_progress/completed/cancelled` zůstává |
| `tow_requests.status` existující řádky | NE | `SET DEFAULT` nezpětně mění data, jen nové inserty |
| Tělo `select_tow_offer` | NE | Mění se pouze oprávnění |
| EXECUTE pro `PUBLIC` | REVOKE | – |
| EXECUTE pro `anon` | REVOKE | – |
| EXECUTE pro `authenticated` | GRANT | – |
| EXECUTE pro `postgres`, `service_role` | ponecháno | standardní Supabase chování |
| RLS policies | NE | mimo scope |
| Ostatní tabulky | NE | mimo scope |
| App.tsx / UI | NE | mimo scope |
