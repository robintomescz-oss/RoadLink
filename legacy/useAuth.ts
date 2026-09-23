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

/**
 * Autentizace: inicializace session, přihlášení, registrace, odhlášení.
 * Vyextractováno 1:1 z App.tsx — chování beze změny.
 *
 * Volající straně předává:
 *  - setScreen pro přesměrování po přihlášení/odhlášení/registraci,
 *  - onUnauthenticated jako reakci na ztrátu session (vyčištění App stavu).
 */
export function useAuth({
  setScreen,
  onUnauthenticated,
}: {
  setScreen: Dispatch<SetStateAction<string>>;
  onUnauthenticated: () => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [registrationFirstName, setRegistrationFirstName] = useState("");
  const [registrationLastName, setRegistrationLastName] = useState("");
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [registrationEmail, setRegistrationEmail] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [registrationPasswordConfirmation, setRegistrationPasswordConfirmation] = useState("");
  const [registrationLoading, setRegistrationLoading] = useState(false);
  // Phase 1 Auth: login state + indikátor, že jsme již inicializovali session
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
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

  // UX rozhodnutí: e-mail se při neúspěšném přihlášení i po odhlášení záměrně zachovává,
  // aby ho uživatel nemusel přepisovat. Heslo se naopak vždy maže (neúspěch, opuštění
  // přihlašovací obrazovky, úspěch i odhlášení — viz loginUser a signOutUser).
  async function loginUser() {
    const email = loginEmail.trim();
    const password = loginPassword;

    if (!email || !password) {
      Alert.alert("Chybí údaje", "Zadejte prosím e-mail a heslo.");
      return;
    }

    setLoginLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (!EXPECTED_AUTH_ERROR_CODES.has(error.code ?? "")) {
        logUnexpectedAuthError("signIn", error);
      }
      Alert.alert("Přihlášení se nepodařilo", formatSupabaseError(error));
      setLoginPassword("");
      setLoginLoading(false);
      return;
    }

    if (data.user) {
      setUserId(data.user.id);
    }

    setLoginLoading(false);
    setLoginPassword("");
    setScreen("home");
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
    setLoginPassword("");
    setScreen("home");
    setSignOutLoading(false);
  }

  async function registerUser() {
    const firstName = registrationFirstName.trim();
    const lastName = registrationLastName.trim();
    const phone = registrationPhone.trim();
    const email = registrationEmail.trim();
    const password = registrationPassword;
    const passwordConfirmation = registrationPasswordConfirmation;

    if (!firstName || !lastName || !phone || !email || !password) {
      Alert.alert("Chybí údaje", "Vyplňte prosím všechna povinná pole.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Neplatné heslo", "Heslo musí mít alespoň 8 znaků.");
      return;
    }

    if (password !== passwordConfirmation) {
      Alert.alert("Neplatné heslo", "Potvrzení hesla se neshoduje.");
      return;
    }

    setRegistrationLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      if (!EXPECTED_AUTH_ERROR_CODES.has(error.code ?? "")) {
        logUnexpectedAuthError("signUp", error);
      }
      Alert.alert("Registrace se nepodařila", formatSupabaseError(error));
      setRegistrationLoading(false);
      return;
    }

    const user = data.user;
    if (!user) {
      console.error("Supabase signUp error: user was not created", { session: data.session });
      Alert.alert("Registrace se nepodařila", "Supabase nevytvořil uživatele.");
      setRegistrationLoading(false);
      return;
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
      setRegistrationLoading(false);
      return;
    }

    setRegistrationLoading(false);
    if (data.session) {
      setUserId(user.id);
      setScreen("home");
      Alert.alert("Registrace dokončena", "Váš účet byl vytvořen.");
    } else {
      Alert.alert("Registrace dokončena", "Účet byl vytvořen. Pro pokračování potvrďte e-mail.");
      setScreen("login");
    }
  }

  return {
    userId,
    setUserId,
    authInitialized,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginLoading,
    signOutLoading,
    registrationFirstName,
    setRegistrationFirstName,
    registrationLastName,
    setRegistrationLastName,
    registrationPhone,
    setRegistrationPhone,
    registrationEmail,
    setRegistrationEmail,
    registrationPassword,
    setRegistrationPassword,
    registrationPasswordConfirmation,
    setRegistrationPasswordConfirmation,
    registrationLoading,
    loginUser,
    registerUser,
    signOutUser,
  };
}
