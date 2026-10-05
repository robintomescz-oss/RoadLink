import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { TransportRatingSummary } from "../lib/types";

export function useTransportRatingSummary(userId: string | null): TransportRatingSummary | null {
  const [summary, setSummary] = useState<TransportRatingSummary | null>(null);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setSummary(null);
      return () => { active = false; };
    }

    void supabase.rpc("get_my_transport_rating_summary").then(({ data, error }) => {
      // Starší prostředí bez dosud aplikované migrace nevyhazuje LogBox ani
      // nepředstírá nulové hodnocení; karta se jen do nasazení nezobrazí.
      if (!active || error) return;
      const row = Array.isArray(data) ? data[0] : null;
      setSummary({
        averageRating: typeof row?.average_rating === "number" ? row.average_rating : null,
        reviewCount: typeof row?.review_count === "number" ? row.review_count : 0,
      });
    });

    return () => { active = false; };
  }, [userId]);

  return summary;
}
