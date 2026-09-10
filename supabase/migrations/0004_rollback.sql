-- Rollback for 0004 – restore previous direct tow_offers update access.
-- Use only if deliberately reverting the P0 security fix.

begin;

GRANT UPDATE ON TABLE public.tow_offers TO authenticated;

CREATE POLICY "Drivers can update their own offers"
ON public.tow_offers
FOR UPDATE
TO authenticated
USING (driver_id = auth.uid())
WITH CHECK (driver_id = auth.uid());

CREATE POLICY tow_offers_update
ON public.tow_offers
FOR UPDATE
TO authenticated
USING (driver_id = auth.uid());

commit;
