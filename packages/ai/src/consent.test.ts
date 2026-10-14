import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import { userAiConsent } from "@openvalens/db/schema/auth";

import {
  AiConsentError,
  CURRENT_CONSENT_VERSION,
  parseAiConsent,
  readAiConsent,
  readUserAiConsent,
  requireAiConsent,
  requireUserAiConsent,
} from "./consent";

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

type ConsentRow = {
  granted: boolean;
  grantedAt: Date;
  revokedAt: Date | null;
  consentVersion: string;
};

/**
 * Table-aware fake: returns `[{ metadata }]` for the organization table and the
 * supplied per-user consent row (or none) for `user_ai_consent`.
 */
function dbWithConsent(options: {
  metadata?: unknown;
  userConsent?: ConsentRow | null;
}): Database {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === userAiConsent) {
              return options.userConsent ? [options.userConsent] : [];
            }
            return [{ metadata: options.metadata }];
          },
        }),
      }),
    }),
  } as unknown as Database;
}

const GRANTED: ConsentRow = {
  granted: true,
  grantedAt: new Date("2026-01-01T00:00:00.000Z"),
  revokedAt: null,
  consentVersion: CURRENT_CONSENT_VERSION,
};

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

describe("readUserAiConsent", () => {
  test("returns null when the user has no consent row", async () => {
    const db = dbWithConsent({ userConsent: null });
    expect(await readUserAiConsent(db, "user-1")).toBeNull();
  });

  test("returns the parsed row with ISO-8601 timestamps", async () => {
    const db = dbWithConsent({ userConsent: GRANTED });
    expect(await readUserAiConsent(db, "user-1")).toEqual({
      granted: true,
      grantedAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
      consentVersion: "v1",
    });
  });

  test("serializes a revoked row's revokedAt as ISO", async () => {
    const db = dbWithConsent({
      userConsent: {
        granted: false,
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        revokedAt: new Date("2026-01-02T00:00:00.000Z"),
        consentVersion: "v1",
      },
    });
    expect(await readUserAiConsent(db, "user-1")).toEqual({
      granted: false,
      grantedAt: "2026-01-01T00:00:00.000Z",
      revokedAt: "2026-01-02T00:00:00.000Z",
      consentVersion: "v1",
    });
  });
});

describe("requireUserAiConsent", () => {
  test("throws AI_DISABLED when no row exists", async () => {
    const db = dbWithConsent({ userConsent: null });
    await expect(requireUserAiConsent(db, "user-1", "chat")).rejects.toThrow(AiConsentError);
  });

  test("throws AI_DISABLED when the row is revoked", async () => {
    const db = dbWithConsent({
      userConsent: {
        granted: false,
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        revokedAt: new Date("2026-01-02T00:00:00.000Z"),
        consentVersion: "v1",
      },
    });
    await expect(requireUserAiConsent(db, "user-1", "chat")).rejects.toThrow(AiConsentError);
  });

  test("throws AI_DISABLED when the disclosure version is outdated", async () => {
    const db = dbWithConsent({
      userConsent: { ...GRANTED, consentVersion: "v0" },
    });
    await expect(requireUserAiConsent(db, "user-1", "chat")).rejects.toThrow(AiConsentError);
  });

  test("resolves with the state when granted at the current version", async () => {
    const db = dbWithConsent({ userConsent: GRANTED });
    await expect(requireUserAiConsent(db, "user-1", "full")).resolves.toEqual({
      granted: true,
      grantedAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
      consentVersion: "v1",
    });
  });
});

describe("requireAiConsent per-user gate (Issue #123)", () => {
  test("fails when the org has consented but the user has not", async () => {
    const db = dbWithConsent({
      metadata: { aiConsent: { enabled: true, scope: "chat" } },
      userConsent: null,
    });
    await expect(requireAiConsent(db, "org-1", "chat", "user-1")).rejects.toThrow(AiConsentError);
  });

  test("passes when both the org and the user have consented", async () => {
    const db = dbWithConsent({
      metadata: { aiConsent: { enabled: true, scope: "chat" } },
      userConsent: GRANTED,
    });
    await expect(requireAiConsent(db, "org-1", "chat", "user-1")).resolves.toEqual({
      enabled: true,
      scope: "chat",
    });
  });

  test("skips the per-user gate when no userId is supplied (background calls)", async () => {
    const db = dbWithConsent({
      metadata: { aiConsent: { enabled: true, scope: "chat" } },
      userConsent: null,
    });
    await expect(requireAiConsent(db, "org-1", "chat")).resolves.toEqual({
      enabled: true,
      scope: "chat",
    });
  });
});
