-- 0016 – RoadLink: serverový rate limit pro Edge Function google-routes
--
-- Stav: PŘIPRAVENO K REVIEW, NENÍ APLIKOVÁNO na žádnou databázi (preview ani produkci).
-- Aplikuje se ručně až po review a testech (viz supabase/migrations/README.md).
--
-- Účel: omezit, kolikrát může jeden ověřený uživatel vyvolat placené Google
-- Routes API. Limit žije v databázi, takže je společný pro všechny instance Edge
-- Function a přežije redeploy; počítadlo v paměti funkce by nefungovalo.
--
-- Výchozí limity (musí odpovídat konstantám v supabase/functions/google-routes/rateLimit.ts):
--   * 10 přijatých pokusů za pevné minutové okno,
--   * 100 přijatých pokusů za kalendářní den UTC.
--
-- Model: jeden řádek na uživatele se dvěma nezávislými okny (minutovým a denním).
-- Každé okno má svůj začátek a své počítadlo, takže vypršelé okno se při dalším
-- požadavku samo resetuje a není potřeba žádný cron. Záměrně nejde o dva
-- samostatné řádky (bucket_type): jednořádkový model umožňuje zkontrolovat i
-- zvýšit obě počítadla jediným atomickým zápisem, takže nevzniká stav, kdy se
-- spotřebuje jeden slot, ale požadavek se stejně odmítne.
--
-- Co tato migrace NEMĚNÍ:
--   * veřejné marketplace RPC ani jejich výstup (interní tabulka tam nepatří),
--   * žádná existující tabulka, sloupec, RLS policy ani data,
--   * žádné DML (bez backfillu, bez TRUNCATE/DELETE/DROP),
--   * migrace 0015 (verified route metrics) zůstává beze změny a neaplikovaná.
--
-- Soukromí a přístup: tabulka nese jen technická počítadla (user_id, okna, počty),
-- žádné adresy, place ID ani jiné osobní údaje. Klient k ní nesmí mít žádný
-- přístup: RLS je zapnutá a není na ní žádná policy, oprávnění jsou odebrána
-- rolím anon i authenticated a čte/zapisuje do ní výhradně SECURITY DEFINER RPC.
--
-- Úklid (až vznikne plánovaná úloha): řádky, které se dlouho nepoužily, lze mazat
-- podle updated_at (např. starší než 30 dní) a tehdy má smysl přidat index na
-- updated_at. Teď je přidávat nechceme — jediný přístup je přes primární klíč.
-- Tato migrace záměrně nevytváří žádnou závislost na pg_cron ani jiném cronu.
--
-- Idempotence: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, revoke
-- i grant jsou bezpečné opakovat.

begin;

create table if not exists public.google_routes_rate_limit_buckets (
  user_id uuid primary key,
  minute_bucket_start timestamptz not null,
  minute_request_count integer not null default 0
    check (minute_request_count >= 0),
  day_bucket_start date not null,
  day_request_count integer not null default 0
    check (day_request_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.google_routes_rate_limit_buckets is
  'Internal per-user rate limit buckets for the google-routes Edge Function. No client access; reachable only through consume_google_routes_rate_limit().';
comment on column public.google_routes_rate_limit_buckets.minute_bucket_start is
  'Start of the current fixed one-minute window (date_trunc(''minute'', now())). Counters reset when this no longer matches.';
comment on column public.google_routes_rate_limit_buckets.day_bucket_start is
  'Current UTC calendar day. Daily counter resets when this no longer matches.';

-- RLS zapnutá a bez policy = žádný řádkový přístup pro klienty.
alter table public.google_routes_rate_limit_buckets enable row level security;

-- Anon ani běžný klient nesmí tabulku číst ani do ní zapisovat. Nové tabulky
-- v public schématu dědí v Supabase široká práva, proto se odebírají explicitně.
revoke all privileges on table public.google_routes_rate_limit_buckets from public;
revoke all privileges on table public.google_routes_rate_limit_buckets from anon;
revoke all privileges on table public.google_routes_rate_limit_buckets from authenticated;

create or replace function public.consume_google_routes_rate_limit()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_minute_start timestamptz := date_trunc('minute', now());
  v_day_start date := (now() at time zone 'utc')::date;
  v_minute_limit constant integer := 10;
  v_day_limit constant integer := 100;
  v_minute_count integer;
  v_day_count integer;
  v_retry_after integer;
begin
  -- Identita pochází výhradně z ověřeného JWT; cizí user ID nelze podstrčit,
  -- protože funkce žádný parametr s uživatelem nepřijímá.
  if v_user_id is null then
    raise exception 'rate limit requires an authenticated user' using errcode = '28000';
  end if;

  -- Jediný atomický zápis: kontrola obou oken i zvýšení počítadel proběhne
  -- v jednom INSERT ... ON CONFLICT DO UPDATE. Žádné SELECT-then-UPDATE,
  -- takže souběžné požadavky nemohou limit překročit.
  -- WHERE podmínka odmítne zápis, pokud je kteréhokoli okno vyčerpané;
  -- vypršelé okno se v tomtéž zápisu resetuje na 1.
  insert into public.google_routes_rate_limit_buckets as b (
    user_id,
    minute_bucket_start,
    minute_request_count,
    day_bucket_start,
    day_request_count,
    updated_at
  )
  values (
    v_user_id,
    v_minute_start,
    1,
    v_day_start,
    1,
    now()
  )
  on conflict (user_id) do update
    set
      minute_request_count = case
        when b.minute_bucket_start = v_minute_start then b.minute_request_count + 1
        else 1
      end,
      minute_bucket_start = v_minute_start,
      day_request_count = case
        when b.day_bucket_start = v_day_start then b.day_request_count + 1
        else 1
      end,
      day_bucket_start = v_day_start,
      updated_at = now()
    where (b.minute_bucket_start <> v_minute_start or b.minute_request_count < v_minute_limit)
      and (b.day_bucket_start <> v_day_start or b.day_request_count < v_day_limit)
  returning b.minute_request_count, b.day_request_count
  into v_minute_count, v_day_count;

  if v_minute_count is not null then
    return query select true, 0;
    return;
  end if;

  -- Limit je vyčerpaný. Vracíme jen minimální údaj: kdy je další pokus možný.
  -- Počítadla se klientovi nikdy neprozrazují.
  select
    case
      when b.day_bucket_start = v_day_start and b.day_request_count >= v_day_limit
        then greatest(1, ceil(extract(epoch from (((v_day_start + 1)::timestamp at time zone 'utc') - now()))))::integer
      else greatest(1, ceil(extract(epoch from ((v_minute_start + interval '1 minute') - now()))))::integer
    end
  into v_retry_after
  from public.google_routes_rate_limit_buckets b
  where b.user_id = v_user_id;

  return query select false, coalesce(v_retry_after, 60);
end;
$$;

comment on function public.consume_google_routes_rate_limit() is
  'Atomically consumes one Google Routes attempt for the authenticated user (10/min, 100/day UTC). Returns only whether the call is allowed and when to retry; never exposes counters.';

-- Anonym ani široká veřejnost funkci volat nesmí; jen ověřený uživatel.
revoke all on function public.consume_google_routes_rate_limit() from public;
revoke all on function public.consume_google_routes_rate_limit() from anon;
revoke all on function public.consume_google_routes_rate_limit() from authenticated;
grant execute on function public.consume_google_routes_rate_limit() to authenticated;

commit;
