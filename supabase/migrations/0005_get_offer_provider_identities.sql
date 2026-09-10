-- 0005 – RoadLink: expose minimal provider identity for customer offer cards
--
-- Records the already-applied live RPC used by customers to resolve provider
-- identity for offers on their own tow_request. The function exposes only
-- user_id, display_name, and company_name.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_offer_provider_identities(p_tow_request_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  company_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tow_requests AS tr
    WHERE tr.id = p_tow_request_id
      AND tr.customer_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Tow request not found or access denied';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    cp.user_id,
    cp.display_name,
    cp.company_name
  FROM public.tow_offers AS o
  JOIN public.carrier_profiles AS cp
    ON cp.user_id = o.driver_id
  WHERE o.tow_request_id = p_tow_request_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_offer_provider_identities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_offer_provider_identities(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_offer_provider_identities(uuid) TO authenticated;

COMMIT;
