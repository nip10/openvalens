const RECIPIENT_MASK = "***";

/**
 * Masks an email address so a recipient can be correlated in logs without
 * emitting the raw address (PHI-safe posture from Issue #9).
 */
export function maskEmailRecipient(email: string | null | undefined): string | undefined {
  if (!email) {
    return undefined;
  }

  const value = email.trim();
  const atIndex = value.indexOf("@");

  if (atIndex <= 0 || atIndex === value.length - 1) {
    return RECIPIENT_MASK;
  }

  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  const visibleLocal = localPart.length <= 2 ? localPart.slice(0, 1) : localPart.slice(0, 2);

  return `${visibleLocal}${RECIPIENT_MASK}@${domain}`;
}

export type MagicLinkLogMetadata = {
  event: string;
  recipient?: string;
  correlationId?: string;
  linkHost?: string;
  linkPath?: string;
  tokenFingerprint?: string;
  expiresInSeconds?: number;
  expiresAt?: string;
};

type MagicLinkLogInput = {
  event: string;
  email?: string | null;
  correlationId?: string | null;
  linkHost?: string | null;
  linkPath?: string | null;
  tokenFingerprint?: string | null;
  expiresInSeconds?: number | null;
  expiresAt?: string | null;
};

/**
 * Builds the PHI-safe metadata payload for a magic-link log line.
 *
 * Deliberately excludes the raw magic-link token and the full URL (whose query
 * string carries the token). Only the link host/path and a hashed fingerprint
 * of the token are retained.
 */
export function buildMagicLinkLogMetadata(input: MagicLinkLogInput): MagicLinkLogMetadata {
  const metadata: MagicLinkLogMetadata = {
    event: input.event,
  };

  const recipient = maskEmailRecipient(input.email);
  if (recipient) {
    metadata.recipient = recipient;
  }

  if (input.correlationId) {
    metadata.correlationId = input.correlationId;
  }

  if (input.linkHost) {
    metadata.linkHost = input.linkHost;
  }

  if (input.linkPath) {
    metadata.linkPath = input.linkPath;
  }

  if (input.tokenFingerprint) {
    metadata.tokenFingerprint = input.tokenFingerprint;
  }

  if (typeof input.expiresInSeconds === "number") {
    metadata.expiresInSeconds = input.expiresInSeconds;
  }

  if (input.expiresAt) {
    metadata.expiresAt = input.expiresAt;
  }

  return metadata;
}

export function buildMagicLinkSuccessLogMetadata(
  input: Omit<MagicLinkLogInput, "event">,
): MagicLinkLogMetadata {
  return buildMagicLinkLogMetadata({
    ...input,
    event: "auth.magic-link.sent",
  });
}
