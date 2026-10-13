import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Database } from "@openvalens/db";
import { z } from "zod";

import type { Context } from "../context";
import { instanceAdminProcedure } from "../index";
import { appRouter } from "./index";

type Row = { role: string | null; banned: boolean | null };

/**
 * Minimal `Database` stub: `execute()` captures the query and returns the next
 * queued rows (or throws a queued error). No SQL, no network.
 */
function fakeDb(source: Row[] | (() => Row[]) | Error): { db: Database; queries: unknown[] } {
  const queries: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      queries.push(query);
      if (source instanceof Error) {
        throw source;
      }
      return { rows: typeof source === "function" ? source() : source };
    },
  } as unknown as Database;
  return { db, queries };
}

function baseContext(overrides: Record<string, unknown> = {}): Context {
  return {
    session: { user: { id: "actor-1", email: "actor@example.com", name: null } },
    db: {} as Database,
    correlationId: "corr-1",
    cronSecret: "test-cron-secret-long-enough",
    betterAuthSecretConfigured: true,
    capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
    telegram: { webhookSecret: "test-webhook-secret-1234", connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      ANTHROPIC_API_KEY: null,
      AI_MODEL: "claude-sonnet-5-5",
      AI_RATE_LIMIT_PER_MINUTE: 20,
    },
    aiRateLimiter: new InMemoryRateLimiter({ limitPerMinute: 20 }),
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  } as unknown as Context;
}

function contextWith(
  session: unknown,
  db: Database,
  overrides: Record<string, unknown> = {},
): Context {
  return baseContext({ session, db, ...overrides });
}

const ACTOR_SESSION = {
  user: { id: "actor-1", email: "actor@example.com", name: null },
  session: { id: "s-1", userId: "actor-1", activeOrganizationId: null, expiresAt: null },
};

describe("adminSettings.access", () => {
  test("anonymous callers are rejected with 401 UNAUTHENTICATED", async () => {
    await expect(
      appRouter.adminSettings.access.callable({ context: baseContext({ session: null }) })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  test("an ordinary authenticated user gets false, not an error", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    const result = await appRouter.adminSettings.access.callable({
      context: contextWith(ACTOR_SESSION, db),
    })({});

    expect(result).toEqual({ isInstanceAdmin: false });
    // The response never carries the user id, email or role string.
    expect(Object.keys(result)).toEqual(["isInstanceAdmin"]);
  });

  test("a global admin with no active organization gets true", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const result = await appRouter.adminSettings.access.callable({
      context: contextWith(ACTOR_SESSION, db),
    })({});

    expect(result).toEqual({ isInstanceAdmin: true });
  });

  test("ignores a stale session role claim and trusts the fresh database lookup", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    const staleSession = {
      user: { id: "actor-1", email: "actor@example.com", name: null, role: "admin" },
      session: { id: "s-1", userId: "actor-1", activeOrganizationId: null, expiresAt: null },
    };

    const result = await appRouter.adminSettings.access.callable({
      context: contextWith(staleSession, db),
    })({});

    expect(result).toEqual({ isInstanceAdmin: false });
  });

  test("reflects a demotion/ban on the next request", async () => {
    let rows: Row[] = [{ role: "admin", banned: false }];
    const { db } = fakeDb(() => rows);
    const context = contextWith(ACTOR_SESSION, db);

    expect(await appRouter.adminSettings.access.callable({ context })({})).toEqual({
      isInstanceAdmin: true,
    });

    rows = [{ role: "user", banned: false }];
    expect(await appRouter.adminSettings.access.callable({ context })({})).toEqual({
      isInstanceAdmin: false,
    });

    rows = [{ role: "admin", banned: true }];
    expect(await appRouter.adminSettings.access.callable({ context })({})).toEqual({
      isInstanceAdmin: false,
    });
  });

  test("maps a database failure to a generic INTERNAL error with no raw cause", async () => {
    const { db } = fakeDb(new Error("canary-secret-dsn-value"));
    let caught: unknown;
    try {
      await appRouter.adminSettings.access.callable({ context: contextWith(ACTOR_SESSION, db) })(
        {},
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "INTERNAL",
      status: 500,
      message: "Something went wrong.",
    });
    expect((caught as { data?: unknown }).data).toBeUndefined();
    expect(String(caught)).not.toContain("canary-secret-dsn-value");
  });
});

describe("adminSettings.configuration", () => {
  const INVENTORY = [
    { key: "BETTER_AUTH_SECRET", configured: true, sensitive: true },
    { key: "AI_MODEL", configured: false, sensitive: false },
  ];

  test("anonymous callers are rejected with 401 UNAUTHENTICATED", async () => {
    await expect(
      appRouter.adminSettings.configuration.callable({
        context: baseContext({ session: null }),
      })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  test("an ordinary authenticated user is rejected with 403 PERMISSION_DENIED", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    await expect(
      appRouter.adminSettings.configuration.callable({
        context: contextWith(ACTOR_SESSION, db, { adminConfigInventory: INVENTORY }),
      })({}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("never touches the inventory for a non-admin (access trap)", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    let touches = 0;
    // The inventory is a trap: any read (iteration, indexing, `.map`) throws.
    // oRPC copies the context by spreading own enumerable properties, which
    // copies this reference without invoking the trap, so a handler that read
    // the inventory before the guard would be caught here.
    const trappedInventory = new Proxy([] as unknown[], {
      get() {
        touches += 1;
        throw new Error("inventory must not be read for a non-admin");
      },
    });
    const context = contextWith(ACTOR_SESSION, db, { adminConfigInventory: trappedInventory });

    await expect(
      appRouter.adminSettings.configuration.callable({ context })({}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(touches).toBe(0);
  });

  test("returns the projected inventory for an instance admin", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const result = await appRouter.adminSettings.configuration.callable({
      context: contextWith(ACTOR_SESSION, db, { adminConfigInventory: INVENTORY }),
    })({});

    expect(result).toEqual({ entries: INVENTORY });
  });

  test("projects only key/configured/sensitive and ignores extra entry fields", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const dirty = [
      {
        key: "DATABASE_URL",
        configured: true,
        sensitive: true,
        raw: "postgres://secret",
        value: 42,
      },
    ];
    const result = await appRouter.adminSettings.configuration.callable({
      context: contextWith(ACTOR_SESSION, db, { adminConfigInventory: dirty }),
    })({});

    expect(result.entries).toEqual([{ key: "DATABASE_URL", configured: true, sensitive: true }]);
    expect(result.entries[0]).not.toHaveProperty("raw");
    expect(result.entries[0]).not.toHaveProperty("value");
  });

  test("fails closed with a generic INTERNAL error when the inventory is missing", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    let caught: unknown;
    try {
      await appRouter.adminSettings.configuration.callable({
        context: contextWith(ACTOR_SESSION, db),
      })({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "INTERNAL",
      status: 500,
      message: "Something went wrong.",
    });
    expect((caught as { data?: unknown }).data).toBeUndefined();
  });
});

const STALE_ADMIN_SESSION = {
  user: { id: "actor-1", email: "actor@example.com", name: null, role: "admin" },
  session: { id: "s-1", userId: "actor-1", activeOrganizationId: null, expiresAt: null },
};

/** Synthetic privileged endpoint built on the default-deny procedure. */
const privilegedProbe = instanceAdminProcedure
  .input(z.object({}))
  .output(z.object({ reached: z.boolean() }))
  .handler(() => ({ reached: true }));

/** Synthetic endpoint that reads the inventory inside its handler. */
const inventoryProbe = instanceAdminProcedure
  .input(z.object({}))
  .output(z.object({ count: z.number() }))
  .handler(({ context }) => ({ count: (context.adminConfigInventory ?? []).length }));

describe("instanceAdminProcedure (default-deny)", () => {
  test("rejects an ordinary workspace owner with 403 and no manual check", async () => {
    const { db } = fakeDb([{ role: "owner", banned: false }]);
    await expect(
      privilegedProbe.callable({ context: contextWith(ACTOR_SESSION, db) })({}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("rejects a stale session admin claim when the database says user", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    await expect(
      privilegedProbe.callable({ context: contextWith(STALE_ADMIN_SESSION, db) })({}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("allows a global admin with no active organization", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    expect(await privilegedProbe.callable({ context: contextWith(ACTOR_SESSION, db) })({})).toEqual(
      {
        reached: true,
      },
    );
  });

  test("maps a database failure to a generic INTERNAL error", async () => {
    const { db } = fakeDb(new Error("canary-secret-value"));
    let caught: unknown;
    try {
      await privilegedProbe.callable({ context: contextWith(ACTOR_SESSION, db) })({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "INTERNAL",
      status: 500,
      message: "Something went wrong.",
    });
    expect((caught as { data?: unknown }).data).toBeUndefined();
  });

  test("never reads the inventory for a non-admin (default-deny runs first)", async () => {
    const { db } = fakeDb([{ role: "owner", banned: false }]);
    let touches = 0;
    const trappedInventory = new Proxy([] as unknown[], {
      get() {
        touches += 1;
        throw new Error("inventory must not be read for a non-admin");
      },
    });
    const context = contextWith(ACTOR_SESSION, db, { adminConfigInventory: trappedInventory });

    await expect(inventoryProbe.callable({ context })({})).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    });
    expect(touches).toBe(0);
  });

  test("lets an admin read the inventory through the privileged procedure", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const context = contextWith(ACTOR_SESSION, db, {
      adminConfigInventory: [{ key: "NODE_ENV", configured: true, sensitive: false }],
    });
    expect(await inventoryProbe.callable({ context })({})).toEqual({ count: 1 });
  });
});
