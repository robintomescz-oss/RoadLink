-- 0007 – RoadLink: driver lifecycle via narrow RPC, no direct tow_requests UPDATE
--
-- Live change already applied; this file records it for the repository.
-- Replaces the App.tsx direct .update({status}) on tow_requests with
-- public.advance_tow_request_status(uuid, text, text), which enforces:
--   * caller is the assigned driver (request.driver_id = auth.uid())
--   * atomic expected-status match
--   * only offer_selected -> in_progress and in_progress -> completed
--   * status column only; no other tow_requests field is mutable via RPC
-- Direct authenticated UPDATE on tow_requests is revoked and both obsolete
-- UPDATE policies are dropped. SECURITY DEFINER RPCs (select_tow_offer,
-- advance_tow_request_status) bypass RLS as owner and are unaffected.
-- SELECT/INSERT behavior is unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_tow_request_status(
  p_tow_request_id uuid,
  p_expected_status text,
  p_next_status text
)
RETURNS public.tow_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  updated_request public.tow_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    (p_expected_status = 'offer_selected' AND p_next_status = 'in_progress')
    OR (p_expected_status = 'in_progress' AND p_next_status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid status transition';
  END IF;

  UPDATE public.tow_requests
  SET status = p_next_status
  WHERE id = p_tow_request_id
    AND driver_id = auth.uid()
    AND status = p_expected_status
  RETURNING * INTO updated_request;

  IF updated_request.id IS NULL THEN
    RAISE EXCEPTION 'Transport request not found or access denied';
  END IF;

  RETURN updated_request;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.advance_tow_request_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.advance_tow_request_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.advance_tow_request_status(uuid, text, text) TO authenticated;

REVOKE UPDATE ON public.tow_requests FROM authenticated;

DROP POLICY IF EXISTS "Users can update their own tow requests" ON public.tow_requests;
DROP POLICY IF EXISTS tow_requests_update ON public.tow_requests;

COMMIT;
