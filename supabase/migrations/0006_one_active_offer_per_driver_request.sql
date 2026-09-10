-- 0006 – RoadLink: one active tow offer per provider/request
--
-- Live change already applied; this file records it for the repository.
-- Data repair: the older duplicate pending row for the known pair is moved
-- to 'rejected'. The narrowed WHERE clause guarantees no other row changes.
-- Structural protection: partial UNIQUE index allows rejected/withdrawn
-- history plus one new active offer, while blocking a second
-- pending/accepted row for the same (tow_request_id, driver_id).
-- Rollback drops the index only; the historical cleanup remains.

BEGIN;

UPDATE public.tow_offers
SET status = 'rejected'
WHERE id = 'b06b7174-9b9d-4ee2-bbe3-72d76c951f9f'
  AND tow_request_id = 'ae7cd311-6c14-4c1b-b24d-f8ab42eaea4e'
  AND driver_id = '739d0db9-885b-48f1-a71d-c840c097f941'
  AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS tow_offers_one_active_offer_per_driver_request_idx
ON public.tow_offers (tow_request_id, driver_id)
WHERE status IN ('pending', 'accepted');

COMMIT;
