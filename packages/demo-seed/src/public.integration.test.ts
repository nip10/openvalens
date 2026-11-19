import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createObjectStorage,
  createStorageService,
  parseStorageConfig,
  type StorageService,
} from "@openvalens/storage";
import { seedDemoPhotos } from "./photos";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuth, setRegisteredAuth, type CreateAuthOptions } from "@openvalens/auth";
import { isDemoUser } from "@openvalens/auth/demo";
import { findExistingAccount } from "@openvalens/auth/authz/existing-account";
import { createDb, sql } from "@openvalens/db";
import type { Context } from "@openvalens/api/context";
import { appRouter } from "@openvalens/api/routers/index";
import { RPCHandler } from "@orpc/server/fetch";

import { refreshPublicDemo } from "./public";
import { resetDemoDatabase } from "./reset";

const url = process.env.PUBLIC_DEMO_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/openvalens_demo_public_test"
  )
    throw new Error("Empty disposable loopback openvalens_demo_public_test database required.");
}

describe.skipIf(!url)("public demo lifecycle against PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/openvalens_demo_public_test" });
  const email = "public-demo@example.test";
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const input = { email, reviewEmail: "review@example.test", today, now };
  let deliveries = 0;
  const emailService: CreateAuthOptions["email"] = {
    organizationName: "OpenValens",
    prepareEmail: (value) => value,
    sendEmail: async () => {
      deliveries += 1;
      return { id: "synthetic", dryRun: false };
    },
  };
  const authOptions = {
    email: emailService,
    demoEmail: email,
    rateLimitEnabled: false,
  };
  const env = {
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "s".repeat(32),
    CORS_ORIGIN: "http://localhost:3001",
    NODE_ENV: "test",
  };
  const auth = createAuth(env, db, authOptions);
  let photoRoot: string;
  let storage: StorageService;
  let organizationId: string;
  let seededPhotoIds: string[];
  let cookie: string;
  let userId: string;

  async function request(path: string, body?: unknown, sessionCookie?: string, instance = auth) {
    return instance.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: env.CORS_ORIGIN,
          "content-type": "application/json",
          ...(sessionCookie ? { cookie: sessionCookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await resetDemoDatabase(db);
    photoRoot = await mkdtemp(join(tmpdir(), "openvalens-demo-photos-"));
    const config = parseStorageConfig({ STORAGE_LOCAL_DIR: photoRoot });
    storage = createStorageService({
      db,
      storage: createObjectStorage(config)!,
      maxObjectBytes: config.maxObjectBytes,
      signedUrlTtlSeconds: config.signedUrlTtlSeconds,
      signingKey: Buffer.alloc(32),
    });
  }, 120_000);
  afterAll(async () => {
    await db.$client.end();
    if (photoRoot) await rm(photoRoot, { recursive: true, force: true });
  });

  test("unprovisioned and disabled demos never create sessions or users", async () => {
    const before = (await db.execute(sql`select "id" from "user"`)).rows;
    expect((await request("/sign-in/demo", {})).status).toBe(404);
    const off = createAuth(env, db, { ...authOptions, demoEmail: null });
    expect((await request("/sign-in/demo", {}, undefined, off)).status).toBe(404);
    expect((await db.execute(sql`select "id" from "user"`)).rows).toEqual(before);
  });

  test("first provision creates only an isolated synthetic demo; sign-in needs no credentials", async () => {
    const result = await refreshPublicDemo(db, input);
    expect(result.status).toBe("seeded");
    userId = result.userId;
    organizationId = result.organizationId;
    expect(await isDemoUser(db, userId)).toBe(true);
    expect(await findExistingAccount(db, email)).toBeNull();
    const response = await request("/sign-in/demo", {});
    expect(response.status).toBe(200);
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(userId);
    expect(session?.session.activeOrganizationId).toBe(result.organizationId);
    expect(session!.session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
  }, 120_000);

  test("synthetic photos are real private files and repeated seeds are idempotent", async () => {
    const subject = { userId, organizationId };
    expect(await seedDemoPhotos(db, storage, subject)).toBe(2);
    expect(await seedDemoPhotos(db, storage, subject)).toBe(0);
    const photos = await storage.listPhotos({ organizationId, createdByUserId: userId });
    expect(photos).toHaveLength(2);
    seededPhotoIds = photos.map((photo) => photo.id).sort();
    for (const photo of photos) {
      const file = await storage.getSubjectPhoto({ subjectUserId: userId, objectId: photo.id });
      expect(file).not.toBeNull();
      expect((await new Response(file!.body).arrayBuffer()).byteLength).toBe(photo.sizeBytes);
      expect(
        await storage.getSubjectPhoto({ subjectUserId: "other-member", objectId: photo.id }),
      ).toBeNull();
    }
    await db.execute(
      sql`update private_body_measurement_preference set enabled = false where user_id = ${userId}`,
    );
    expect(await seedDemoPhotos(db, storage, subject)).toBe(0);
    await db.execute(
      sql`update private_body_measurement_preference set enabled = true where user_id = ${userId}`,
    );
  });

  test("demo reads work with a real session and cannot mutate or export", async () => {
    setRegisteredAuth(auth);
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    const handler = new RPCHandler(appRouter);
    const context = {
      db,
      session,
      isDemo: true,
      storage,
      correlationId: "demo-test",
      honoContext: { req: { raw: { headers: new Headers({ cookie }) } } },
    } as unknown as Context;
    async function rpc(path: string, input: unknown) {
      const result = await handler.handle(
        new Request(`http://test/rpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context },
      );
      if (!result.matched) throw new Error("Missing procedure");
      return {
        status: result.response.status,
        body: (await result.response.json()) as { json: unknown },
      };
    }
    const activity = await rpc("activity/dailyTotals", { days: 30 });
    expect(activity.status).toBe(200);
    expect(activity.body.json).toHaveLength(30);
    const photos = await rpc("privateBody/photos", {});
    expect(photos.status).toBe(200);
    expect((photos.body.json as { photos: unknown[] }).photos).toHaveLength(2);
    const goals = await rpc("goals/list", {});
    expect(goals.status).toBe(200);
    expect(JSON.stringify(goals.body)).toContain("sleep");
    for (const path of [
      "profile/update",
      "dataRights/deleteEverything",
      "exports/clinicalBundle",
      "billing/checkout",
      "ai/chat",
      "analytics/capture",
    ])
      expect((await rpc(path, {})).status).toBe(403);
  });

  test("auth writes, shared-session listing, identity links and workspace changes are blocked", async () => {
    for (const [path, body] of [
      ["/update-user", { name: "changed" }],
      ["/delete-user", {}],
      ["/organization/create", { name: "changed", slug: "changed" }],
      ["/organization/set-active", { organizationId: "other" }],
      ["/organization/invite-member", { email: "other@example.test", role: "owner" }],
      ["/revoke-other-sessions", {}],
      ["/link-social", { provider: "google" }],
    ] as const) {
      const result = await request(path, body, cookie);
      expect({ path, status: result.status }).toEqual({ path, status: 403 });
      expect(await result.json()).toMatchObject({ code: "DEMO_READ_ONLY" });
    }
    expect((await request("/list-sessions", undefined, cookie)).status).toBe(403);
    expect((await request("/get-session", undefined, cookie)).status).toBe(200);
    expect((await request("/sign-in/demo", {}, cookie)).status).toBe(409);
  });

  test("turning off public sign-in keeps existing sessions read-only", async () => {
    const off = createAuth(env, db, { ...authOptions, demoEmail: null });
    expect((await request("/update-user", { name: "changed" }, cookie, off)).status).toBe(403);
  });

  test("magic-link requests send no email for the demo", async () => {
    expect((await request("/sign-in/magic-link", { email })).status).toBe(200);
    expect(deliveries).toBe(0);
  });

  test("demo starts are rate limited per IP", async () => {
    const limited = createAuth(env, db, { ...authOptions, rateLimitEnabled: true });
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await limited.handler(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/demo`, {
          method: "POST",
          headers: {
            origin: env.CORS_ORIGIN,
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.42",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(attempt < 10 ? 200 : 429);
    }
  });

  test("store sign-in stays writable and cannot be replaced by a demo start", async () => {
    await db.execute(sql`insert into "user" ("id", "email", "email_verified", "role")
      values ('store-reviewer', 'store-reviewer@example.test', true, 'user')`);
    const storeAuth = createAuth(env, db, {
      ...authOptions,
      reviewSignIn: { email: "store-reviewer@example.test", code: "synthetic-store-code-1234" },
    });
    const response = await request(
      "/sign-in/review-code",
      { email: "store-reviewer@example.test", code: "synthetic-store-code-1234" },
      undefined,
      storeAuth,
    );
    expect(response.status).toBe(200);
    const storeCookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ");
    expect((await request("/sign-in/demo", {}, storeCookie, storeAuth)).status).toBe(409);
    expect(
      (await request("/update-user", { name: "Store reviewer" }, storeCookie, storeAuth)).status,
    ).toBe(200);
    expect(
      (await storeAuth.api.getSession({ headers: new Headers({ cookie: storeCookie }) }))?.user.id,
    ).toBe("store-reviewer");
    expect(await isDemoUser(db, "store-reviewer")).toBe(false);
  });

  test("refresh keeps the identity and live sessions; never converts real or store accounts", async () => {
    const refreshed = await refreshPublicDemo(db, input);
    expect(refreshed.status).toBe("refreshed");
    expect(refreshed.userId).toBe(userId);
    expect(refreshed.erasedRows).toBeGreaterThan(1000);
    expect(await seedDemoPhotos(db, storage, refreshed)).toBe(0);
    expect(
      (await storage.listPhotos({ organizationId, createdByUserId: userId }))
        .map((photo) => photo.id)
        .sort(),
    ).toEqual(seededPhotoIds);
    expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(userId);
    await expect(refreshPublicDemo(db, { ...input, reviewEmail: email })).rejects.toThrow(
      "must differ",
    );
    await db.execute(
      sql`insert into "user" ("id", "email", "role") values ('real-person', 'real@example.test', 'user')`,
    );
    await expect(refreshPublicDemo(db, { ...input, email: "real@example.test" })).rejects.toThrow(
      "Refusing to convert",
    );
    expect(
      (await db.execute(sql`select "role" from "user" where "id" = 'real-person'`)).rows[0],
    ).toEqual({ role: "user" });
  }, 120_000);

  test("leaving the demo invalidates only that visitor's session", async () => {
    const other = await request("/sign-in/demo", {});
    const otherCookie = other.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="))!
      .split(";")[0]!;
    expect((await request("/sign-out", {}, cookie)).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie: otherCookie }) }))?.user.id,
    ).toBe(userId);
  });
});
