-- Rollback for 0013 – drop request transport detail columns.

BEGIN;

ALTER TABLE public.tow_requests
  DROP COLUMN IF EXISTS date_to,
  DROP COLUMN IF EXISTS can_drive_onto_trailer;

COMMIT;
