import { describe, expect, test } from "bun:test";
import { InMemoryRateLimiter } from "@openvalens/ai";
import type { Database } from "@openvalens/db";
import { z } from "zod";

import type { Context } from "../context";
import { instanceAdminProcedure } from "../index";
import { ProductSettingsError, type ProductSettingsService } from "../product-settings";
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
    telegram: { connectTokenTtlSeconds: 600 },
    telegramClient: null,
    aiConfig: {
      AI_PROVIDER: null,
      AI_API_KEY: null,
      AI_BASE_URL: null,
      AI_SUPPORTS_STRUCTURED_OUTPUTS: false,
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

describe("adminSettings.backupStatus (Issue #64)", () => {
  /** First query: the admin lookup; then the two backup status queries. */
  function backupDb(role: string) {
    const answers: unknown[][] = [
      [{ role, banned: false }],
      [{ ready: true }],
      [
        {
          last_backup: {
            backup_id: "20261025T030000Z-daily",
            trigger: "daily",
            size_bytes: 4096,
            finished_at: "2026-10-25T03:00:09+00:00",
          },
          last_verify: {
            backup_id: "20261025T030000Z-daily",
            outcome: "ok",
            finished_at: "2026-10-25T03:00:20+00:00",
          },
          last_failure: {
            operation: "backup",
            trigger: "pre-migrate",
            detail: "pg_dump",
            finished_at: "2026-10-20T10:00:00+00:00",
          },
          latest_backup_outcome: "ok",
          schedule: { next_run_at: "2099-01-01T03:00:00+00:00", hour_utc: 3, daily_retain: 14 },
        },
      ],
    ];
    return {
      execute: async () => ({ rows: answers.shift() ?? [] }),
    } as unknown as Database;
  }

  test("is for instance administrators only", async () => {
    await expect(
      appRouter.adminSettings.backupStatus.callable({ context: baseContext({ session: null }) })(
        {},
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(
      appRouter.adminSettings.backupStatus.callable({
        context: contextWith(ACTOR_SESSION, backupDb("user")),
      })({}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("returns the last backup, verify, failure step and next run", async () => {
    const result = await appRouter.adminSettings.backupStatus.callable({
      context: contextWith(ACTOR_SESSION, backupDb("admin")),
    })({});
    expect(result).toEqual({
      state: expect.any(String),
      lastBackup: {
        id: "20261025T030000Z-daily",
        trigger: "daily",
        sizeBytes: 4096,
        at: "2026-10-25T03:00:09.000Z",
      },
      lastVerify: { id: "20261025T030000Z-daily", outcome: "ok", at: "2026-10-25T03:00:20.000Z" },
      lastFailure: {
        operation: "backup",
        trigger: "pre-migrate",
        step: "pg_dump",
        at: "2026-10-20T10:00:00.000Z",
      },
      schedule: { nextRunAt: "2099-01-01T03:00:00.000Z", hourUtc: 3, dailyRetain: 14 },
      offsite: { state: "off", lastUpload: null, lastFailure: null },
    });
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

// ─── Issue #58 product settings (partial service DI) ───────────

const ORIGIN = "https://app.test";

function headersWithOrigin(origin?: string): Headers {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return headers;
}

function fakeService(overrides: Partial<ProductSettingsService> = {}): ProductSettingsService {
  return {
    read: async () => ({ units: "metric", locale: "en-US", revision: 0, canEdit: false }),
    update: async () => ({ units: "imperial", locale: "en-GB", revision: 1, canEdit: true }),
    ...overrides,
  };
}

type WriteOptions = {
  origin?: string;
  admissionOrigin?: string;
  service?: ProductSettingsService;
};

/** Builds a context for the write path; an explicit `undefined` omits a binding. */
function writeContext(session: unknown, db: Database, options: WriteOptions = {}): Context {
  return baseContext({
    session,
    db,
    admissionOrigin: "admissionOrigin" in options ? options.admissionOrigin : ORIGIN,
    productSettingsService: "service" in options ? options.service : fakeService(),
    honoContext: { req: { raw: { headers: headersWithOrigin(options.origin) } } },
  });
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("adminSettings.productSettings (read)", () => {
  test("anonymous callers are rejected with 401 UNAUTHENTICATED", async () => {
    await expect(
      appRouter.adminSettings.productSettings.callable({
        context: baseContext({ session: null, productSettingsService: fakeService() }),
      })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  test("returns a projected four-field snapshot with canEdit false for a non-admin", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    const result = await appRouter.adminSettings.productSettings.callable({
      context: contextWith(ACTOR_SESSION, db, {
        productSettingsService: fakeService({
          read: async () => ({ units: "imperial", locale: "en-GB", revision: 2, canEdit: false }),
        }),
      }),
    })({});

    expect(result).toEqual({ units: "imperial", locale: "en-GB", revision: 2, canEdit: false });
    expect(Object.keys(result).sort()).toEqual(["canEdit", "locale", "revision", "units"]);
  });

  test("resolves canEdit fresh on every request (no caching)", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    let calls = 0;
    const service = fakeService({
      read: async () => {
        calls += 1;
        return { units: "metric", locale: "en-US", revision: 0, canEdit: calls > 1 };
      },
    });
    const context = contextWith(ACTOR_SESSION, db, { productSettingsService: service });

    expect((await appRouter.adminSettings.productSettings.callable({ context })({})).canEdit).toBe(
      false,
    );
    expect((await appRouter.adminSettings.productSettings.callable({ context })({})).canEdit).toBe(
      true,
    );
  });

  test("drops any extra field a service returns (projection, not passthrough)", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const dirty = fakeService({
      read: async () =>
        ({ units: "metric", locale: "en-US", revision: 0, canEdit: true, raw: "leak" }) as never,
    });
    const result = await appRouter.adminSettings.productSettings.callable({
      context: contextWith(ACTOR_SESSION, db, { productSettingsService: dirty }),
    })({});

    expect(result).toEqual({ units: "metric", locale: "en-US", revision: 0, canEdit: true });
    expect(result).not.toHaveProperty("raw");
  });

  test("fails closed with a generic INTERNAL when the service is not bound", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const caught = await capture(
      appRouter.adminSettings.productSettings.callable({
        context: contextWith(ACTOR_SESSION, db),
      })({}),
    );

    expect(caught).toMatchObject({
      code: "INTERNAL",
      status: 500,
      message: "Something went wrong.",
    });
    expect((caught as { data?: unknown }).data).toBeUndefined();
  });

  test("maps an unexpected service failure to a generic INTERNAL with no raw cause", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    const service = fakeService({
      read: async () => {
        throw new Error("canary-secret-dsn-value");
      },
    });
    const caught = await capture(
      appRouter.adminSettings.productSettings.callable({
        context: contextWith(ACTOR_SESSION, db, { productSettingsService: service }),
      })({}),
    );

    expect(caught).toMatchObject({
      code: "INTERNAL",
      status: 500,
      message: "Something went wrong.",
    });
    expect(String(caught)).not.toContain("canary-secret-dsn-value");
  });
});

describe("adminSettings.updateProductSettings (write)", () => {
  const VALID = { units: "imperial", locale: "en-GB", expectedRevision: 0 } as const;

  test("anonymous callers are rejected with 401 UNAUTHENTICATED", async () => {
    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(null, {} as Database, { origin: ORIGIN }),
      })(VALID),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  test("rejects an ordinary user with 403 before the service runs", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    let calls = 0;
    const service = fakeService({
      update: async () => {
        calls += 1;
        return { units: "imperial", locale: "en-GB", revision: 1, canEdit: true };
      },
    });

    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(ACTOR_SESSION, db, { origin: ORIGIN, service }),
      })(VALID),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(calls).toBe(0);
  });

  test("rejects a stale session admin claim when the database says user", async () => {
    const { db } = fakeDb([{ role: "user", banned: false }]);
    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(STALE_ADMIN_SESSION, db, { origin: ORIGIN }),
      })(VALID),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("denies a missing, null or foreign Origin before the service runs", async () => {
    for (const origin of [undefined, "null", "https://evil.test"]) {
      const { db } = fakeDb([{ role: "admin", banned: false }]);
      let calls = 0;
      const service = fakeService({
        update: async () => {
          calls += 1;
          return { units: "imperial", locale: "en-GB", revision: 1, canEdit: true };
        },
      });

      await expect(
        appRouter.adminSettings.updateProductSettings.callable({
          context: writeContext(ACTOR_SESSION, db, { origin, service }),
        })(VALID),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
      expect(calls).toBe(0);
    }
  });

  test("fails closed with INTERNAL when the origin binding is missing", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(ACTOR_SESSION, db, { origin: ORIGIN, admissionOrigin: undefined }),
      })(VALID),
    ).rejects.toMatchObject({ code: "INTERNAL", status: 500 });
  });

  test("rejects unsupported values, unknown/secret keys and revisions as value-free INVALID_INPUT", async () => {
    const cases: unknown[] = [
      { units: "us", locale: "en-US", expectedRevision: 0 },
      { units: "metric", locale: "fr-FR", expectedRevision: 0 },
      { units: "metric", locale: "en-US", expectedRevision: -1 },
      { units: "metric", locale: "en-US", expectedRevision: 1.5 },
      { units: "metric", locale: "en-US", expectedRevision: 0, secretCanary: "CANARY_LEAK_9f3a" },
      JSON.parse(
        '{"units":"metric","locale":"en-US","expectedRevision":0,"__proto__":{"polluted":true}}',
      ),
    ];

    for (const input of cases) {
      const { db } = fakeDb([{ role: "admin", banned: false }]);
      const caught = await capture(
        appRouter.adminSettings.updateProductSettings.callable({
          context: writeContext(ACTOR_SESSION, db, { origin: ORIGIN }),
        })(input as never),
      );

      expect(caught).toMatchObject({ code: "INVALID_INPUT", status: 400 });
      expect((caught as { data?: unknown }).data).toBeUndefined();
      expect(String(caught)).not.toContain("CANARY_LEAK");
    }
  });

  test("maps a service CONFLICT to 409 and DENIED to 403", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);

    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(ACTOR_SESSION, db, {
          origin: ORIGIN,
          service: fakeService({
            update: async () => {
              throw new ProductSettingsError("CONFLICT");
            },
          }),
        }),
      })(VALID),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(ACTOR_SESSION, db, {
          origin: ORIGIN,
          service: fakeService({
            update: async () => {
              throw new ProductSettingsError("DENIED");
            },
          }),
        }),
      })(VALID),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("fails closed with INTERNAL when the service is not bound", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    await expect(
      appRouter.adminSettings.updateProductSettings.callable({
        context: writeContext(ACTOR_SESSION, db, { origin: ORIGIN, service: undefined }),
      })(VALID),
    ).rejects.toMatchObject({ code: "INTERNAL", status: 500 });
  });

  test("returns a projected snapshot on success and drops extra service fields", async () => {
    const { db } = fakeDb([{ role: "admin", banned: false }]);
    const dirty = fakeService({
      update: async () =>
        ({
          units: "imperial",
          locale: "en-GB",
          revision: 1,
          canEdit: true,
          raw: "leak",
        }) as never,
    });
    const result = await appRouter.adminSettings.updateProductSettings.callable({
      context: writeContext(ACTOR_SESSION, db, { origin: ORIGIN, service: dirty }),
    })(VALID);

    expect(result).toEqual({ units: "imperial", locale: "en-GB", revision: 1, canEdit: true });
    expect(result).not.toHaveProperty("raw");
  });
});
