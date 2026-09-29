import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  autocompleteLocations,
  createPlacesSessionToken,
  resolveVerifiedLocation,
  type LocationSuggestion,
  type VerifiedLocation,
} from "../../lib/verifiedLocation";
import { DESIGN } from "../../lib/design";

type Props = {
  label: string;
  placeholder: string;
  value: VerifiedLocation | null;
  onChange: (value: VerifiedLocation | null) => void;
  onError?: (message?: string) => void;
};

export function VerifiedLocationInput({ label, placeholder, value, onChange, onError }: Props) {
  const [text, setText] = useState(value?.formattedAddress ?? "");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const sessionTokenRef = useRef(createPlacesSessionToken());
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    if (value) setText(value.formattedAddress);
  }, [value]);

  useEffect(() => {
    const query = text.trim();
    if (value || query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const sequence = ++requestSequenceRef.current;
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await autocompleteLocations(query, sessionTokenRef.current);
        if (requestSequenceRef.current === sequence) setSuggestions(next);
      } catch (error) {
        if (requestSequenceRef.current === sequence) {
          setSuggestions([]);
          onError?.(error instanceof Error ? error.message : "Návrhy adres se nepodařilo načíst.");
        }
      } finally {
        if (requestSequenceRef.current === sequence) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [text, value, onError]);

  function changeText(next: string) {
    setText(next);
    setSuggestions([]);
    if (value) onChange(null);
    onError?.(undefined);
  }

  async function selectSuggestion(suggestion: LocationSuggestion) {
    if (resolving) return;
    setResolving(true);
    setText(suggestion.text);
    setSuggestions([]);
    try {
      const location = await resolveVerifiedLocation(suggestion.placeId, sessionTokenRef.current);
      onChange(location);
      setText(location.formattedAddress);
      onError?.(undefined);
      sessionTokenRef.current = createPlacesSessionToken();
    } catch (error) {
      onChange(null);
      onError?.(error instanceof Error ? error.message : "Vybranou adresu se nepodařilo ověřit.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <View style={localStyles.wrapper}>
      <Text style={localStyles.label}>{label}</Text>
      <View style={[localStyles.inputRow, value && localStyles.inputVerified]}>
        <TextInput
          style={localStyles.input}
          value={text}
          onChangeText={changeText}
          placeholder={placeholder}
          autoCorrect={false}
          autoCapitalize="words"
          accessibilityLabel={label}
        />
        {loading || resolving ? <ActivityIndicator color={DESIGN.colors.primary} /> : value ? <Text style={localStyles.check}>✓</Text> : null}
      </View>
      {value ? <Text style={localStyles.verifiedText}>Ověřeno · veřejně se zobrazí jen {value.publicLabel}</Text> : null}
      {suggestions.length > 0 ? (
        <View style={localStyles.suggestions}>
          {suggestions.map((suggestion) => (
            <TouchableOpacity key={suggestion.placeId} style={localStyles.suggestion} onPress={() => selectSuggestion(suggestion)} accessibilityRole="button">
              <Text style={localStyles.primaryText}>{suggestion.primaryText || suggestion.text}</Text>
              {suggestion.secondaryText ? <Text style={localStyles.secondaryText}>{suggestion.secondaryText}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const localStyles = StyleSheet.create({
  wrapper: { marginTop: DESIGN.spacing.sm },
  label: { color: DESIGN.colors.textPrimary, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  inputRow: { alignItems: "center", backgroundColor: DESIGN.colors.surface, borderColor: DESIGN.colors.border, borderRadius: 12, borderWidth: 1, flexDirection: "row", paddingHorizontal: 12 },
  inputVerified: { borderColor: "#2E8B57" },
  input: { color: DESIGN.colors.textPrimary, flex: 1, fontSize: 16, minHeight: 48, paddingVertical: 10 },
  check: { color: "#2E8B57", fontSize: 20, fontWeight: "800", marginLeft: 8 },
  verifiedText: { color: "#2E6E4F", fontSize: 12, lineHeight: 17, marginTop: 5 },
  suggestions: { backgroundColor: DESIGN.colors.surface, borderColor: DESIGN.colors.border, borderRadius: 12, borderWidth: 1, marginTop: 4, overflow: "hidden" },
  suggestion: { borderBottomColor: DESIGN.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 11 },
  primaryText: { color: DESIGN.colors.textPrimary, fontSize: 15, fontWeight: "700" },
  secondaryText: { color: DESIGN.colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
