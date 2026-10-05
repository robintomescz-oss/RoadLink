import React, { useEffect, useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import type { TransportReview } from "../../lib/types";
import { styles } from "../../lib/appStyles";

export function TransportReviewPanel({ towRequestId }: { towRequestId: string }) {
  const [existing, setExisting] = useState<TransportReview | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.rpc("get_my_transport_review", { p_tow_request_id: towRequestId }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAvailable(false);
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (row && typeof row.rating === "number") {
        setExisting({ rating: row.rating, comment: typeof row.comment === "string" ? row.comment : null, createdAt: String(row.created_at ?? "") });
      }
    });
    return () => { active = false; };
  }, [towRequestId]);

  async function submit() {
    if (rating === null || loading) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("submit_transport_review", {
      p_tow_request_id: towRequestId,
      p_rating: rating,
      p_comment: comment,
    });
    setLoading(false);
    if (error || !data) {
      Alert.alert("Hodnocení se nepodařilo uložit", "Zkuste to prosím později.");
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setExisting({ rating: Number(row.rating), comment: typeof row.comment === "string" ? row.comment : null, createdAt: String(row.created_at ?? "") });
  }

  if (existing) {
    return <Text style={styles.detailBodyText}>Vaše hodnocení: {existing.rating}/5. Děkujeme za zpětnou vazbu.</Text>;
  }

  // Bez nasazené doprovodné migrace nenabízíme formulář, který nelze uložit.
  if (!available) return null;

  return (
    <View>
      <Text style={styles.detailBodyText}>Ohodnoťte druhou stranu přepravy. Hodnocení lze odeslat jednou po dokončení přepravy.</Text>
      <View style={styles.chipGrid} accessibilityRole="radiogroup" accessibilityLabel="Hodnocení od jedné do pěti hvězdiček">
        {[1, 2, 3, 4, 5].map((value) => (
          <TouchableOpacity key={value} style={[styles.selectChip, rating === value && styles.selectChipActive]} onPress={() => setRating(value)} accessibilityRole="radio" accessibilityState={{ selected: rating === value }} accessibilityLabel={`${value} z 5 hvězdiček`}>
            <Text style={[styles.selectChipText, rating === value && styles.selectChipTextActive]}>{value} ★</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput style={[styles.compactInput, styles.multilineInput]} value={comment} onChangeText={setComment} placeholder="Krátký komentář · volitelné" maxLength={500} multiline />
      <TouchableOpacity style={[styles.primary, (rating === null || loading) && styles.primaryDisabled]} onPress={submit} disabled={rating === null || loading} accessibilityLabel="Odeslat hodnocení">
        <Text style={styles.primaryText}>{loading ? "Odesílám…" : "Odeslat hodnocení"}</Text>
      </TouchableOpacity>
    </View>
  );
}
