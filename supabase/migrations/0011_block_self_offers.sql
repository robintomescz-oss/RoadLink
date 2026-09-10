-- 0011 – RoadLink: block self-offers at tow_offers INSERT authorization
--
-- Live change already applied; this file records it for the repository.
-- Strengthens both tow_offers INSERT policies so a valid offer must satisfy:
--   driver_id = auth.uid()
--   AND the referenced request is open and owned by someone else.
-- This blocks offers on own requests and on non-open requests while driver_id
-- spoofing stays impossible. Offer selection (select_tow_offer) is untouched.

BEGIN;

DROP POLICY IF EXISTS "Drivers can create their own offers" ON public.tow_offers;
DROP POLICY IF EXISTS tow_offers_insert ON public.tow_offers;

CREATE POLICY "Drivers can create their own offers"
ON public.tow_offers
FOR INSERT
TO authenticated
WITH CHECK (
  driver_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tow_requests AS tr
    WHERE tr.id = tow_offers.tow_request_id
      AND tr.customer_id <> auth.uid()
      AND tr.status = 'open'
  )
);

CREATE POLICY tow_offers_insert
ON public.tow_offers
FOR INSERT
TO authenticated
WITH CHECK (
  driver_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tow_requests AS tr
    WHERE tr.id = tow_offers.tow_request_id
      AND tr.customer_id <> auth.uid()
      AND tr.status = 'open'
  )
);

COMMIT;
