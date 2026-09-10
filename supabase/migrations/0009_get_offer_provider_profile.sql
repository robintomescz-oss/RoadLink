-- 0009 – RoadLink: narrow offer-bound provider profile RPC for customers
--
-- Live change already applied; this file records it for the repository.
-- public.get_offer_provider_profile(p_offer_id uuid) lets the customer owner
-- of a tow request view a compact public profile of the provider who
-- submitted that specific offer. Authorization: caller authenticated, offer
-- exists, linked request owned by caller; returns the offer author's profile
-- row only, with an approved public field subset (no status, timestamps,
-- contact flags/values, or private profile/auth data). Missing profile
-- yields no row. Table grants and RLS are untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_offer_provider_profile(p_offer_id uuid)
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

COMMIT;
