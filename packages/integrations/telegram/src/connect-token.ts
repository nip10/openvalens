import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

/**
 * Telegram connect-token issuance + verification (Issue #14).
 *
 * A connect token is a short-lived, HMAC-signed payload bound to a user + an
 * organization. It is used to bind a Telegram chat id to an organization via a
 * deep link: the future web UI (Phase 5) calls `telegram.issueConnectToken`,
 * renders `https://t.me/<bot>?start=<token>`, and the webhook binds the chat
 * once the user sends `/start <token>`.
 *
 * Token format: `<payloadB64>.<hmacB64>` where both parts are base64url and the
 * HMAC is `HMAC-SHA256(secret, payloadB64)`. Verification is constant-time.
 */

export type TelegramConnectTokenPayload = {
  userId: string;
  organizationId: string;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
};

export type IssueConnectTokenInput = {
  userId: string;
  organizationId: string;
  expiresInSeconds: number;
  /** Injectable clock for tests; defaults to `new Date()`. */
  now?: Date;
};

export type TelegramConnectTokenErrorCode = "CONNECT_TOKEN_INVALID" | "CONNECT_TOKEN_EXPIRED";

export class TelegramConnectTokenError extends Error {
  readonly code: TelegramConnectTokenErrorCode;

  constructor(code: TelegramConnectTokenErrorCode, message: string) {
    super(message);
    this.name = "TelegramConnectTokenError";
    this.code = code;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payloadB64: string, secret: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return new Uint8Array(signature);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parsePayload(value: string): TelegramConnectTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TelegramConnectTokenError(
      "CONNECT_TOKEN_INVALID",
      "Connect token payload is invalid.",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new TelegramConnectTokenError(
      "CONNECT_TOKEN_INVALID",
      "Connect token payload is invalid.",
    );
  }

  const candidate = parsed as {
    userId?: unknown;
    organizationId?: unknown;
    expiresAt?: unknown;
  };

  if (
    typeof candidate.userId !== "string" ||
    candidate.userId.length === 0 ||
    typeof candidate.organizationId !== "string" ||
    candidate.organizationId.length === 0 ||
    typeof candidate.expiresAt !== "string"
  ) {
    throw new TelegramConnectTokenError(
      "CONNECT_TOKEN_INVALID",
      "Connect token payload is invalid.",
    );
  }

  return {
    userId: candidate.userId,
    organizationId: candidate.organizationId,
    expiresAt: candidate.expiresAt,
  };
}

/**
 * Issues a signed connect token. Returns the token plus its ISO expiry so the
 * caller can render a deep link with an accurate countdown.
 *
 * @throws {TelegramConnectTokenError} `CONNECT_TOKEN_INVALID` when the input is
 * malformed (never echoes the user/org values).
 */
export async function issueConnectToken(
  input: IssueConnectTokenInput,
  secret: string,
): Promise<{ token: string; expiresAt: string }> {
  if (!secret) {
    throw new TelegramConnectTokenError(
      "CONNECT_TOKEN_INVALID",
      "Connect token secret is not configured.",
    );
  }

  if (
    typeof input.userId !== "string" ||
    input.userId.length === 0 ||
    typeof input.organizationId !== "string" ||
    input.organizationId.length === 0
  ) {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_INVALID", "Connect token input is invalid.");
  }

  if (!Number.isFinite(input.expiresInSeconds)) {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_INVALID", "Connect token TTL is invalid.");
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString();
  const payload: TelegramConnectTokenPayload = {
    userId: input.userId,
    organizationId: input.organizationId,
    expiresAt,
  };

  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(payloadB64, secret);

  return { token: `${payloadB64}.${toBase64Url(signature)}`, expiresAt };
}

/**
 * Verifies a connect token and returns its payload.
 *
 * @throws {TelegramConnectTokenError} `CONNECT_TOKEN_INVALID` when the token is
 * malformed or the signature does not match, `CONNECT_TOKEN_EXPIRED` when the
 * payload is well-formed but past its expiry.
 */
export async function verifyConnectToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<TelegramConnectTokenPayload> {
  if (!secret) {
    throw new TelegramConnectTokenError(
      "CONNECT_TOKEN_INVALID",
      "Connect token secret is not configured.",
    );
  }

  if (typeof token !== "string") {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_INVALID", "Connect token is invalid.");
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_INVALID", "Connect token is invalid.");
  }

  const [payloadB64, signatureB64] = parts as [string, string];

  let providedSignature: Uint8Array;
  try {
    providedSignature = fromBase64Url(signatureB64);
  } catch {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_INVALID", "Connect token is invalid.");
  }

  const expectedSignature = await sign(payloadB64, secret);
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    throw new TelegramConnectTokenError(
      "CONNECT_TOKEN_INVALID",
      "Connect token signature is invalid.",
    );
  }

  let decodedPayload: string;
  try {
    decodedPayload = Buffer.from(fromBase64Url(payloadB64)).toString("utf8");
  } catch {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_INVALID", "Connect token is invalid.");
  }

  const payload = parsePayload(decodedPayload);

  const expiresAtMs = Date.parse(payload.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new TelegramConnectTokenError("CONNECT_TOKEN_EXPIRED", "Connect token has expired.");
  }

  return payload;
}
