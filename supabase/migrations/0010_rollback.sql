-- Rollback for 0010 – restore pre-0010 provider contact/privacy state.
-- Restores the old profile RPC shape, the active-profile cross-user SELECT
-- policy, and drops the public contact columns. Owner INSERT/UPDATE
-- policies and table grants are untouched.

BEGIN;

DROP FUNCTION IF EXISTS public.get_offer_provider_profile(uuid);

CREATE FUNCTION public.get_offer_provider_profile(p_offer_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  company_name text,
  business_type text,
  ico text,
  description text,
  service_area text,
  max_radius_km integer,
  years_experience integer,
  available_24_7 boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  offer_request_id uuid;
  offer_driver_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT o.tow_request_id, o.driver_id
  INTO offer_request_id, offer_driver_id
  FROM public.tow_offers AS o
  WHERE o.id = p_offer_id;

  IF offer_request_id IS NULL THEN
    RAISE EXCEPTION 'Offer not found or access denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tow_requests AS tr
    WHERE tr.id = offer_request_id
      AND tr.customer_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Offer not found or access denied';
  END IF;

  RETURN QUERY
  SELECT
    cp.user_id,
    cp.display_name,
    cp.company_name,
    cp.business_type,
    cp.ico,
    cp.description,
    cp.service_area,
    cp.max_radius_km,
    cp.years_experience,
    cp.available_24_7
  FROM public.carrier_profiles AS cp
  WHERE cp.user_id = offer_driver_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_offer_provider_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_offer_provider_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_offer_provider_profile(uuid) TO authenticated;

CREATE POLICY "Users can view active carrier profiles"
ON public.carrier_profiles
FOR SELECT
TO authenticated
USING (status = 'active');

ALTER TABLE public.carrier_profiles
  DROP COLUMN IF EXISTS public_phone,
  DROP COLUMN IF EXISTS public_email;

COMMIT;
