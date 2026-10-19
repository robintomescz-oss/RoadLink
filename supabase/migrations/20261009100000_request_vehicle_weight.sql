-- Deploy before the client that submits vehicle_weight_band.
-- Historical requests remain unknown; no guessed weights or business updates.
BEGIN;
ALTER TABLE public.tow_requests ADD COLUMN IF NOT EXISTS vehicle_weight_band text;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tow_requests'::regclass AND conname = 'tow_requests_vehicle_weight_band_valid') THEN
ALTER TABLE public.tow_requests ADD CONSTRAINT tow_requests_vehicle_weight_band_valid
  CHECK (vehicle_weight_band IN ('up_to_1600', '1600_to_2000', '2000_to_2500', 'over_2500', 'unknown'));
END IF;
END $$;

CREATE OR REPLACE FUNCTION public.require_request_vehicle_weight() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.vehicle_weight_band IS NULL THEN
    NEW.vehicle_weight_band := 'unknown'; -- Compatibility for clients predating the weight selector.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_request_vehicle_weight() FROM PUBLIC;
CREATE OR REPLACE TRIGGER require_request_vehicle_weight
  BEFORE INSERT ON public.tow_requests FOR EACH ROW
  EXECUTE FUNCTION public.require_request_vehicle_weight();
COMMIT;
