-- Rollback for 0012 – drop cancel RPC and restore pre-0012 select_tow_offer
-- (without the request-status-open requirement). Direct authenticated
-- UPDATE on tow_requests stays revoked.

BEGIN;

DROP FUNCTION IF EXISTS public.cancel_tow_request(uuid);

CREATE OR REPLACE FUNCTION public.select_tow_offer(p_offer_id uuid)
RETURNS tow_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  selected_offer public.tow_offers;
  request_customer_id uuid;
begin
  select customer_id
  into request_customer_id
  from public.tow_requests
  where id = (
    select tow_request_id
    from public.tow_offers
    where id = p_offer_id
  );

  if request_customer_id is null then
    raise exception 'Poptávka nebyla nalezena';
  end if;

  if request_customer_id <> auth.uid() then
    raise exception 'Nemáte oprávnění vybrat tuto nabídku';
  end if;

  select *
  into selected_offer
  from public.tow_offers
  where id = p_offer_id
    and status = 'pending';

  if selected_offer.id is null then
    raise exception 'Nabídka již není dostupná';
  end if;

  update public.tow_offers
  set status = 'rejected'
  where tow_request_id = selected_offer.tow_request_id
    and status = 'pending'
    and id <> selected_offer.id;

  update public.tow_offers
  set status = 'accepted'
  where id = selected_offer.id;

  update public.tow_requests
  set
    status = 'offer_selected',
    driver_id = selected_offer.driver_id,
    accepted_at = now()
  where id = selected_offer.tow_request_id;

  select *
  into selected_offer
  from public.tow_offers
  where id = selected_offer.id;

  return selected_offer;
end;
$function$;

COMMIT;
