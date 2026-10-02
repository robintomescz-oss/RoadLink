import { useCallback, useEffect, useState } from "react";

import { supabase } from "../lib/supabase";
import {
  buildPersonalVehiclePayload,
  mapPersonalVehicleRow,
  normalizePersonalVehicle,
  type PersonalVehicle,
  type PersonalVehicleInput,
} from "../lib/personalVehicles";

/**
 * Osobní vozidla přihlášeného uživatele.
 *
 * Oddělené od `useProfile().vehicles`, které načítá `carrier_vehicles` přes
 * přepravní profil. Osobní vozidla jsou soukromá a nesmí se dostat do
 * přepravního trhu, nabídky ani matchingu.
 *
 * Načítání je záměrně zablokované bez `userId`: bez přihlášení se nesmí
 * načíst žádné soukromé vozidlo, a RLS by to stejně odmítlo.
 */

export type PersonalVehicleRecord = PersonalVehicle & { id: string };

export function usePersonalVehicles(userId: string | null | undefined) {
  const [personalVehicles, setPersonalVehicles] = useState<PersonalVehicleRecord[]>([]);
  const [personalVehiclesLoading, setPersonalVehiclesLoading] = useState(false);
  const [personalVehiclesError, setPersonalVehiclesError] = useState<string | null>(null);
  // Vozidlo právě upravované. `navigateLegacy` je reset zásobníku, takže route
  // parametr by se nepodal dál; stav musí žít mimo obrazovku, jako to dělá
  // `useProfile().editVehicle` pro přepravní vozidla.
  const [editingPersonalVehicleId, setEditingPersonalVehicleId] = useState<string | null>(null);

  function editPersonalVehicle(vehicleId: string | null) {
    setEditingPersonalVehicleId(vehicleId);
  }

  const loadPersonalVehicles = useCallback(async () => {
    // Bez ověřeného uživatele se nic nečte. RLS by požadavek stejně odmítlo,
    // ale chyba by se v UI projevila jinak než prázdný stav.
    if (!userId) {
      setPersonalVehicles([]);
      setPersonalVehiclesLoading(false);
      return;
    }

    setPersonalVehiclesLoading(true);
    setPersonalVehiclesError(null);
    const { data, error } = await supabase
      .from("personal_vehicles")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      // `42P01` = tabulka `personal_vehicles` v této databázi ještě není.
      // To je DOČASNÝ stav před aplikací migrace 20261004090000, ne chyba
      // uživatele ani přihlášení. Zobrazí se prázdný stav s možností přidat
      // vozidlo; po aplikaci migrace se tato větev nespustí, protože dotaz
      // začne vracet řádky normálně.
      //
      // Ostatní chyby (síť, RLS, oprávnění) jsou skutečné chyby a musí mít
      // Retry — nesmí se zaměnit za „nemáte žádné vozidlo“.
      const code = (error as { code?: string } | null)?.code ?? null;
      const missingTable = code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "");
      setPersonalVehicles([]);
      setPersonalVehiclesLoading(false);
      setPersonalVehiclesError(missingTable ? null : "Moje vozidla se nepodařilo načíst.");
      return;
    }

    const rows = (Array.isArray(data) ? data : [])
      .map((row) => {
        const vehicle = mapPersonalVehicleRow(row as Record<string, unknown>);
        return vehicle && typeof row.id === "string" ? { ...vehicle, id: row.id } : null;
      })
      .filter((item): item is PersonalVehicleRecord => item !== null);

    setPersonalVehicles(rows);
    setPersonalVehiclesLoading(false);
  }, [userId]);

  useEffect(() => {
    void loadPersonalVehicles();
  }, [loadPersonalVehicles]);

  /** Vloží vozidlo vlastníkovi. Cizí `user_id` nejde podstrčit — RLS to odmítne. */
  async function addPersonalVehicle(input: PersonalVehicleInput) {
    if (!userId) return { ok: false as const, message: "Pro přidání vozidla se přihlaste." };
    const payload = buildPersonalVehiclePayload(input);
    if (!payload) return { ok: false as const, message: "Vyplňte název, značku a model vozidla." };

    const { data, error } = await supabase
      .from("personal_vehicles")
      .insert({ ...payload, user_id: userId })
      .select("*")
      .single();

    if (error || !data) {
      return { ok: false as const, message: "Vozidlo se nepodařilo uložit." };
    }

    const vehicle = mapPersonalVehicleRow(data as Record<string, unknown>);
    if (vehicle && typeof data.id === "string") {
      setPersonalVehicles((current) => [...current, { ...vehicle, id: data.id as string }]);
    }
    return { ok: true as const };
  }

  async function updatePersonalVehicle(vehicleId: string, input: PersonalVehicleInput) {
    if (!userId) return { ok: false as const, message: "Pro úpravu vozidla se přihlaste." };
    const payload = buildPersonalVehiclePayload(input);
    if (!payload) return { ok: false as const, message: "Vyplňte název, značku a model vozidla." };

    // `user_id` se do payloadu neposílá: vlastnictví se tím nemění a RLS by
    // přesměrování na cizí řádek stejně odmítl.
    const { data, error } = await supabase
      .from("personal_vehicles")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", vehicleId)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error || !data) {
      return { ok: false as const, message: "Vozidlo se nepodařilo upravit." };
    }

    const vehicle = mapPersonalVehicleRow(data as Record<string, unknown>);
    if (vehicle && typeof data.id === "string") {
      setPersonalVehicles((current) => current.map((item) => (item.id === vehicleId ? { ...vehicle, id: vehicleId } : item)));
    }
    return { ok: true as const };
  }

  async function deletePersonalVehicle(vehicleId: string) {
    if (!userId) return { ok: false as const, message: "Pro smazání vozidla se přihlaste." };

    const { error } = await supabase
      .from("personal_vehicles")
      .delete()
      .eq("id", vehicleId)
      .eq("user_id", userId);

    if (error) {
      return { ok: false as const, message: "Vozidlo se nepodařilo smazat." };
    }

    setPersonalVehicles((current) => current.filter((item) => item.id !== vehicleId));
    return { ok: true as const };
  }

  return {
    personalVehicles,
    personalVehiclesLoading,
    personalVehiclesError,
    editingPersonalVehicleId,
    editPersonalVehicle,
    reloadPersonalVehicles: loadPersonalVehicles,
    addPersonalVehicle,
    updatePersonalVehicle,
    deletePersonalVehicle,
    normalizePersonalVehicle,
  };
}
