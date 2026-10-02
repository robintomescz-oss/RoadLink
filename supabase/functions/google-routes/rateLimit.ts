/**
 * Serverový rate limit pro Edge Function `google-routes`.
 *
 * Limit žije v databázi (migrace 0016), ne v paměti funkce: počítadlo se
 * spotřebovává jediným atomickým zápisem v RPC `consume_google_routes_rate_limit`,
 * která se váže výhradně na ověřené `auth.uid()`. Klient ani Edge Function
 * neposílají user ID — identitu určuje databáze z JWT.
 *
 * Chování při chybě: fail-closed. Když limiter není dostupný, funkce vrátí
 * `{ ok: false }` a volající nesmí zavolat Google.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

/** Výchozí limity — musí zůstat stejné jako v migraci 0016. */
export const MINUTE_LIMIT = 10;
export const DAY_LIMIT = 100;

export const DEFAULT_RETRY_AFTER_SECONDS = 60;
export const MAX_RETRY_AFTER_SECONDS = 86400;

export const RATE_LIMIT_RPC = "consume_google_routes_rate_limit";

export type RateLimitFailure = {
  status: number;
  code: string;
  message: string;
};

/** Překročený lokální limit RoadLinku (nikoli Google 429). */
export const RATE_LIMITED: RateLimitFailure = {
  status: 429,
  code: "rate_limited",
  message: "Too many route calculations, try again later",
};

/** Interní chyba limiteru — Google se v tomto případě nesmí zavolat. */
export const RATE_LIMIT_UNAVAILABLE: RateLimitFailure = {
  status: 503,
  code: "rate_limit_unavailable",
  message: "Route service is temporarily unavailable",
};

/**
 * Normalizuje `retryAfterSeconds` z databáze. Nikdy nepřebírá neověřenou
 * hodnotu: nečíselné, nulové i záporné hodnoty padají na výchozí hodnotu,
 * příliš velké se zastřihnou na jeden den.
 */
export function normalizeRetryAfterSeconds(value: unknown): number {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

  if (!Number.isFinite(numeric)) return DEFAULT_RETRY_AFTER_SECONDS;

  const rounded = Math.ceil(numeric);
  if (rounded < 1) return DEFAULT_RETRY_AFTER_SECONDS;

  return Math.min(rounded, MAX_RETRY_AFTER_SECONDS);
}

export type RateLimitDecision =
  | { ok: true; allowed: boolean; retryAfterSeconds: number }
  | { ok: false };

/**
 * Atomicky spotřebuje jeden pokus ověřeného uživatele.
 *
 * `ok: false` znamená, že rozhodnutí není k dispozici (chybí konfigurace,
 * RPC selhala nebo vrátila neočekávaný tvar) — volající musí selhat bezpečně.
 */
export async function consumeGoogleRoutesRateLimit(accessToken: string): Promise<RateLimitDecision> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return { ok: false };

  try {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      // RPC se volá s kontextem uživatele, aby auth.uid() vrátilo ověřenou identitu.
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data, error } = await client.rpc(RATE_LIMIT_RPC);
    if (error) return { ok: false };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") return { ok: false };

    const record = row as Record<string, unknown>;
    if (typeof record.allowed !== "boolean") return { ok: false };

    return {
      ok: true,
      allowed: record.allowed,
      retryAfterSeconds: normalizeRetryAfterSeconds(record.retry_after_seconds),
    };
  } catch {
    return { ok: false };
  }
}
