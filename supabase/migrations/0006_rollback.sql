-- Rollback for 0006 – drop the active-offer partial unique index.
-- The duplicate-row data repair is intentionally NOT reverted.

BEGIN;

DROP INDEX IF EXISTS public.tow_offers_one_active_offer_per_driver_request_idx;

COMMIT;
