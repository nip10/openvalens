import { createHash, randomBytes } from "node:crypto";

/**
 * Personal API keys (Issue #439).
 *
 * A key is `ov_` followed by 43 base64url characters (32 random bytes). It is
 * shown once, at creation; only its SHA-256 is stored, so a database read never
 * yields a usable key. The short `ov_xxxxxx` prefix is kept in clear so the
 * member can tell keys apart in the list.
 *
 * SHA-256 (not a slow password hash) is right here: the key carries 256 bits
 * of entropy, so it cannot be guessed offline, and the hash must be cheap to
 * look up on every call. The lookup is by digest (a unique index), so no
 * secret is ever compared in application code.
 */

export const PERSONAL_KEY_PREFIX = "ov_";
const SECRET_BYTES = 32;
/** `ov_` + 43 base64url characters. */
const KEY_PATTERN = /^ov_[A-Za-z0-9_-]{43}$/;
/** Characters of the key kept in clear for display (`ov_` + 6). */
const DISPLAY_PREFIX_LENGTH = PERSONAL_KEY_PREFIX.length + 6;

/** Expiry choices offered when a key is created; `null` is "never". */
export const PERSONAL_KEY_EXPIRY_DAYS = [30, 90, 365, null] as const;
export type PersonalKeyExpiryDays = (typeof PERSONAL_KEY_EXPIRY_DAYS)[number];
export const DEFAULT_PERSONAL_KEY_EXPIRY_DAYS: PersonalKeyExpiryDays = 90;

/** Most active personal keys one member may hold across all workspaces. */
export const MAX_ACTIVE_PERSONAL_KEYS = 10;

export type GeneratedPersonalKey = {
  /** The full key. Return it to the member once; never store or log it. */
  key: string;
  /** SHA-256 hex digest, the only form that is stored. */
  hash: string;
  /** `ov_` plus the first six secret characters, for display. */
  displayPrefix: string;
};

export function hashPersonalKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generatePersonalKey(
  random: (size: number) => Buffer = randomBytes,
): GeneratedPersonalKey {
  const key = `${PERSONAL_KEY_PREFIX}${random(SECRET_BYTES).toString("base64url")}`;
  return { key, hash: hashPersonalKey(key), displayPrefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/** Whether a bearer value has the personal-key shape (it may still be unknown). */
export function isPersonalKeyFormat(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * Extracts the bearer value from an `Authorization` header. Only the `Bearer`
 * scheme is accepted; anything else (a cookie session, Basic auth) yields
 * `null`.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

export function expiryFrom(now: Date, days: PersonalKeyExpiryDays): Date | null {
  return days === null ? null : new Date(now.getTime() + days * 86_400_000);
}
