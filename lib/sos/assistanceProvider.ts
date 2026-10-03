import type { SosLocationSummary, SosVehicleInput } from "./sosState";
import { cancelOrder, type SosState } from "./sosState";
import type { ProblemCategoryId } from "./sosContent";

/**
 * Integrační rozhraní pro objednání asistence u partnera.
 *
 * Projekt zatím NEMÁ připojené žádné reálné partnerské API. Proto tu je:
 *  - rozhraní `AssistanceProvider`, které v budoucnu implementuje reálný
 *    poskytovatel (obdoba `get_offer_provider_profile` apod.),
 *  - poctivý výchozí provider `noAssistanceProvider`, který vrací stav
 *    „unavailable" a odkáže uživatele na telefonní kontakt.
 *
 * Nevymýšlíme partnery, hodnocení, ceny, volnou kapacitu ani živé polohy.
 */

export type AssistanceOrderRequest = {
  offerId?: string;
  /** Stabilní klíč pro idempotenci na straně serveru. */
  clientRequestId: string;
  problemId: ProblemCategoryId | null;
  problemLabel: string;
  location: SosLocationSummary;
  vehicle: SosVehicleInput | null;
  roadTypeLabel: string;
  /** Textový popis toho, co se partnerovi předá (informovaný souhlas). */
  disclosedItems: string[];
};

export type AssistanceOffer = {
  offerId: string;
  providerName: string | null;
  serviceScope: string;
  /** Skutečně potvrzená cena, nebo null když je jen odhad. */
  confirmedPrice: string | null;
  /** Jasně označený odhad ceny, když potvrzená cena není. */
  estimatedPrice: string | null;
  etaMinutes: number | null;
  cancellationTerms: string;
};

export type AssistanceOrderResult =
  | {
      status: "accepted_by_provider";
      orderId: string;
      offer: AssistanceOffer;
    }
  | { status: "rejected"; reason: string }
  | { status: "unavailable"; reason: string; fallback: "phone" }
  | { status: "error"; message: string };

export type AssistanceProvider = {
  id: string;
  isConfigured: () => boolean;
  requestOrder: (request: AssistanceOrderRequest) => Promise<AssistanceOrderResult>;
  getOffer: (request: AssistanceOrderRequest) => Promise<AssistanceOffer>;
  cancelOrder: (orderId: string) => Promise<{ cancelled: boolean; message?: string }>;
};

/**
 * Výchozí provider: nic nepředstírá. Vrací „unavailable" a nabízí telefonní
 * kontakt jako poctivý fallback.
 */
export const noAssistanceProvider: AssistanceProvider = {
  id: "none",
  isConfigured: () => false,
  async getOffer() { throw new Error("Nabídky asistence nejsou dostupné."); },
  async cancelOrder() { return { cancelled: false, message: "Storno není dostupné." }; },
  async requestOrder(): Promise<AssistanceOrderResult> {
    return {
      status: "unavailable",
      reason:
        "Objednání u partnerské asistence zatím není dostupné – nejsou " +
        "připojené žádné reálné partnerské API.",
      fallback: "phone",
    };
  },
};

let activeProvider: AssistanceProvider = noAssistanceProvider;

/** Nahradí výchozí provider reálným (fáze 2 – až bude skutečné API). */
export function setAssistanceProvider(provider: AssistanceProvider): void {
  activeProvider = provider;
}

export function getAssistanceProvider(): AssistanceProvider {
  return activeProvider;
}

/** Stav zrušení se mění výhradně po potvrzení skutečným poskytovatelem. */
export async function cancelConfirmedOrder(provider: AssistanceProvider, state: SosState): Promise<SosState> {
  if (!state.order.orderId || provider.id !== state.order.providerName || !provider.isConfigured()) {
    throw new Error("Poskytovatel objednávky není dostupný.");
  }
  const result = await provider.cancelOrder(state.order.orderId);
  if (!result.cancelled) throw new Error(result.message || "Poskytovatel storno nepotvrdil.");
  return cancelOrder(state);
}

/** Reset do výchozího stavu (vhodné pro testy). */
export function resetAssistanceProvider(): void {
  activeProvider = noAssistanceProvider;
}

/**
 * Sestaví stabilní klíč objednávky z již existujícího klíče nebo vygeneruje
 * nový. Klíč se drží, dokud objednávka žije – retry se stejným klíčem tedy
 * na serveru (i tady) nezdvojí objednávku.
 */
export function resolveClientRequestId(
  existing: string | null,
  generator: () => string = defaultClientRequestId
): string {
  return existing && existing.length > 0 ? existing : generator();
}

let requestCounter = 0;

export function defaultClientRequestId(): string {
  requestCounter += 1;
  const random =
    typeof Math.random === "function" ? Math.random().toString(36).slice(2, 10) : "00000000";
  return `sos-${Date.now().toString(36)}-${requestCounter}-${random}`;
}

/** Reset čítače (testy). */
export function resetClientRequestIdCounter(): void {
  requestCounter = 0;
}
