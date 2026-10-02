import React, { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { useHardwareBackTo } from "../../hooks/useBackHandlers";
import type { RootScreenProps } from "../../navigation/types";

export default function LoginScreen({ navigation }: RootScreenProps<"login">) {
  const {
    authState: { loginEmail, setLoginEmail, loginUser, loginWithGoogle, googleLoading },
  } = useAppContext();

  // Hardware Back na přihlášení vede zpět na úvod místo ukončení aplikace.
  useHardwareBackTo("home");

  // Lokální stav formuláře. E-mail zůstává v kontextu (přežije odhlášení).
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  async function handleLogin() {
    setLoginLoading(true);
    const result = await loginUser(loginPassword);
    // Původní chování: heslo se maže po odeslání (úspěch i neúspěch),
    // ne když chyběly údaje.
    if (result !== "invalid") setLoginPassword("");
    setLoginLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.logo}>RoadLink</Text>
        <Text style={styles.bigTitle}>Přihlášení</Text>
        <TextInput
          style={styles.input}
          value={loginEmail}
          onChangeText={setLoginEmail}
          placeholder="E-mail"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={loginPassword}
          onChangeText={setLoginPassword}
          placeholder="Heslo"
          secureTextEntry
        />
        <TouchableOpacity
          style={styles.primary}
          onPress={handleLogin}
          disabled={loginLoading || googleLoading}
        >
          <Text style={styles.primaryText}>{loginLoading ? "Přihlašuji…" : "Přihlásit"}</Text>
        </TouchableOpacity>
        <View style={styles.authDividerRow}>
          <View style={styles.authDividerLine} />
          <Text style={styles.authDividerText}>nebo</Text>
          <View style={styles.authDividerLine} />
        </View>
        <TouchableOpacity
          style={styles.googleButton}
          onPress={loginWithGoogle}
          disabled={loginLoading || googleLoading}
        >
          <Text style={styles.googleMark}>G</Text>
          <Text style={styles.googleText}>
            {googleLoading ? "Otevírám Google…" : "Pokračovat přes Google"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setLoginPassword("");
            navigation.replace("signup");
          }}
          disabled={loginLoading || googleLoading}
        >
          <Text style={styles.link}>Nemám účet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setLoginPassword("");
            navigateLegacy("home");
          }}
          disabled={loginLoading || googleLoading}
        >
          <Text style={styles.link}>Zpět na úvod</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
