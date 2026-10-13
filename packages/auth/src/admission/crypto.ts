import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Admission credential cryptography (Issue #63).
 *
 * All secrets come from the platform CSPRNG. Setup and invitation bearers are
 * 32 random bytes rendered as base64url (256 bits); email proof codes are 16
 * random bytes (128 bits). Only SHA-256 digests are ever persisted, and the
 * digest input is domain separated so a setup secret, an invitation bearer and
 * an email code can never collide even if their raw values coincide.
 *
 * Nothing here reads the environment or performs I/O.
 */

export const SETUP_DOMAIN = "openvalens:admission:setup:";
export const INVITATION_DOMAIN = "openvalens:admission:invitation:";
export const CODE_DOMAIN = "openvalens:admission:code:";
export const EMAIL_LOCK_DOMAIN = "openvalens:admission:email:";

/** 32 CSPRNG bytes → base64url, 256 bits of entropy. */
export function generateSetupSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** 32 CSPRNG bytes → base64url, 256 bits of entropy. */
export function generateInvitationSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** 16 CSPRNG bytes → base64url, 128 bits of entropy. */
export function generateProofCode(): string {
  return randomBytes(16).toString("base64url");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashSetupSecret(secret: string): string {
  return sha256Hex(SETUP_DOMAIN + secret);
}

export function hashInvitationSecret(secret: string): string {
  return sha256Hex(INVITATION_DOMAIN + secret);
}

export function hashProofCode(code: string): string {
  return sha256Hex(CODE_DOMAIN + code);
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * A persisted digest is always a lowercase 64-character hex string. Anything
 * else (a malformed or absent column) is not a valid hash and must be treated
 * as an authority failure without echoing the offending value.
 */
export function isHashFormat(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

/**
 * Constant-time comparison of two persisted digests. Invalid or mismatched
 * formats return `false` without revealing which side failed.
 */
export function constantTimeHashEquals(a: unknown, b: unknown): boolean {
  if (!isHashFormat(a) || !isHashFormat(b)) {
    return false;
  }
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Opaque identifiers for users, grants and security events. */
export function newId(): string {
  return randomUUID();
}
