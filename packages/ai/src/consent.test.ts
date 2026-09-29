import { describe, expect, test } from "bun:test";
import type { Database } from "@openhealth/db";

import { AiConsentError, parseAiConsent, readAiConsent, requireAiConsent } from "./consent";

/** Minimal Drizzle-shaped fake: `select().from().where().limit()`. */
function dbWithMetadata(metadata: unknown): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ metadata }],
        }),
      }),
    }),
  } as unknown as Database;
}

describe("parseAiConsent", () => {
  test("defaults to disabled when the key is absent", () => {
    expect(parseAiConsent(undefined)).toEqual({ enabled: false, scope: null });
    expect(parseAiConsent({})).toEqual({ enabled: false, scope: null });
    expect(parseAiConsent({ aiConsent: "nope" })).toEqual({ enabled: false, scope: null });
  });

  test("reads boolean and scoped-object forms", () => {
    expect(parseAiConsent({ aiConsent: true })).toEqual({ enabled: true, scope: "full" });
    expect(parseAiConsent({ aiConsent: false })).toEqual({ enabled: false, scope: null });
    expect(parseAiConsent({ aiConsent: { enabled: true, scope: "chat" } })).toEqual({
      enabled: true,
      scope: "chat",
    });
    expect(parseAiConsent({ aiConsent: "insights" })).toEqual({ enabled: true, scope: "insights" });
  });
});

describe("readAiConsent", () => {
  test("returns disabled when metadata has no consent key", async () => {
    expect(await readAiConsent(dbWithMetadata({}), "org-1")).toEqual({
      enabled: false,
      scope: null,
    });
  });

  test("returns the explicit scope when consent is granted", async () => {
    const db = dbWithMetadata({ aiConsent: { enabled: true, scope: "chat" } });
    expect(await readAiConsent(db, "org-1")).toEqual({ enabled: true, scope: "chat" });
  });
});

describe("requireAiConsent", () => {
  test("throws AI_DISABLED when consent is disabled", async () => {
    const db = dbWithMetadata({});

    await expect(requireAiConsent(db, "org-1", "chat")).rejects.toThrow(AiConsentError);

    try {
      await requireAiConsent(db, "org-1", "chat");
    } catch (error) {
      expect((error as AiConsentError).code).toBe("AI_DISABLED");
    }
  });

  test("allows a narrower requirement when a broader scope is granted", async () => {
    const db = dbWithMetadata({ aiConsent: { enabled: true, scope: "full" } });
    await expect(requireAiConsent(db, "org-1", "chat")).resolves.toEqual({
      enabled: true,
      scope: "full",
    });
  });

  test("rejects a broader requirement when only chat is granted", async () => {
    const db = dbWithMetadata({ aiConsent: { enabled: true, scope: "chat" } });
    await expect(requireAiConsent(db, "org-1", "full")).rejects.toThrow(AiConsentError);
  });
});
