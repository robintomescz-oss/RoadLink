/**
 * Čisté autentizační pomůcky pro Edge Function `google-routes`.
 *
 * Modul neobsahuje žádné síťové volání ani čtení klíčů — jen ověří tvar
 * `Authorization: Bearer <token>` a definuje bezpečné chybové odpovědi.
 * Vlastní serverové ověření uživatele řeší userIdentity.ts.
 *
 * Token se nikdy neloguje, nevrací klientovi ani neposílá do Google.
 */

export const MAX_BEARER_TOKEN_LENGTH = 4096;

/** Schéma je case-insensitive, token nesmí obsahovat bílé znaky. */
const BEARER_PATTERN = /^Bearer[ \t]+([^\s]+)$/i;

export type SafeFailure = {
  status: number;
  code: string;
  message: string;
};

/** Jediná odpověď pro chybějící, poškozený, expirovaný i zrušený token. */
export const AUTH_FAILURE: SafeFailure = {
  status: 401,
  code: "unauthorized",
  message: "Missing or invalid authorization",
};

/**
 * Auth služba je nedostupná (výpadek, timeout, 5xx) — to není chyba přihlášení,
 * ale přesto platí fail-closed: bez ověřené identity se nesmí volat limiter
 * ani Google. Text záměrně nenabádá k odhlášení, protože přihlášení je v pořádku.
 */
export const AUTH_UNAVAILABLE: SafeFailure = {
  status: 503,
  code: "auth_unavailable",
  message: "Sign-in verification is temporarily unavailable",
};

/**
 * Vrátí access token z hlavičky, nebo null. Nikdy nevyhazuje, nikdy neloguje
 * a nikdy nevrací nic z hlavičky zpět volajícímu.
 */
export function parseBearerToken(headerValue: unknown): string | null {
  if (typeof headerValue !== "string") return null;

  const match = BEARER_PATTERN.exec(headerValue.trim());
  if (!match) return null;

  const token = match[1];
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) return null;

  return token;
}
