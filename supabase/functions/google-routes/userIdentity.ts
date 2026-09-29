/**
 * Serverové ověření uživatele pro Edge Function `google-routes`.
 *
 * Jak to funguje:
 *   1. `verify_jwt = true` (supabase/config.toml) je první vrstva — platforma
 *      odmítne požadavek bez podepsaného JWT ještě před spuštěním kódu.
 *   2. Tento modul navíc ověří token u Supabase Auth serveru (`auth.getUser`),
 *      takže se odhalí i token expirovaný, zrušený nebo patřící smazanému účtu.
 *
 * Rozlišení výsledku (klíčové pro správnou odpověď i diagnostiku):
 *   * `unauthorized` (401) — token chybí, je neplatný, expirovaný nebo zrušený
 *     (Auth vrátil 401/403), případně token nevede na žádného uživatele;
 *   * `auth_unavailable` (503) — výpadek Auth služby (5xx), vyhozená síťová
 *     výjimka, timeout nebo nejednoznačná neznámá chyba. V tomto stavu se
 *     rozhodně nesmí pokračovat (fail-closed).
 *
 * Pravidla: identita se bere VÝHRADNĚ z ověřeného tokenu, nikdy z těla
 * požadavku; token, hlavička, user ID ani původní chyba Auth se nikdy nelogují
 * a nikdy se nevracejí klientovi.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { AUTH_FAILURE, AUTH_UNAVAILABLE, type SafeFailure } from "./requestAuth.ts";

export type UserIdentity =
  | { ok: true; userId: string }
  | { ok: false; failure: SafeFailure };

/** 401/403 = problém s přihlášením; vše ostatní je nejednoznačné a jde fail-closed. */
function failureFromAuthError(error: unknown): SafeFailure {
  const status = typeof error === "object" && error !== null
    ? (error as { status?: unknown }).status
    : undefined;

  if (status === 401 || status === 403) return AUTH_FAILURE;

  // 5xx, chybějící status (např. vyhozená síťová výjimka) i neznámá chyba.
  return AUTH_UNAVAILABLE;
}

/**
 * Ověří access token u Supabase Auth a vrátí ID uživatele.
 * `accessToken` pochází z `Authorization: Bearer ...` (viz requestAuth.ts).
 */
export async function resolveUserId(accessToken: string): Promise<UserIdentity> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  // Chybějící konfigurace není chyba přihlášení uživatele — je to nedostupnost.
  if (!supabaseUrl || !anonKey) return { ok: false, failure: AUTH_UNAVAILABLE };

  try {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await client.auth.getUser(accessToken);
    if (error) return { ok: false, failure: failureFromAuthError(error) };

    const userId = data?.user?.id;
    // Platný token bez uživatele (např. smazaný účet) = neautorizováno.
    if (typeof userId !== "string" || userId.length === 0) {
      return { ok: false, failure: AUTH_FAILURE };
    }

    return { ok: true, userId };
  } catch {
    // Vyhozená výjimka (síť, timeout) — bezpečně selhat jako nedostupnost.
    return { ok: false, failure: AUTH_UNAVAILABLE };
  }
}
