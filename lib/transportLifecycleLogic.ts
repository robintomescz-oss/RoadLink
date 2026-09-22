import type { Job, JobStatus, TowOffer } from "./types";

export type TransportStatusScreen = "tracking" | "job";
export type TransportNextStatus = "in_progress" | "completed";
export type TransportStatusContext = {
  requestId: string;
  userId: string;
  screen: TransportStatusScreen;
  status: JobStatus;
  driverId: string;
};
export type TransportConfirmationContext = TransportStatusContext & {
  id: number;
  nextStatus: TransportNextStatus;
  used: boolean;
};

type TransportStatusControllerDeps = {
  getCurrentContext: () => TransportStatusContext | null;
  getCurrentConfirmationId: () => number;
  getPendingConfirmation: () => TransportConfirmationContext | null;
  setPendingConfirmation: (context: TransportConfirmationContext | null) => void;
  getSubmissionLocked: () => boolean;
  setSubmissionLocked: (value: boolean) => void;
  getLoading: () => boolean;
  setLoading: (value: boolean) => void;
  advanceStatus: (payload: ReturnType<typeof buildAdvanceTowRequestStatusPayload>) => Promise<{ error: unknown | null }>;
  applyOptimisticStatus: (requestId: string, nextStatus: TransportNextStatus) => void;
  refreshAfterStatusUpdate: () => Promise<void>;
  onError: (error: unknown) => void;
  onNotDriver: () => void;
  showConfirmation: (nextStatus: TransportNextStatus, clearConfirmation: () => void, submitConfirmation: () => void | Promise<void>) => void;
};

export function buildTransportStatusContext({
  activeJobId,
  activeJob,
  userId,
  screen,
  selectedOffer,
}: {
  activeJobId: string | null;
  activeJob: Job | null;
  userId: string | null;
  screen: string;
  selectedOffer: TowOffer | null;
}): TransportStatusContext | null {
  const currentScreen = screen === "tracking" || screen === "job" ? screen : null;
  return activeJobId && activeJob && userId && currentScreen && selectedOffer
    ? {
        requestId: activeJobId,
        userId,
        screen: currentScreen,
        status: activeJob.status,
        driverId: selectedOffer.driver_id,
      }
    : null;
}

export function canConfirmTransportStatusUpdate(
  currentContext: TransportStatusContext | null,
  nextStatus: TransportNextStatus,
  isLoading: boolean,
  isSubmitting: boolean,
  hasPendingConfirmation: boolean,
) {
  if (!currentContext || isLoading || isSubmitting || hasPendingConfirmation) return { allowed: false, reason: "not_available" as const };
  if (currentContext.driverId !== currentContext.userId) return { allowed: false, reason: "not_driver" as const };
  if (nextStatus === "in_progress" && currentContext.status !== "offer_selected") return { allowed: false, reason: "invalid_transition" as const };
  if (nextStatus === "completed" && currentContext.status !== "in_progress") return { allowed: false, reason: "invalid_transition" as const };
  return { allowed: true, reason: null };
}

export function isCurrentTransportConfirmation(
  confirmationContext: TransportConfirmationContext,
  currentContext: TransportStatusContext | null,
  currentConfirmationId: number,
) {
  return Boolean(
    currentContext &&
    confirmationContext.id === currentConfirmationId &&
    currentContext.requestId === confirmationContext.requestId &&
    currentContext.userId === confirmationContext.userId &&
    currentContext.screen === confirmationContext.screen &&
    currentContext.status === confirmationContext.status &&
    currentContext.driverId === confirmationContext.driverId
  );
}

export function buildAdvanceTowRequestStatusPayload(currentContext: TransportStatusContext, nextStatus: TransportNextStatus) {
  return {
    p_tow_request_id: currentContext.requestId,
    p_expected_status: currentContext.status,
    p_next_status: nextStatus,
  };
}

export function createTransportStatusController(deps: TransportStatusControllerDeps) {
  async function updateTransportStatus(confirmationContext: TransportConfirmationContext) {
    const currentContext = deps.getCurrentContext();
    if (
      deps.getSubmissionLocked() ||
      !isCurrentTransportConfirmation(confirmationContext, currentContext, deps.getCurrentConfirmationId())
    ) return;

    if (!currentContext) return;
    if (confirmationContext.nextStatus === "in_progress" && currentContext.status !== "offer_selected") return;
    if (confirmationContext.nextStatus === "completed" && currentContext.status !== "in_progress") return;

    deps.setSubmissionLocked(true);
    deps.setLoading(true);
    try {
      const payload = buildAdvanceTowRequestStatusPayload(currentContext, confirmationContext.nextStatus);
      const { error } = await deps.advanceStatus(payload);

      if (error) {
        deps.onError(error);
        return;
      }

      deps.applyOptimisticStatus(currentContext.requestId, confirmationContext.nextStatus);
      await deps.refreshAfterStatusUpdate();
    } catch (error) {
      deps.onError(error);
    } finally {
      deps.setSubmissionLocked(false);
      deps.setLoading(false);
    }
  }

  function confirmTransportStatusUpdate(nextStatus: TransportNextStatus) {
    const currentContext = deps.getCurrentContext();
    const guard = canConfirmTransportStatusUpdate(
      currentContext,
      nextStatus,
      deps.getLoading(),
      deps.getSubmissionLocked(),
      Boolean(deps.getPendingConfirmation())
    );
    if (!guard.allowed || !currentContext) {
      if (guard.reason === "not_driver") deps.onNotDriver();
      return;
    }

    const confirmationContext: TransportConfirmationContext = {
      id: deps.getCurrentConfirmationId(),
      requestId: currentContext.requestId,
      userId: currentContext.userId,
      screen: currentContext.screen,
      status: currentContext.status,
      nextStatus,
      driverId: currentContext.driverId,
      used: false,
    };
    deps.setPendingConfirmation(confirmationContext);

    const clearConfirmation = () => {
      if (!confirmationContext.used) confirmationContext.used = true;
      if (deps.getPendingConfirmation() === confirmationContext) {
        deps.setPendingConfirmation(null);
      }
    };

    const submitConfirmation = () => {
      if (confirmationContext.used || deps.getPendingConfirmation() !== confirmationContext) return;
      confirmationContext.used = true;
      deps.setPendingConfirmation(null);
      return updateTransportStatus(confirmationContext);
    };

    deps.showConfirmation(nextStatus, clearConfirmation, submitConfirmation);
  }

  return { confirmTransportStatusUpdate, updateTransportStatus };
}
