-- Rollback for 0005 – remove provider identity RPC.
-- Use only if deliberately reverting offer provider identity access.

BEGIN;

DROP FUNCTION IF EXISTS public.get_offer_provider_identities(uuid);

COMMIT;
