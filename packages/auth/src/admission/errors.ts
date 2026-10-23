/**
 * Typed admission failures (Issue #63).
 *
 * Every failure surfaced to a caller is one of a small, stable set of codes.
 * Messages are deliberately generic: they never embed a credential, token,
 * verification code, email, hash, database error or input value, so a caller
 * (or a log line that records the message) cannot leak admission secrets.
 * There is no `cause` and no structured detail to serialise.
 */
export type AdmissionErrorCode =
  | "DENIED"
  | "RATE_LIMITED"
  | "DELIVERY_FAILED"
  /** The server has no real email delivery (dry run): nothing was written or sent. */
  | "EMAIL_UNAVAILABLE"
  | "INTERNAL";

const MESSAGES: Record<AdmissionErrorCode, string> = {
  DENIED: "Admission denied.",
  RATE_LIMITED: "Too many attempts; try again later.",
  DELIVERY_FAILED: "Unable to deliver the message.",
  EMAIL_UNAVAILABLE: "Email delivery is not configured on this server.",
  INTERNAL: "Admission could not be completed.",
};

export class AdmissionError extends Error {
  readonly code: AdmissionErrorCode;

  constructor(code: AdmissionErrorCode) {
    super(MESSAGES[code]);
    this.name = "AdmissionError";
    this.code = code;
  }
}

export function isAdmissionError(value: unknown): value is AdmissionError {
  return value instanceof AdmissionError;
}
