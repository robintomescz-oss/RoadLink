import React, { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import type { RootScreenProps } from "../../navigation/types";

export default function LoginScreen({ navigation }: RootScreenProps<"login">) {
  const {
    authState: { loginEmail, setLoginEmail, loginUser },
  } = useAppContext();

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
        <TouchableOpacity style={styles.primary} onPress={handleLogin} disabled={loginLoading}>
          <Text style={styles.primaryText}>{loginLoading ? "Přihlašuji…" : "Přihlásit"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setLoginPassword("");
            navigation.replace("signup");
          }}
          disabled={loginLoading}
        >
          <Text style={styles.link}>Nemám účet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setLoginPassword("");
            navigateLegacy("home");
          }}
          disabled={loginLoading}
        >
          <Text style={styles.link}>Zpět na úvod</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
