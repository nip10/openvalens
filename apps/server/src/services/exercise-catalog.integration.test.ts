import { readdir } from "node:fs/promises";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  correlationMiddleware,
  securityHeadersMiddleware,
} from "@openvalens/observability/middleware";
import {
  registerExerciseCatalogAssetRoute,
  type ExerciseCatalogAssetReader,
} from "../exercise-catalog-asset-route";
import { importWgerSnapshot } from "./exercise-catalog-import";
import { normalizeWgerSnapshot } from "./exercise-catalog-normalization";
import { createExerciseCatalogAssetService } from "./exercise-catalog-assets";
import { pngWithMetadata } from "@openvalens/body/sanitize-image.fixtures";
import { LocalObjectStorage } from "@openvalens/storage/providers/local";
import type { Context } from "@openvalens/api/context";
import { appRouter } from "@openvalens/api/routers/index";

const url = process.env.EXERCISE_CATALOG_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/exercise_catalog_test"
  )
    throw new Error("Empty disposable loopback exercise_catalog_test database required.");
}

function assetHttpApp(
  enabled: boolean,
  getService: () => Promise<ExerciseCatalogAssetReader | null>,
) {
  const app = new Hono();
  app.use(correlationMiddleware());
  app.use(securityHeadersMiddleware({ cspMode: "enforce", allowDevScriptEval: false }));
  app.use(
    "/*",
    cors({
      origin: "http://test.local",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "x-correlation-id"],
      credentials: true,
    }),
  );
  app.get("/", (c) => c.text("server health"));
  registerExerciseCatalogAssetRoute(app, { enabled, getService });
  return app;
}

async function migrate(db: Database) {
  const root = new URL("../../../../packages/db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "cat-a": { org: "cat-org-a", role: "owner" },
  "cat-b": { org: "cat-org-b", role: "owner" },
  "cat-v": { org: "cat-org-a", role: "viewer" },
};
const actorOf = (headers: Headers) => headers.get("x-test-user") ?? "cat-a";
const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]!.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => ({
      success:
        MEMBERS[actorOf(headers)]!.role !== "viewer" ||
        Object.values(body.permissions)
          .flat()
          .every((action) => action === "read"),
    }),
  },
} as unknown as Auth;

const fixture = (version: string, translations = true) => ({
  source: "wger",
  complete: true,
  snapshotVersion: version,
  snapshotAt: "2026-10-21T12:00:00.000Z",
  results: [
    {
      id: 7001,
      translations: [
        {
          language: { short_name: "en" },
          name: "Fixture row",
          instructions: "<script>alert(1)</script>plain instructions",
          sourceUrl: "https://example.test/en",
          license: {
            short_name: "CC0-1.0",
            url: "https://creativecommons.org/publicdomain/zero/1.0/",
          },
        },
        ...(translations
          ? [
              {
                language: { short_name: "fr" },
                name: "Fixture FR",
                sourceUrl: "https://example.test/fr",
                license: {
                  short_name: "CC0-1.0",
                  url: "https://creativecommons.org/publicdomain/zero/1.0/",
                },
              },
            ]
          : []),
      ],
      muscles: [{ id: 4, name: "Shoulder", is_front: true }],
      equipment: [{ id: 8, name: "Dumbbell" }],
      images: [
        {
          id: 9,
          image: "https://example.test/image.jpg",
          license: {
            short_name: "CC0-1.0",
            url: "https://creativecommons.org/publicdomain/zero/1.0/",
          },
        },
      ],
    },
  ],
});

describe.skipIf(!url)("exercise catalog using disposable PostgreSQL and real RPCHandler", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/exercise_catalog_test" });
  const rpc = new RPCHandler(appRouter);
  let workoutA = 0;
  let workoutB = 0;
  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: { user: { id }, session: { activeOrganizationId: MEMBERS[id]!.org } },
      db,
      correlationId: "exercise-catalog-test",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }
  async function call<T = Record<string, unknown>>(path: string, input: unknown, user = "cat-a") {
    const headers = new Headers({ "content-type": "application/json", "x-test-user": user });
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    return { status: response.status, body: ((await response.json()) as { json: T }).json };
  }
  const catalog = <T = Record<string, unknown>>(method: string, input: unknown, user?: string) =>
    call<T>(`exerciseCatalog/${method}`, input, user);

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema='public'`,
    );
    if (Number((existing.rows[0] as { n: number }).n) !== 0)
      throw new Error("Exercise catalog integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`insert into "user" (id,email) values ('cat-a','cat-a@example.test'),('cat-b','cat-b@example.test'),('cat-v','cat-v@example.test');
      insert into organization (id,name,slug) values ('cat-org-a','Catalog A','cat-a'),('cat-org-b','Catalog B','cat-b');
      insert into member (id,organization_id,user_id,role) values ('cat-ma','cat-org-a','cat-a','owner'),('cat-mb','cat-org-b','cat-b','owner'),('cat-mv','cat-org-a','cat-v','viewer');`),
    );
    const workout = await db.execute(
      sql`insert into workout (organization_id,date,type,created_at) values ('cat-org-a','2026-10-22','weights',${new Date().toISOString()}) returning id`,
    );
    workoutA = Number((workout.rows[0] as { id: number }).id);
    const secondWorkout = await db.execute(
      sql`insert into workout (organization_id,date,type,created_at) values ('cat-org-b','2026-10-22','weights',${new Date().toISOString()}) returning id`,
    );
    workoutB = Number((secondWorkout.rows[0] as { id: number }).id);
    setRegisteredAuth(fakeAuth);
  });
  afterAll(async () => {
    clearRegisteredAuth();
    await db.$client.end();
  });

  test("normalizer fails closed for incomplete, unknown-license, missing-author, and missing-image-source evidence", () => {
    const bytes = Buffer.from("synthetic-fixture");
    expect(() =>
      normalizeWgerSnapshot({ ...fixture("partial"), complete: false }, bytes),
    ).toThrow();
    const unknown = structuredClone(fixture("unknown"));
    unknown.results[0]!.translations[0]!.license.short_name = "UNKNOWN";
    const normalizedUnknown = normalizeWgerSnapshot(unknown, bytes);
    expect(normalizedUnknown.accepted).toHaveLength(0);
    const mismatchedUrl = structuredClone(fixture("mismatched-license-url"));
    mismatchedUrl.results[0]!.translations[0]!.license.url = "https://example.test/fake-license";
    expect(normalizeWgerSnapshot(mismatchedUrl, bytes).accepted).toHaveLength(0);
    const missingSource = structuredClone(fixture("source"));
    missingSource.results[0]!.images[0]!.image = "";
    expect(normalizeWgerSnapshot(missingSource, bytes).accepted[0]!.media).toHaveLength(0);
    expect(
      normalizeWgerSnapshot(fixture("html"), bytes).accepted[0]!.translations[0]!.instructions,
    ).toContain("<script>");
  });

  test("complete pinned snapshot imports idempotently, replaces stale children, and serves only licensed global rows", async () => {
    const firstFixture = fixture("catalog-checkpoint-fixture-v1");
    const first = normalizeWgerSnapshot(firstFixture, Buffer.from(JSON.stringify(firstFixture)));
    expect(await importWgerSnapshot(db, first)).toMatchObject({
      inserted: 6,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      translations: 2,
      muscles: 1,
      equipment: 1,
      media: 1,
    });
    const original = await db.execute(
      sql`select id from exercise where source='wger' and external_id='7001'`,
    );
    const exerciseId = Number((original.rows[0] as { id: number }).id);
    expect(await importWgerSnapshot(db, first)).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 6,
      rejected: 0,
    });
    const localized = await catalog<{ name: string; language: string | null }>("get", {
      id: exerciseId,
      language: "fr",
    });
    expect(localized.body).toMatchObject({ name: "Fixture FR", language: "fr" });
    expect((await catalog<unknown[]>("search", { query: "Fixture row" })).body).toHaveLength(1);
    expect((await catalog<unknown[]>("search", { muscleExternalId: "4" })).body).toHaveLength(1);
    expect((await catalog<unknown[]>("search", { equipmentExternalId: "8" })).body).toHaveLength(1);
    const changedFixture = fixture("catalog-checkpoint-fixture-v2", false);
    changedFixture.results[0]!.muscles = [];
    changedFixture.results[0]!.equipment = [];
    const changed = normalizeWgerSnapshot(
      changedFixture,
      Buffer.from(JSON.stringify(changedFixture)),
    );
    expect(await importWgerSnapshot(db, changed)).toMatchObject({
      updated: 2,
      unchanged: 1,
      translations: 1,
      muscles: 0,
      equipment: 0,
    });
    const translations = await db.execute(
      sql`select language_code from exercise_translation where exercise_id=${exerciseId}`,
    );
    expect(
      translations.rows.map((row) => (row as { language_code: string }).language_code),
    ).toEqual(["en"]);
    const visibility = await catalog("get", { id: exerciseId, language: "fr" });
    expect(visibility.status).toBe(200);
    expect(visibility.body).toMatchObject({
      name: "Fixture row",
      language: "en",
      instructionsArePlainText: true,
      license: "CC0-1.0",
      snapshotVersion: "catalog-checkpoint-fixture-v2",
      instructions: "<script>alert(1)</script>plain instructions",
    });
    expect(visibility.body.instructionsArePlainText).toBe(true);
    expect(JSON.stringify(visibility.body)).not.toContain("/api/exercise-assets/");
    const otherOrg = await catalog("get", { id: exerciseId }, "cat-b");
    expect(otherOrg.status).toBe(200); // licensed global rows are shared across organizations.
    const viewerWrite = await catalog(
      "createCustom",
      { clientMutationId: "00000000-0000-4000-8000-000000000005", name: "Denied", language: "en" },
      "cat-v",
    );
    expect(viewerWrite.status).toBe(403);
  });

  test("custom ownership, replay receipts, workout catalog link, and free-text remain safe", async () => {
    const created = await catalog<{ id: number; name: string }>("createCustom", {
      clientMutationId: "00000000-0000-4000-8000-000000000001",
      name: "Private push",
      language: "en",
      instructions: "plain",
    });
    expect(created.status).toBe(200);
    const replay = await catalog<{ id: number }>("createCustom", {
      clientMutationId: "00000000-0000-4000-8000-000000000001",
      name: "Private push",
      language: "en",
      instructions: "plain",
    });
    expect(replay.body.id).toBe(created.body.id);
    expect(
      (
        await catalog("createCustom", {
          clientMutationId: "00000000-0000-4000-8000-000000000001",
          name: "Changed",
          language: "en",
        })
      ).status,
    ).toBe(409);
    expect((await catalog("get", { id: created.body.id }, "cat-b")).body).toBeNull();
    const forged = await catalog("createCustom", {
      clientMutationId: "00000000-0000-4000-8000-000000000002",
      name: "Nope",
      language: "en",
      organizationId: "cat-org-b",
    });
    expect(forged.status).toBe(400);

    const globalRows = await db.execute(
      sql`select id from exercise where source='wger' and external_id='7001'`,
    );
    const globalId = Number((globalRows.rows[0] as { id: number }).id);
    const add = {
      clientMutationId: "00000000-0000-4000-8000-000000000003",
      workoutId: workoutA,
      exerciseId: globalId,
      language: "en",
    };
    const added = await catalog<{ id: number; name: string }>("addFromLibrary", add);
    expect(added.status).toBe(200);
    expect(added.body.name).toBe("Fixture row");
    const repeated = await catalog<{ id: number }>("addFromLibrary", add);
    expect(repeated.body.id).toBe(added.body.id);
    expect((await catalog("addFromLibrary", { ...add, exerciseId: created.body.id })).status).toBe(
      409,
    );
    const crossOrg = await catalog("addFromLibrary", { ...add, workoutId: 999999 }, "cat-b");
    expect([404, 403]).toContain(crossOrg.status);
    const customLink = await catalog("addFromLibrary", {
      clientMutationId: "00000000-0000-4000-8000-000000000004",
      workoutId: workoutA,
      exerciseId: created.body.id,
    });
    expect(customLink.body).toMatchObject({ name: "Private push" });
    const linkedCustom = await db.execute(
      sql`select exercise_id,name from workout_exercise where id=${customLink.body.id}`,
    );
    expect(linkedCustom.rows[0]).toMatchObject({
      exercise_id: created.body.id,
      name: "Private push",
    });
    expect(
      (
        await catalog(
          "addFromLibrary",
          {
            clientMutationId: "00000000-0000-4000-8000-000000000006",
            workoutId: workoutB,
            exerciseId: created.body.id,
          },
          "cat-b",
        )
      ).status,
    ).toBe(404);
    await db.execute(
      sql`insert into workout_exercise (organization_id,workout_id,sort_order,name,notes) values ('cat-org-a',${workoutA},2,'Free-text entry','legacy remains supported')`,
    );
    expect(
      (
        await db.execute(
          sql`select count(*)::int as n from workout_exercise where workout_id=${workoutA}`,
        )
      ).rows[0],
    ).toMatchObject({ n: 3 });
  });

  test("verified synthetic asset is sanitized, stored locally, and read back only from its catalog manifest", async () => {
    const media =
      await db.execute(sql`select m.id as media_id,e.id as exercise_id,e.external_id,e.snapshot_version,e.snapshot_at,
      m.source_external_media_id,m.license_code,m.license_url,m.author,m.raw_attribution,m.source_media_url
      from exercise_media m join exercise e on e.id=m.exercise_id where e.source='wger' and e.external_id='7001' limit 1`);
    const row = media.rows[0] as {
      media_id: number;
      exercise_id: number;
      external_id: string;
      snapshot_version: string;
      snapshot_at: Date | string;
      source_external_media_id: string;
      license_code: string;
      license_url: string;
      author: string | null;
      raw_attribution: string | null;
      source_media_url: string;
    };
    const evidence = {
      sourceExerciseId: row.exercise_id,
      sourceExternalExerciseId: row.external_id,
      exerciseMediaId: row.media_id,
      sourceExternalMediaId: row.source_external_media_id,
      snapshotVersion: row.snapshot_version,
      snapshotAt: new Date(row.snapshot_at),
      licenseCode: row.license_code,
      licenseUrl: row.license_url,
      author: row.author,
      attribution: row.raw_attribution,
      sourceUrl: row.source_media_url,
      transformationNotice:
        "Image decoded, EXIF-oriented, resized within publication limits, metadata-stripped, and re-encoded as JPEG or PNG.",
    };
    const root = await mkdtemp(
      "/private/var/folders/8t/tp50trfs7rg_gwkp1pycpmvm0000gn/T/opencode/exercise-storage-",
    );
    const baseStorage = new LocalObjectStorage(root);
    const storageReads: string[] = [];
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "get")
          return async (key: string) => {
            storageReads.push(key);
            return target.get(key);
          };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LocalObjectStorage;
    try {
      const service = createExerciseCatalogAssetService({
        db,
        storage,
        limits: {
          maxInputBytes: 10 * 1024 * 1024,
          maxInputPixels: 16_000_000,
          maxOutputEdge: 2048,
          maxOutputBytes: 8 * 1024 * 1024,
          maxPublishedBytes: 8 * 1024 * 1024,
          storageIdentity: storage.storeIdentity,
        },
      });
      const original = await pngWithMetadata();
      const digest = createHash("sha256").update(original).digest("hex");
      const published = await service.ingestLocalAsset({
        exerciseMediaId: row.media_id,
        bytes: original,
        expectedOriginalSha256: digest,
        publicationEvidence: evidence,
      });
      expect(published.state).toBe("ready");
      const readback = await service.readPublishedAsset(published.id);
      expect(readback).toMatchObject({
        contentType: "image/png",
        size: published.size,
        sha256: published.sha256,
      });
      expect(readback!.bytes.includes(Buffer.from("PNG-XMP-CANARY"))).toBe(false);
      expect(await service.listPublishedMetadata([row.exercise_id])).toMatchObject([
        {
          exerciseId: row.exercise_id,
          media: [{ assetId: published.id, path: `/api/exercise-assets/${published.id}` }],
        },
      ]);
      expect(await service.readPublishedAsset("00000000-0000-4000-8000-000000000000")).toBeNull();

      const metadata = (await service.listPublishedMetadata([row.exercise_id]))[0]!.media[0]!;
      const assetPath = new URL(metadata.path, "http://test.local");
      expect(assetPath.origin).toBe("http://test.local");
      expect(assetPath.pathname).toBe(`/api/exercise-assets/${published.id}`);
      const httpApp = assetHttpApp(true, async () => service);
      const disabledApp = assetHttpApp(false, async () => {
        throw new Error("disabled route must not access storage");
      });
      const unavailableApp = assetHttpApp(true, async () => null);
      let outboundRequests = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
        outboundRequests += 1;
        return originalFetch(...args);
      }) as typeof fetch;
      try {
        const health = await httpApp.fetch(new Request("http://test.local/"));
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("server health");
        const response = await httpApp.fetch(
          new Request(assetPath.toString(), {
            headers: { origin: "http://test.local", "x-correlation-id": "catalog-route-test" },
          }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("content-length")).toBe(String(readback!.size));
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(response.headers.get("content-security-policy")).toContain("default-src");
        expect(response.headers.get("access-control-allow-origin")).toBe("http://test.local");
        expect(response.headers.get("x-correlation-id")).toBe("catalog-route-test");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          new Uint8Array(readback!.bytes),
        );

        const malformed = await httpApp.fetch(
          new Request("http://test.local/api/exercise-assets/not-a-uuid"),
        );
        expect(malformed.status).toBe(404);
        expect(await malformed.json()).toEqual({ error: "NOT_FOUND" });
        const missing = await httpApp.fetch(
          new Request("http://test.local/api/exercise-assets/00000000-0000-4000-8000-000000000099"),
        );
        expect(missing.status).toBe(404);
        expect(await missing.text()).not.toContain(root);
        const disabled = await disabledApp.fetch(new Request(assetPath.toString()));
        expect(disabled.status).toBe(404);
        const unavailable = await unavailableApp.fetch(new Request(assetPath.toString()));
        expect(unavailable.status).toBe(404);
        expect(await unavailable.json()).toEqual({ error: "NOT_FOUND" });

        const privateId = "f0000000-0000-4000-8000-000000000001";
        const privateKey = "org/cat-org-a/private-photo-canary";
        const privateBytes = Buffer.from("synthetic private photo bytes");
        await db.execute(sql`insert into stored_object (id,organization_id,created_by_user_id,purpose,storage_key,content_type,size_bytes,sha256)
          values (${privateId},'cat-org-a','cat-a','progress_photo',${privateKey},'image/png',${privateBytes.byteLength},${createHash("sha256").update(privateBytes).digest("hex")})`);
        await storage.put(privateKey, privateBytes, {
          contentType: "image/png",
          sha256: createHash("sha256").update(privateBytes).digest("hex"),
        });
        storageReads.length = 0;
        const privateResponse = await httpApp.fetch(
          new Request(`http://test.local/api/exercise-assets/${privateId}`),
        );
        expect(privateResponse.status).toBe(404);
        expect(await privateResponse.json()).toEqual({ error: "NOT_FOUND" });
        expect(storageReads).not.toContain(privateKey);
        expect(storageReads).toEqual([]);

        await db.execute(
          sql`update exercise_catalog_asset set state='pending' where id=${published.id}`,
        );
        expect((await httpApp.fetch(new Request(assetPath.toString()))).status).toBe(404);
        await db.execute(
          sql`update exercise_catalog_asset set state='ready' where id=${published.id}`,
        );
        const corrupt = Buffer.from("corrupt synthetic catalog bytes");
        await storage.put(`catalog/exercise/${published.id}`, corrupt, {
          contentType: "image/png",
          sha256: createHash("sha256").update(corrupt).digest("hex"),
        });
        expect((await httpApp.fetch(new Request(assetPath.toString()))).status).toBe(404);
        await db.execute(
          sql`update exercise_catalog_asset set state='withdrawn' where id=${published.id}`,
        );
        expect((await httpApp.fetch(new Request(assetPath.toString()))).status).toBe(404);
        expect(outboundRequests).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }

      const rejectedMedia =
        await db.execute(sql`insert into exercise_media (exercise_id,source_external_media_id,kind,license_code,license_url,source_media_url,snapshot_version,snapshot_at)
        select id,'unknown-license-image','image','UNKNOWN','https://example.test/license','https://example.test/image.jpg',snapshot_version,snapshot_at from exercise where id=${row.exercise_id} returning id`);
      await expect(
        service.ingestLocalAsset({
          exerciseMediaId: Number((rejectedMedia.rows[0] as { id: number }).id),
          bytes: original,
          expectedOriginalSha256: digest,
          publicationEvidence: {
            ...evidence,
            exerciseMediaId: Number((rejectedMedia.rows[0] as { id: number }).id),
            sourceExternalMediaId: "unknown-license-image",
            licenseCode: "UNKNOWN",
            licenseUrl: "https://example.test/license",
          },
        }),
      ).rejects.toMatchObject({ code: "ineligible" });

      const replacement = fixture("catalog-checkpoint-fixture-v3", false);
      replacement.results[0]!.images = [];
      await importWgerSnapshot(
        db,
        normalizeWgerSnapshot(replacement, Buffer.from(JSON.stringify(replacement))),
      );
      expect(await service.readPublishedAsset(published.id)).toBeNull();
      expect(await service.listPublishedMetadata([row.exercise_id])).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("CLI dry-run is write-free and two explicit applies are idempotent in isolated Bun processes", async () => {
    const input = fixture("cli-pinned-fixture-v1");
    input.results[0]!.id = 7002;
    const directory = await mkdtemp(
      "/private/var/folders/8t/tp50trfs7rg_gwkp1pycpmvm0000gn/T/opencode/exercise-catalog-",
    );
    const file = join(directory, "fixture.json");
    await writeFile(file, JSON.stringify(input));
    const run = (apply: boolean) =>
      spawnSync(
        "bun",
        ["scripts/import-exercises.ts", "--file", file, ...(apply ? ["--apply"] : [])],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, DATABASE_URL: url! },
        },
      );
    try {
      const before = await db.execute(
        sql`select count(*)::int as n from exercise where source='wger' and external_id='7002'`,
      );
      const dry = run(false);
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain('"mode":"dry-run"');
      expect(
        (
          await db.execute(
            sql`select count(*)::int as n from exercise where source='wger' and external_id='7002'`,
          )
        ).rows,
      ).toEqual(before.rows);
      const first = run(true);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain('"inserted":6');
      const second = run(true);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain('"unchanged":6');
      expect(
        (
          await db.execute(
            sql`select count(*)::int as n from exercise where source='wger' and external_id='7002'`,
          )
        ).rows[0],
      ).toMatchObject({ n: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("media manifest rejects absolute/traversal paths and symlinks in isolated CLI dry runs", async () => {
    const directory = await mkdtemp(
      "/private/var/folders/8t/tp50trfs7rg_gwkp1pycpmvm0000gn/T/opencode/exercise-media-path-",
    );
    const inputDir = join(directory, "input");
    await mkdir(inputDir);
    const outside = join(directory, "outside.png");
    await writeFile(outside, "synthetic-not-an-image");
    const manifest = join(directory, "manifest.json");
    const item = {
      exerciseMediaId: 1,
      sourceExerciseId: 1,
      sourceExternalExerciseId: "synthetic-1",
      sourceExternalMediaId: "synthetic-media-1",
      snapshotVersion: "synthetic-media-v1",
      snapshotAt: "2026-10-21T12:00:00.000Z",
      licenseCode: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      author: null,
      attribution: null,
      sourceUrl: "https://example.test/image",
      transformationNotice:
        "Image decoded, EXIF-oriented, resized within publication limits, metadata-stripped, and re-encoded as JPEG or PNG.",
      expectedOriginalSha256: createHash("sha256").update("synthetic-not-an-image").digest("hex"),
      file: "link.png",
    };
    const run = () =>
      spawnSync(
        "bun",
        [
          "apps/server/src/exercise-media-import.ts",
          "--manifest",
          manifest,
          "--input-dir",
          inputDir,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
    try {
      for (const file of ["../outside.png", outside]) {
        await writeFile(
          manifest,
          JSON.stringify({
            source: "wger",
            complete: true,
            snapshotVersion: "synthetic-media-v1",
            snapshotAt: item.snapshotAt,
            items: [{ ...item, file }],
          }),
        );
        expect(run().status).toBe(1);
      }
      await symlink(outside, join(inputDir, "link.png"));
      await writeFile(
        manifest,
        JSON.stringify({
          source: "wger",
          complete: true,
          snapshotVersion: "synthetic-media-v1",
          snapshotAt: item.snapshotAt,
          items: [item],
        }),
      );
      const symlinkAttempt = run();
      expect(symlinkAttempt.status).toBe(0);
      expect(symlinkAttempt.stdout).toContain('"file_not_regular":1');
      expect(symlinkAttempt.stdout).toContain('"publicationVerified":false');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("synthetic 1,000-row search captures query latency and counts without a timing threshold", async () => {
    await db.execute(sql`insert into exercise (organization_id,source,external_id,name,license_code,license_url,source_record_url,snapshot_version,snapshot_at)
      select null,'wger','perf-' || n,'Synthetic performance ' || lpad(n::text,4,'0'),'CC0-1.0','https://creativecommons.org/publicdomain/zero/1.0/',
        'https://example.test/exercise/' || n,'synthetic-full-size-v1','2026-10-21T12:00:00Z'::timestamptz from generate_series(1,1000) n`);
    await db.execute(sql`insert into exercise_muscle (exercise_id,external_muscle_id,name,role,location)
      select id,'perf-muscle','Synthetic muscle','primary','front' from exercise where external_id like 'perf-%'`);
    await db.execute(sql`insert into exercise_equipment (exercise_id,external_equipment_id,name)
      select id,'perf-equipment','Synthetic equipment' from exercise where external_id like 'perf-%'`);
    for (const [caseName, input] of [
      ["name", { query: "Synthetic performance", limit: 50 }],
      ["muscle", { muscleExternalId: "perf-muscle", limit: 50 }],
      ["equipment", { equipmentExternalId: "perf-equipment", limit: 50 }],
    ] as const) {
      const start = performance.now();
      const result = await catalog<unknown[]>("search", input);
      const latencyMs = Number((performance.now() - start).toFixed(2));
      expect(result.status).toBe(200);
      expect(result.body).toHaveLength(50);
      console.log(
        JSON.stringify({
          performanceFixture: "synthetic-1000",
          case: caseName,
          latencyMs,
          resultCount: result.body.length,
        }),
      );
    }
  });
});
