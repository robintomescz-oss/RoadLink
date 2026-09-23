-- Rollback for 0008 – restore exact pre-0008 client table privileges.
-- Preserves history: authenticated UPDATE on tow_requests (revoked in 0007)
-- and on tow_offers (revoked in 0004) is NOT restored.

BEGIN;

-- anon: full grants everywhere except carrier_route_interests (never had any).
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tow_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tow_offers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_routes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_vehicles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_verification TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_insurance TO anon;

-- authenticated: pre-0008 state (tow_requests/tow_offers without UPDATE).
GRANT SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tow_requests TO authenticated;
GRANT SELECT, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tow_offers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_routes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.carrier_route_interests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_verification TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.carrier_insurance TO authenticated;

COMMIT;
