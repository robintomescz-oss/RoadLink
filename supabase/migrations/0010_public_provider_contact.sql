-- 0010 – RoadLink: explicit public provider contact + owner-only profile reads
--
-- Live change already applied; this file records it for the repository.
-- Adds carrier_profiles.public_phone / public_email (explicitly published
-- contact values; NULL by default) and narrows carrier_profiles direct
-- SELECT to owner-only by removing the active-profile cross-user policy, so
-- stored contact values cannot be read outside the offer relationship.
-- Customer offer-profile access stays on the narrow offer-bound RPC, now
-- also returning flag-gated contact values. Owner INSERT/UPDATE behavior,
-- table grants and unrelated RLS are untouched.

BEGIN;

ALTER TABLE public.carrier_profiles
  ADD COLUMN IF NOT EXISTS public_phone text,
  ADD COLUMN IF NOT EXISTS public_email text;

DROP POLICY IF EXISTS "Users can view active carrier profiles"
  ON public.carrier_profiles;

-- Return shape changes: DROP + CREATE (CREATE OR REPLACE cannot do that).
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
  available_24_7 boolean,
  public_phone text,
  public_email text
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
    cp.available_24_7,
    CASE
      WHEN cp.phone_public = true THEN NULLIF(btrim(cp.public_phone), '')
      ELSE NULL
    END,
    CASE
      WHEN cp.email_public = true THEN NULLIF(btrim(cp.public_email), '')
      ELSE NULL
    END
  FROM public.carrier_profiles AS cp
  WHERE cp.user_id = offer_driver_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_offer_provider_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_offer_provider_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_offer_provider_profile(uuid) TO authenticated;

COMMIT;
