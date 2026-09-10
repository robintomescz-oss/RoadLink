-- 0008 – RoadLink: least-privilege table grants for client roles (P0 TRUNCATE fix)
--
-- Live change already applied; this file records it for the repository.
-- Removes RLS-exempt TRUNCATE (plus REFERENCES/TRIGGER) from anon and
-- authenticated on all app tables, revokes ALL anon table access (zero anon
-- RLS policies exist), and reduces authenticated to the exact minimum each
-- RoadLink flow needs. RLS policies, RPC bodies and EXECUTE grants are
-- untouched. SECURITY DEFINER RPCs run as owner and are unaffected.

BEGIN;

-- anon: no direct table access on any app table.
REVOKE ALL PRIVILEGES ON TABLE
  public.tow_requests,
  public.tow_offers,
  public.carrier_routes,
  public.carrier_route_interests,
  public.carrier_profiles,
  public.profiles,
  public.carrier_vehicles,
  public.carrier_verification,
  public.carrier_insurance
FROM anon;

-- authenticated: drop broad grants first, then grant exact minimum.
REVOKE ALL PRIVILEGES ON TABLE
  public.tow_requests,
  public.tow_offers,
  public.carrier_routes,
  public.carrier_route_interests,
  public.carrier_profiles,
  public.profiles,
  public.carrier_vehicles,
  public.carrier_verification,
  public.carrier_insurance
FROM authenticated;

GRANT SELECT, INSERT ON public.tow_requests TO authenticated;
GRANT SELECT, INSERT ON public.tow_offers TO authenticated;
GRANT SELECT, INSERT ON public.carrier_routes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.carrier_route_interests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.carrier_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_vehicles TO authenticated;
GRANT SELECT ON public.carrier_verification TO authenticated;
GRANT SELECT ON public.carrier_insurance TO authenticated;

COMMIT;
