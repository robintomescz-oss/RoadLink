import type { User } from "@supabase/supabase-js";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

/**
 * Google přihlášení = OAuth tok Supabase + systémový prohlížeč (PKCE).
 *
 *   signInWithOAuth({ skipBrowserRedirect: true })  → URL na Google
 *   WebBrowser.openAuthSessionAsync(url, redirectTo) → návrat na deep link s `code`
 *   exchangeCodeForSession(code)                     → session v aplikaci
 *
 * Předpoklady:
 *   * `flowType: "pkce"` v lib/supabase.ts (jinak callback neobsahuje `code`);
 *   * `scheme: "roadlink"` v app.json (cíl deep linku);
 *   * Google provider + Redirect URL v Supabase (viz docs/google-auth-setup.md).
 */

export const GOOGLE_AUTH_SCHEME = "roadlink";
export const GOOGLE_AUTH_CALLBACK_PATH = "auth/callback";

/** Redirect URL, na kterou Supabase vrátí uživatele (musí být v allow listu v Supabase). */
export function googleAuthRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: GOOGLE_AUTH_SCHEME,
    path: GOOGLE_AUTH_CALLBACK_PATH,
  });
}

export type OAuthRedirect = {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
};

/**
 * Rozparsuje návratovou URL z prohlížeče. Supabase vrací `code` v query
 * (PKCE) nebo při chybě `error`/`error_description`; pro jistotu čteme i fragment.
 */
export function parseOAuthRedirect(url: string): OAuthRedirect {
  const empty: OAuthRedirect = { code: null, error: null, errorDescription: null };
  if (!url) return empty;

  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  const parts: string[] = [];
  if (queryStart >= 0) parts.push(url.slice(queryStart + 1, hashStart >= 0 ? hashStart : undefined));
  if (hashStart >= 0) parts.push(url.slice(hashStart + 1));

  for (const part of parts) {
    const params = new URLSearchParams(part);
    const code = params.get("code");
    const error = params.get("error");
    if (code || error) {
      return {
        code,
        error,
        errorDescription: params.get("error_description"),
      };
    }
  }

  return empty;
}

export type GoogleProfileSeed = {
  first_name: string;
  last_name: string;
  phone: string;
  role: "customer";
};

const FALLBACK_FIRST_NAME = "Uživatel";

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function emailLocalPart(email: string | null | undefined) {
  const normalized = (email || "").trim();
  if (!normalized.includes("@")) return "";
  return normalized.split("@")[0].replace(/[._-]+/g, " ").trim();
}

/**
 * Sestaví řádek tabulky profiles pro uživatele z Google účtu.
 * Google posílá given_name/family_name, u některých účtů jen name/full_name.
 * Telefon v Google profilu není — uživatel ho doplní v obrazovce Profil,
 * proto je tu prázdný řetězec (ne null), aby insert nespadl na NOT NULL.
 */
export function buildGoogleProfileSeed(
  user: Pick<User, "email" | "user_metadata">
): GoogleProfileSeed {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const fullName = metadataString(metadata, "full_name") || metadataString(metadata, "name");
  const nameParts = fullName.split(/\s+/).filter(Boolean);

  const firstName = metadataString(metadata, "given_name") || nameParts[0] || emailLocalPart(user.email) || FALLBACK_FIRST_NAME;
  const lastName = metadataString(metadata, "family_name") || (nameParts[0] === firstName ? nameParts.slice(1).join(" ") : "");

  return {
    first_name: firstName,
    last_name: lastName,
    phone: "",
    role: "customer",
  };
}

export type EnsureProfileResult = "exists" | "created" | "failed";

/**
 * Zajistí existenci řádku v profiles. Registrace e-mailem si řádek zakládá sama
 * (registerUser); Google OAuth takový krok nemá, takže by uživatel zůstal bez
 * profilu a obrazovka Profil by nic nenačetla. RLS povoluje insert jen s id = auth.uid().
 */
export async function ensureProfileForUser(
  user: Pick<User, "id" | "email" | "user_metadata">
): Promise<EnsureProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Ensure profile (load):", error.message);
    return "failed";
  }
  if (data) return "exists";

  const { error: insertError } = await supabase
    .from("profiles")
    .insert({ id: user.id, ...buildGoogleProfileSeed(user) });

  if (insertError) {
    console.error("Ensure profile (insert):", insertError.message);
    return "failed";
  }

  return "created";
}

export type GoogleSignInResult =
  | { status: "cancelled" }
  | { status: "success"; userId: string; profile: EnsureProfileResult }
  | { status: "error"; message: string };

/**
 * Kompletní Google přihlášení/registrace. Vrací strukturovaný výsledek;
 * uživatelské hlášky řeší volající (hooks/useAuthSession.ts).
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const redirectTo = googleAuthRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error) return { status: "error", message: error.message };
  if (!data?.url) {
    return { status: "error", message: "Supabase nevrátil přihlašovací adresu." };
  }

  const browserResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (browserResult.type !== "success") {
    // "cancel" / "dismiss" / "locked" = uživatel prohlížeč zavřel, není to chyba.
    return { status: "cancelled" };
  }

  const redirect = parseOAuthRedirect(browserResult.url);
  if (redirect.error) {
    return { status: "error", message: redirect.errorDescription || redirect.error };
  }
  if (!redirect.code) {
    return { status: "error", message: "V návratové adrese chybí přihlašovací kód." };
  }

  const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    redirect.code
  );

  if (exchangeError) return { status: "error", message: exchangeError.message };

  const authUser = exchangeData.user ?? exchangeData.session?.user ?? null;
  if (!authUser) return { status: "error", message: "Supabase nevytvořil přihlášenou session." };

  const profile = await ensureProfileForUser(authUser);
  return { status: "success", userId: authUser.id, profile };
}
