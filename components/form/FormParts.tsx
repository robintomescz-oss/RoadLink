import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles } from "../../lib/appStyles";

/**
 * Formulářové stavební bloky vyextrahované z App.tsx (FormBackHeader, FormSection,
 * FieldError, ReviewRow). V originále byly definované UVNITŘ komponenty App, takže
 * měly při každém renderu novou identitu a React jejich potomky (i TextInput)
 * pokaždé odpojil a znovu připojil. Na úrovni modulu se to neděje. Vzhled beze změny.
 */

export function FormBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.formBackHeader, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity style={styles.formBackButton} onPress={onBack} accessibilityLabel="Zpět">
        <Text style={styles.formBackText}>‹ Zpět</Text>
      </TouchableOpacity>
      <Text style={styles.formBackTitle}>{title}</Text>
    </View>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.formSectionCard}>
      <Text style={styles.formSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <Text style={styles.fieldError}>{message}</Text> : null;
}

export function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}
