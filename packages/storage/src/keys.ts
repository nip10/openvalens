/**
 * Object key builder (Issue #62).
 *
 * Keys carry no PHI: they are `org/<organization id>/<object id>`, where the
 * organization id is the opaque tenant id and the object id is a random UUID.
 * Never a filename, metric name, purpose, date or user-supplied text — so a
 * bucket listing, access log or backup manifest reveals nothing about the
 * person. `keys.test.ts` pins this grammar.
 */

import { randomUUID } from "node:crypto";

import { isValidStorageKey } from "./object-storage";

const ORGANIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBJECT_KEY = /^org\/([A-Za-z0-9_-]{1,128})\/([0-9a-f-]{36})$/;

/** Reserved prefix for the readiness write probe; never a tenant object. */
export const READINESS_PROBE_KEY = "_system/readiness-probe";

export function newObjectId(): string {
  return randomUUID();
}

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID.test(value);
}

export function buildObjectKey(organizationId: string, objectId: string): string {
  if (!ORGANIZATION_ID.test(organizationId)) throw new TypeError("Invalid organization id.");
  if (!isObjectId(objectId)) throw new TypeError("Invalid object id.");
  const key = `org/${organizationId}/${objectId}`;
  if (!isValidStorageKey(key)) throw new TypeError("Invalid object key.");
  return key;
}

/** Inverse of {@link buildObjectKey}, or `null` for any other shape. */
export function parseObjectKey(key: string): { organizationId: string; objectId: string } | null {
  const match = OBJECT_KEY.exec(key);
  if (!match || !isObjectId(match[2])) return null;
  return { organizationId: match[1]!, objectId: match[2]! };
}
