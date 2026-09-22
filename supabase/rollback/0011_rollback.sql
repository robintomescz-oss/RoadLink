-- Rollback for 0011 – restore pre-0011 tow_offers INSERT authorization
-- (driver_id ownership only, without self-offer/open-request checks).

BEGIN;

DROP POLICY IF EXISTS "Drivers can create their own offers" ON public.tow_offers;
DROP POLICY IF EXISTS tow_offers_insert ON public.tow_offers;

CREATE POLICY "Drivers can create their own offers"
ON public.tow_offers
FOR INSERT
TO authenticated
WITH CHECK (driver_id = auth.uid());

CREATE POLICY tow_offers_insert
ON public.tow_offers
FOR INSERT
TO authenticated
WITH CHECK (driver_id = auth.uid());

COMMIT;
