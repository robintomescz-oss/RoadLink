-- 0012 – RoadLink: customer cancellation of own open request
--
-- Live change already applied; this file records it for the repository.
-- Adds public.cancel_tow_request(uuid): owner-only, open-only cancellation
-- that atomically sets status='cancelled' and rejects pending offers.
-- Hardens public.select_tow_offer(uuid) to require request.status='open'
-- (previously only the offer had to be pending), so a cancelled request can
-- never accept an offer afterwards. Direct authenticated UPDATE on
-- tow_requests stays revoked. Status CHECK already allows 'cancelled'.

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_tow_request(p_tow_request_id uuid)
RETURNS public.tow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  cancelled_request public.tow_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.tow_requests
  SET status = 'cancelled'
  WHERE id = p_tow_request_id
    AND customer_id = auth.uid()
    AND status = 'open'
  RETURNING * INTO cancelled_request;

  IF cancelled_request.id IS NULL THEN
    RAISE EXCEPTION 'Transport request not found or access denied';
  END IF;

  UPDATE public.tow_offers
  SET status = 'rejected'
  WHERE tow_request_id = cancelled_request.id
    AND status = 'pending';

  RETURN cancelled_request;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_tow_request(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_tow_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_tow_request(uuid) TO authenticated;

-- Harden selection: request must still be open (cancelled requests stay final).
CREATE OR REPLACE FUNCTION public.select_tow_offer(p_offer_id uuid)
RETURNS tow_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  selected_offer public.tow_offers;
  request_customer_id uuid;
  request_status text;
begin
  select customer_id, status
  into request_customer_id, request_status
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

  if request_status <> 'open' then
    raise exception 'Poptávka již není dostupná';
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
