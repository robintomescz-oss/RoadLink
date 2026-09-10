-- 0013 – RoadLink: request transport details for one-screen creation
--
-- Live change already applied; this file records it for the repository.
-- Adds tow_requests.date_to (window end; equals requested_date for a single
-- concrete date) and can_drive_onto_trailer (nullable tri-state), reusing
-- existing requested_date, vehicle_mobility, vehicle_model and
-- problem_description. All nullable: historical requests keep working.
-- No RLS/grant changes (table-level INSERT already covers new columns).

BEGIN;

ALTER TABLE public.tow_requests
  ADD COLUMN IF NOT EXISTS date_to date,
  ADD COLUMN IF NOT EXISTS can_drive_onto_trailer boolean;

COMMIT;
