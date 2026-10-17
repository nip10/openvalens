import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Wearable OAuth tokens at rest (Issue #60).
 *
 * AES-256-GCM with a key derived from (never equal to) `BETTER_AUTH_SECRET`,
 * like the storage signing and insight unsubscribe keys. Every ciphertext is
 * bound to its workspace, connection and field through the GCM associated
 * data, so a ciphertext copied into another row or workspace fails to open.
 *
 * Rotating `BETTER_AUTH_SECRET` makes stored tokens unreadable: connections
 * then show "reconnect needed" and keep their data and sync cursor.
 */

const VERSION = "v1";
const KEY_LABEL = "openvalens:wearable-tokens:v1";

export type TokenField = "access_token" | "refresh_token";

export class WearableTokenUnreadableError extends Error {
  constructor() {
    super("Stored wearable token could not be decrypted.");
    this.name = "WearableTokenUnreadableError";
  }
}

export function deriveWearableTokenKey(serverSecret: string): Buffer {
  if (serverSecret.length < 32) throw new TypeError("Wearable token secret is too short.");
  return createHmac("sha256", serverSecret).update(KEY_LABEL).digest();
}

function associatedData(organizationId: string, providerConnectionId: number, field: TokenField) {
  return Buffer.from(`wearable_connection\n${organizationId}\n${providerConnectionId}\n${field}`);
}

export function sealToken(
  key: Buffer,
  plaintext: string,
  binding: { organizationId: string; providerConnectionId: number; field: TokenField },
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(
    associatedData(binding.organizationId, binding.providerConnectionId, binding.field),
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function openToken(
  key: Buffer,
  sealed: string,
  binding: { organizationId: string; providerConnectionId: number; field: TokenField },
): string {
  const [version, iv, ciphertext, tag, extra] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag || extra !== undefined)
    throw new WearableTokenUnreadableError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(
      associatedData(binding.organizationId, binding.providerConnectionId, binding.field),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new WearableTokenUnreadableError();
  }
}
