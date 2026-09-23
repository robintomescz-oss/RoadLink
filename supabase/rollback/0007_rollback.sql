-- Rollback for 0007 – restore direct authenticated UPDATE on tow_requests
-- and drop the driver lifecycle RPC.
-- Restores the exact pre-0007 state: UPDATE grant plus both UPDATE policies
-- ("Users can update their own tow requests" and "tow_requests_update").
-- select_tow_offer is untouched by this rollback.

BEGIN;

DROP FUNCTION IF EXISTS public.advance_tow_request_status(uuid, text, text);

GRANT UPDATE ON public.tow_requests TO authenticated;

CREATE POLICY "Users can update their own tow requests"
ON public.tow_requests
FOR UPDATE
TO authenticated
USING ((customer_id = auth.uid()) OR (driver_id = auth.uid()));

CREATE POLICY tow_requests_update
ON public.tow_requests
FOR UPDATE
TO authenticated
USING (customer_id = auth.uid());

COMMIT;
