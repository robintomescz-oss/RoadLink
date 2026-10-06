-- Oprava oprávnění helperu pro ukládání volné kapacity
--
-- Symptom na telefonu: vytvoření `carrier_routes` skončilo chybou
-- `permission denied for function carrier_route_via_coordinates_valid`.
--
-- Příčina: trigger `assign_carrier_route_bbox()` volá helper
-- `carrier_route_via_coordinates_valid(...)`. Předchozí migrace helper zamkla i
-- pro roli `authenticated`; insert klienta pak nemůže trigger dokončit.
--
-- Bezpečnost: helper je IMMUTABLE SQL funkce bez čtení tabulek. Z libovolných
-- vstupních polí vrací jen boolean validace souřadnic. Nezpřístupňuje uložené
-- souřadnice ani nedává SELECT/INSERT/UPDATE práva na žádnou tabulku.
--
-- Tato migrace nemění tabulky ani data.

begin;

revoke all on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) from public;
revoke all on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) from anon;
grant execute on function public.carrier_route_via_coordinates_valid(text[], double precision[], double precision[]) to authenticated;

commit;
