-- Hodnocení dokončených přeprav.
--
-- Bezpečnost:
-- * recenzi lze vložit pouze přes RPC po skutečném stavu completed;
-- * obě strany mohou hodnotit právě jednou, samy sebe nikdy;
-- * klient nemůže určit hodnoceného uživatele ani upravovat starou recenzi;

begin;

create table if not exists public.transport_reviews (
  id uuid primary key default gen_random_uuid(),
  tow_request_id uuid not null references public.tow_requests(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  reviewee_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text null check (comment is null or char_length(btrim(comment)) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint transport_reviews_distinct_participants check (reviewer_id <> reviewee_id),
  constraint transport_reviews_one_per_reviewer unique (tow_request_id, reviewer_id)
);

create index if not exists transport_reviews_reviewee_created_idx
  on public.transport_reviews (reviewee_id, created_at desc);

alter table public.transport_reviews enable row level security;
revoke all on public.transport_reviews from public, anon, authenticated;

-- Přímé zápisy nejsou povolené. Výhradní vstup je submit_transport_review,
-- který atomicky ověřuje dokončení i obě strany přepravy.

create or replace function public.submit_transport_review(
  p_tow_request_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns public.transport_reviews
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_customer_id uuid;
  request_driver_id uuid;
  request_status text;
  target_user_id uuid;
  inserted_review public.transport_reviews;
  normalized_comment text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  select customer_id, driver_id, status
  into request_customer_id, request_driver_id, request_status
  from public.tow_requests
  where id = p_tow_request_id
  for share;

  if request_status is distinct from 'completed' then
    raise exception 'Transport is not completed';
  end if;
  if request_driver_id is null then
    raise exception 'Transport has no assigned provider';
  end if;

  if auth.uid() = request_customer_id then
    target_user_id := request_driver_id;
  elsif auth.uid() = request_driver_id then
    target_user_id := request_customer_id;
  else
    raise exception 'Transport participant required';
  end if;

  normalized_comment := nullif(btrim(coalesce(p_comment, '')), '');
  if normalized_comment is not null and char_length(normalized_comment) > 500 then
    raise exception 'Review comment is too long';
  end if;

  insert into public.transport_reviews (tow_request_id, reviewer_id, reviewee_id, rating, comment)
  values (p_tow_request_id, auth.uid(), target_user_id, p_rating, normalized_comment)
  returning * into inserted_review;

  return inserted_review;
exception
  when unique_violation then
    raise exception 'Review already submitted';
end;
$function$;

create or replace function public.get_my_transport_review(p_tow_request_id uuid)
returns table (rating smallint, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $function$
  select r.rating, r.comment, r.created_at
  from public.transport_reviews as r
  join public.tow_requests as tr on tr.id = r.tow_request_id
  where r.tow_request_id = p_tow_request_id
    and r.reviewer_id = auth.uid()
    and tr.status = 'completed'
    and auth.uid() in (tr.customer_id, tr.driver_id)
  limit 1;
$function$;

create or replace function public.get_my_transport_rating_summary()
returns table (average_rating numeric, review_count integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    round(avg(r.rating)::numeric, 1) as average_rating,
    count(*)::integer as review_count
  from public.transport_reviews as r
  where r.reviewee_id = auth.uid();
$function$;

revoke all on function public.submit_transport_review(uuid, smallint, text) from public, anon;
revoke all on function public.get_my_transport_review(uuid) from public, anon;
revoke all on function public.get_my_transport_rating_summary() from public, anon;
grant execute on function public.submit_transport_review(uuid, smallint, text) to authenticated;
grant execute on function public.get_my_transport_review(uuid) to authenticated;
grant execute on function public.get_my_transport_rating_summary() to authenticated;

comment on table public.transport_reviews is
  'Mutual immutable reviews after a completed transport. Insert exclusively through submit_transport_review.';

commit;
