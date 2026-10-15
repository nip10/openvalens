import { describe, expect, test } from "bun:test";

import { newObjectId } from "./keys";
import {
  createLocalSignedPath,
  deriveStorageSigningKey,
  LOCAL_DOWNLOAD_PATH_PREFIX,
  verifyLocalSignedPath,
} from "./signed-url";

const KEY = deriveStorageSigningKey("synthetic-server-secret-at-least-32-chars");
const OTHER_KEY = deriveStorageSigningKey("another-synthetic-secret-at-least-32-chars");
const NOW = new Date("2026-10-15T12:00:00Z");
const base = "https://health.example.test";

describe("local signed download paths", () => {
  test("a fresh path verifies", () => {
    const id = newObjectId();
    const path = createLocalSignedPath(KEY, id, 300, NOW);
    expect(path.startsWith(`${LOCAL_DOWNLOAD_PATH_PREFIX}${id}?e=`)).toBe(true);
    expect(verifyLocalSignedPath(KEY, new URL(path, base), NOW)).toEqual({
      ok: true,
      objectId: id,
    });
  });

  test("an expired path is rejected", () => {
    const path = createLocalSignedPath(KEY, newObjectId(), 300, NOW);
    const later = new Date(NOW.getTime() + 301_000);
    expect(verifyLocalSignedPath(KEY, new URL(path, base), later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("forged, altered or foreign-key signatures are rejected", () => {
    const id = newObjectId();
    const url = new URL(createLocalSignedPath(KEY, id, 300, NOW), base);

    const otherObject = new URL(url);
    otherObject.pathname = `${LOCAL_DOWNLOAD_PATH_PREFIX}${newObjectId()}`;
    expect(verifyLocalSignedPath(KEY, otherObject, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });

    const extended = new URL(url);
    extended.searchParams.set("e", String(Number(url.searchParams.get("e")) + 3600));
    expect(verifyLocalSignedPath(KEY, extended, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });

    expect(verifyLocalSignedPath(OTHER_KEY, url, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });

    const forged = new URL(url);
    forged.searchParams.set("s", "A".repeat(43));
    expect(verifyLocalSignedPath(KEY, forged, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("malformed paths are rejected", () => {
    for (const path of [
      `${LOCAL_DOWNLOAD_PATH_PREFIX}not-an-id?e=1&s=${"A".repeat(43)}`,
      `${LOCAL_DOWNLOAD_PATH_PREFIX}${newObjectId()}`,
      `${LOCAL_DOWNLOAD_PATH_PREFIX}${newObjectId()}?e=abc&s=${"A".repeat(43)}`,
      `/elsewhere/${newObjectId()}?e=1&s=${"A".repeat(43)}`,
    ]) {
      expect(verifyLocalSignedPath(KEY, new URL(path, base), NOW)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  test("the signing key needs a real secret", () => {
    expect(() => deriveStorageSigningKey("short")).toThrow();
  });
});
