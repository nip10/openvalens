import { createHash, timingSafeEqual } from "node:crypto";

/** Header Telegram uses to echo the `secret_token` configured via `setWebhook`. */
export const TELEGRAM_SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header against the expected
 * webhook secret (Issue #14).
 *
 * The comparison is constant-time and length-agnostic (both sides are hashed
 * before `timingSafeEqual`), so a mismatch never leaks the secret through
 * timing. Returns `false` for a missing header, an empty expected secret, or
 * any mismatch.
 */
export function verifyWebhookSecret(headers: Headers, expectedSecret: string): boolean {
  if (typeof expectedSecret !== "string" || expectedSecret.length === 0) {
    return false;
  }

  const received = headers.get(TELEGRAM_SECRET_TOKEN_HEADER);
  if (!received) {
    return false;
  }

  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expectedSecret).digest();

  return timingSafeEqual(receivedDigest, expectedDigest);
}
