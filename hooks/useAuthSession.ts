import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Alert } from "react-native";
import { supabase } from "../lib/supabase";
import { formatSupabaseError } from "../lib/labels";

// Očekávaná auth odmítnutí, která aplikace zpracuje Alertem — záměrně se nelogují,
// aby nespouštěly LogBox. Neočekávané chyby se logují strukturovaně (bez hesel/tokenů/PII).
const EXPECTED_AUTH_ERROR_CODES = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_banned",
  "over_request_rate_limit",
  "user_already_exists",
  "weak_password",
  "over_email_send_rate_limit",
]);

function logUnexpectedAuthError(scope: string, error: { message?: string; code?: string; status?: number | null }) {
  console.error(`Supabase ${scope} error:`, {
    code: error.code ?? null,
    status: error.status ?? null,
    message: error.message,
  });
}

export type RegistrationValues = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  passwordConfirmation: string;
};

/**
 * Autentizace pro AppContext: session, přihlášení, registrace, odhlášení.
 * Nástupce useAuth.ts (ten smažeme v Kroku 4). Logika je 1:1, rozdíl je jen v tom,
 * že formulářový stav (heslo, načítání, registrační pole) žije v obrazovkách
 * LoginScreen / SignupScreen a do funkcí se předává jako argument.
 *
 * `loginEmail` ZÁMĚRNĚ zůstává tady (v kontextu): e-mail se má zachovat po
 * neúspěšném přihlášení i po odhlášení, aby ho uživatel nemusel přepisovat.
 * Heslo je lokální stav obrazovky a mizí s ní.
 */
export function useAuthSession({
  setScreen,
  onUnauthenticated,
}: {
  setScreen: Dispatch<SetStateAction<string>>;
  onUnauthenticated: () => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [authInitialized, setAuthInitialized] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        console.error("Auth session init:", error.message);
      }
      const sessionUserId = data.session?.user?.id ?? null;
      if (sessionUserId) {
        setUserId(sessionUserId);
        setScreen((currentScreen) =>
          currentScreen === "welcome" || currentScreen === "login" || currentScreen === "signup"
            ? "home"
            : currentScreen
        );
      } else {
        onUnauthenticated();
      }
      setAuthInitialized(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUserId = session?.user?.id ?? null;
      if (sessionUserId) {
        setUserId(sessionUserId);
      } else {
        onUnauthenticated();
        setScreen("home");
      }
      setAuthInitialized(true);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  /**
   * Vrací "invalid" (chybí e-mail/heslo — nic se neodeslalo), "failed" (Supabase
   * odmítl) nebo "success". Obrazovka podle toho rozhoduje o mazání hesla.
   */
  async function loginUser(password: string): Promise<"invalid" | "failed" | "success"> {
    const email = loginEmail.trim();

    if (!email || !password) {
      Alert.alert("Chybí údaje", "Zadejte prosím e-mail a heslo.");
      return "invalid";
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (!EXPECTED_AUTH_ERROR_CODES.has(error.code ?? "")) {
        logUnexpectedAuthError("signIn", error);
      }
      Alert.alert("Přihlášení se nepodařilo", formatSupabaseError(error));
      return "failed";
    }

    if (data.user) {
      setUserId(data.user.id);
    }

    setScreen("home");
    return "success";
  }

  async function signOutUser() {
    setSignOutLoading(true);
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Supabase signOut error:", error);
      Alert.alert("Odhlášení se nepodařilo", formatSupabaseError(error));
      setSignOutLoading(false);
      return;
    }

    onUnauthenticated();
    setScreen("home");
    setSignOutLoading(false);
  }

  /** Vrací true, pokud proběhla validace a Supabase volání (i s chybou); false = neplatný vstup. */
  async function registerUser(values: RegistrationValues): Promise<boolean> {
    const firstName = values.firstName.trim();
    const lastName = values.lastName.trim();
    const phone = values.phone.trim();
    const email = values.email.trim();
    const password = values.password;
    const passwordConfirmation = values.passwordConfirmation;

    if (!firstName || !lastName || !phone || !email || !password) {
      Alert.alert("Chybí údaje", "Vyplňte prosím všechna povinná pole.");
      return false;
    }

    if (password.length < 8) {
      Alert.alert("Neplatné heslo", "Heslo musí mít alespoň 8 znaků.");
      return false;
    }

    if (password !== passwordConfirmation) {
      Alert.alert("Neplatné heslo", "Potvrzení hesla se neshoduje.");
      return false;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      if (!EXPECTED_AUTH_ERROR_CODES.has(error.code ?? "")) {
        logUnexpectedAuthError("signUp", error);
      }
      Alert.alert("Registrace se nepodařila", formatSupabaseError(error));
      return true;
    }

    const user = data.user;
    if (!user) {
      console.error("Supabase signUp error: user was not created", { session: data.session });
      Alert.alert("Registrace se nepodařila", "Supabase nevytvořil uživatele.");
      return true;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      phone,
      role: "customer",
    });

    if (profileError) {
      console.error("Supabase profile insert error:", profileError);
      Alert.alert(
        "Registrace se nedokončila",
        `Profil se nepodařilo uložit.\n\n${formatSupabaseError(profileError)}`
      );
      return true;
    }

    if (data.session) {
      setUserId(user.id);
      setScreen("home");
      Alert.alert("Registrace dokončena", "Váš účet byl vytvořen.");
    } else {
      Alert.alert("Registrace dokončena", "Účet byl vytvořen. Pro pokračování potvrďte e-mail.");
      setScreen("login");
    }
    return true;
  }

  return {
    userId,
    setUserId,
    authInitialized,
    loginEmail,
    setLoginEmail,
    signOutLoading,
    loginUser,
    registerUser,
    signOutUser,
  };
}
