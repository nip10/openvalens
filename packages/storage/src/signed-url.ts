/**
 * HMAC-signed download route for local-disk storage (Issue #62).
 *
 * S3 objects are downloaded through native presigned URLs. Local disk has no
 * such thing, so the server mints an equivalent: a path that names the object
 * id plus an expiry and an HMAC-SHA256 signature over both. The route serves
 * the object only while the signature is valid and unexpired; a forged,
 * altered or expired URL is rejected without touching the database.
 *
 * The signing key is derived from `BETTER_AUTH_SECRET` with a fixed label, so
 * there is no extra secret to manage; rotating that secret invalidates every
 * outstanding URL (they are minutes-long anyway).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { isObjectId } from "./keys";

export const LOCAL_DOWNLOAD_PATH_PREFIX = "/api/storage/objects/";

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_LABEL = "openvalens:storage-signed-url:v1";

/** Derives the URL-signing key from the server's auth secret. */
export function deriveStorageSigningKey(serverSecret: string): Buffer {
  if (serverSecret.length < 32) throw new TypeError("Storage signing secret is too short.");
  return createHmac("sha256", serverSecret).update(KEY_LABEL).digest();
}

function sign(key: Buffer, objectId: string, expiresAt: number): string {
  return createHmac("sha256", key).update(`v1\n${objectId}\n${expiresAt}`).digest("base64url");
}

/** Relative signed path, e.g. `/api/storage/objects/<id>?e=1700000000&s=…`. */
export function createLocalSignedPath(
  key: Buffer,
  objectId: string,
  expiresInSeconds: number,
  now: Date = new Date(),
): string {
  if (!isObjectId(objectId)) throw new TypeError("Invalid object id.");
  const expiresAt = Math.floor(now.getTime() / 1000) + expiresInSeconds;
  return `${LOCAL_DOWNLOAD_PATH_PREFIX}${objectId}?e=${expiresAt}&s=${sign(key, objectId, expiresAt)}`;
}

export type SignedPathVerdict =
  | { ok: true; objectId: string }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" };

/** Verifies a signed path produced by {@link createLocalSignedPath}. */
export function verifyLocalSignedPath(
  key: Buffer,
  url: URL,
  now: Date = new Date(),
): SignedPathVerdict {
  if (!url.pathname.startsWith(LOCAL_DOWNLOAD_PATH_PREFIX))
    return { ok: false, reason: "malformed" };
  const objectId = url.pathname.slice(LOCAL_DOWNLOAD_PATH_PREFIX.length);
  const expiresRaw = url.searchParams.get("e") ?? "";
  const signature = url.searchParams.get("s") ?? "";
  if (!isObjectId(objectId) || !/^\d{1,12}$/.test(expiresRaw) || !SIGNATURE_PATTERN.test(signature))
    return { ok: false, reason: "malformed" };

  const expiresAt = Number(expiresRaw);
  const expected = Buffer.from(sign(key, objectId, expiresAt));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: "bad_signature" };
  if (expiresAt <= Math.floor(now.getTime() / 1000)) return { ok: false, reason: "expired" };
  return { ok: true, objectId };
}
