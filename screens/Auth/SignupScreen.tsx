import React, { useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity } from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { styles } from "../../lib/appStyles";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import type { RootScreenProps } from "../../navigation/types";

export default function SignupScreen({ navigation }: RootScreenProps<"signup">) {
  const {
    authState: { registerUser },
  } = useAppContext();

  // Lokální stav registračního formuláře (dřív v useAuth / App).
  const [registrationFirstName, setRegistrationFirstName] = useState("");
  const [registrationLastName, setRegistrationLastName] = useState("");
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [registrationEmail, setRegistrationEmail] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [registrationPasswordConfirmation, setRegistrationPasswordConfirmation] = useState("");
  const [registrationLoading, setRegistrationLoading] = useState(false);

  async function handleRegister() {
    setRegistrationLoading(true);
    await registerUser({
      firstName: registrationFirstName,
      lastName: registrationLastName,
      phone: registrationPhone,
      email: registrationEmail,
      password: registrationPassword,
      passwordConfirmation: registrationPasswordConfirmation,
    });
    setRegistrationLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.registrationContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.logo}>RoadLink</Text>
        <Text style={styles.bigTitle}>Vytvořit účet</Text>
        <TextInput style={styles.input} value={registrationFirstName} onChangeText={setRegistrationFirstName} placeholder="Jméno" autoCapitalize="words" />
        <TextInput style={styles.input} value={registrationLastName} onChangeText={setRegistrationLastName} placeholder="Příjmení" autoCapitalize="words" />
        <TextInput style={styles.input} value={registrationPhone} onChangeText={setRegistrationPhone} placeholder="Telefon" keyboardType="phone-pad" />
        <TextInput style={styles.input} value={registrationEmail} onChangeText={setRegistrationEmail} placeholder="E-mail" keyboardType="email-address" autoCapitalize="none" />
        <TextInput style={styles.input} value={registrationPassword} onChangeText={setRegistrationPassword} placeholder="Heslo" secureTextEntry />
        <TextInput style={styles.input} value={registrationPasswordConfirmation} onChangeText={setRegistrationPasswordConfirmation} placeholder="Potvrzení hesla" secureTextEntry />
        <TouchableOpacity style={styles.primary} onPress={handleRegister} disabled={registrationLoading}>
          <Text style={styles.primaryText}>{registrationLoading ? "Vytvářím účet…" : "Vytvořit účet"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.replace("login")} disabled={registrationLoading}>
          <Text style={styles.link}>Už účet mám – Přihlásit se</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigateLegacy("home")} disabled={registrationLoading}>
          <Text style={styles.link}>Zpět na úvod</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
