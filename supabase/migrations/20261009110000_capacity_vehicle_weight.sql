-- Existing capacities stay NULL/unknown. No RLS or marketplace RPC changes.
BEGIN;
ALTER TABLE public.carrier_routes ADD COLUMN IF NOT EXISTS max_vehicle_weight_band text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.carrier_routes'::regclass AND conname = 'carrier_routes_max_vehicle_weight_band_valid') THEN
    ALTER TABLE public.carrier_routes ADD CONSTRAINT carrier_routes_max_vehicle_weight_band_valid
      CHECK (max_vehicle_weight_band IN ('up_to_1600', '1600_to_2000', '2000_to_2500', 'over_2500', 'unknown'));
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.require_route_vehicle_weight() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.max_vehicle_weight_band IS NULL THEN
    NEW.max_vehicle_weight_band := 'unknown'; -- Compatibility for clients predating the weight selector.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_route_vehicle_weight() FROM PUBLIC;
CREATE OR REPLACE TRIGGER require_route_vehicle_weight
  BEFORE INSERT ON public.carrier_routes FOR EACH ROW
  EXECUTE FUNCTION public.require_route_vehicle_weight();
COMMIT;
