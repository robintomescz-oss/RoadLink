-- Rollback for 0009 – drop the offer-bound provider profile RPC.
-- Table grants and RLS are untouched by this rollback.

BEGIN;

DROP FUNCTION IF EXISTS public.get_offer_provider_profile(uuid);

COMMIT;
