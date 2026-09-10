-- 0004 – RoadLink: record live P0 security fix for tow_offers direct updates
--
-- Records the already-applied production change that removes direct authenticated
-- UPDATE access to tow_offers. Offer selection must go through controlled RPC flow.
-- Do not run against production as part of this repository recording task; live DB
-- is already fixed.

begin;

DROP POLICY "Drivers can update their own offers" ON public.tow_offers;
DROP POLICY tow_offers_update ON public.tow_offers;
REVOKE UPDATE ON TABLE public.tow_offers FROM authenticated;

commit;
