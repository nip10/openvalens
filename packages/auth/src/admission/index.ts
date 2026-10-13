/**
 * Public surface of the admission core (Issue #63).
 *
 * Consumers construct one service per server with their own database handle
 * and email-delivery callbacks. Delivery callbacks receive the raw email code
 * or invitation bearer exactly once and must not log or persist it.
 */
export { canonicalizeEmail } from "./email";
export { AdmissionError, isAdmissionError } from "./errors";
export type { AdmissionErrorCode } from "./errors";
export { createAdmissionService } from "./service";
export type {
  AdmissionBeginInput,
  AdmissionCompleteInput,
  AdmissionDeps,
  AdmissionInvitationSummary,
  AdmissionKind,
  AdmissionService,
  DeliverInvitation,
  DeliverVerification,
} from "./service";
