import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { deleteSubjectData } from "@openvalens/data-rights/delete";
import { exportSubjectData } from "@openvalens/data-rights/export";
import {
  IMAGE_SANITIZATION_FIXTURE_CANARIES,
  jpegWithExif,
} from "@openvalens/body/sanitize-image.fixtures";
import { createDb, sql, type Database } from "@openvalens/db";
import { createStorageService, type StorageService } from "@openvalens/storage";
import { LocalObjectStorage } from "@openvalens/storage/providers/local";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

const url = process.env.PRIVATE_BODY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/private_body_test"
  )
    throw new Error("Empty disposable loopback private_body_test database required.");
}

const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-b": { org: "org-a", role: "collaborator" },
  "user-c": { org: "org-a", role: "owner" },
  "user-d": { org: "org-b", role: "owner" },
};
const noWeightAccess = new Set<string>();
const actor = (headers: Headers) => headers.get("x-test-user") ?? "user-a";
const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          impersonatedBy: headers.get("x-test-impersonated") ?? null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actor(headers);
      const member = MEMBERS[id];
      return member
        ? { id: `m-${id}`, userId: id, organizationId: member.org, role: member.role }
        : null;
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actor(headers)]?.role,
    }),
    hasPermission: async ({ headers }: { headers: Headers }) => ({
      success: !noWeightAccess.has(actor(headers)),
    }),
  },
} as unknown as Auth;

describe.skipIf(!url)("private body measurements over RPC and PostgreSQL", () => {
  const db: Database = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/private_body_test" });
  const rpc = new RPCHandler(appRouter);
  let storageRoot = "";
  let storage: StorageService;

  async function migrate() {
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const folder of (await readdir(root)).sort()) {
      if (!/^\d/.test(folder)) continue;
      const contents = await Bun.file(new URL(`${folder}/migration.sql`, root)).text();
      for (const statement of contents.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }

  function contextFor(headers: Headers): Context {
    const id = actor(headers);
    return {
      session: MEMBERS[id]
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              userId: id,
              activeOrganizationId: MEMBERS[id]!.org,
              impersonatedBy: headers.get("x-test-impersonated") ?? null,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }
        : null,
      db,
      correlationId: "corr-private-body",
      cronSecret: "synthetic-cron-secret-long-enough",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "synthetic", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
      storage,
    } as unknown as Context;
  }

  async function call(
    path: string,
    input: unknown,
    user = "user-a",
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({
      "content-type": "application/json",
      "x-test-user": user,
      ...extra,
    });
    const request = new Request(`http://test.local/rpc/privateBody/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched private-body RPC path");
    const body = (await response.json()) as { json: unknown };
    return { status: response.status, body: body.json };
  }

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (existing.rows.length) throw new Error("Integration database must be empty.");
    await migrate();
    setRegisteredAuth(auth);
    storageRoot = await mkdtemp(join(tmpdir(), "ov-private-photos-"));
    storage = createStorageService({
      db,
      storage: new LocalObjectStorage(storageRoot),
      maxObjectBytes: 10 * 1024 * 1024,
      signedUrlTtlSeconds: 300,
      signingKey: Buffer.alloc(32, 7),
    });
  });

  beforeEach(async () => {
    noWeightAccess.clear();
    await db.execute(sql`delete from stored_object`);
    await db.execute(sql`delete from photo_cleanup_intent`);
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from organization`);
    await db.execute(sql`insert into "user" (id, email) values
      ('user-a', 'user-a@example.test'), ('user-b', 'user-b@example.test'),
      ('user-c', 'user-c@example.test'), ('user-d', 'user-d@example.test')`);
    await db.execute(sql`insert into organization (id, name, slug) values
      ('org-a', 'Synthetic A', 'synthetic-a'), ('org-b', 'Synthetic B', 'synthetic-b')`);
    await db.execute(sql`insert into member (id, organization_id, user_id, role) values
      ('m-a', 'org-a', 'user-a', 'owner'), ('m-b', 'org-a', 'user-b', 'collaborator'),
      ('m-c', 'org-a', 'user-c', 'owner'), ('m-d', 'org-b', 'user-d', 'owner')`);
  });

  afterAll(async () => {
    clearRegisteredAuth();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    await db.$client.end();
  });

  test("feature starts opt-out and opt-in is per member", async () => {
    expect(await call("preference", {})).toMatchObject({ status: 200, body: { enabled: false } });
    expect(
      (
        await call("create", {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-10-17T10:00:00Z",
        })
      ).status,
    ).toBe(409);
    expect(await call("setPreference", { enabled: true })).toMatchObject({
      status: 200,
      body: { enabled: true },
    });
    expect(await call("preference", {}, "user-b")).toMatchObject({
      status: 200,
      body: { enabled: false },
    });
  });

  test("same-org member, workspace owner and other tenant cannot access another member's row", async () => {
    await call("setPreference", { enabled: true });
    const created = await call("create", {
      kind: "waist",
      value: 80,
      unit: "cm",
      measuredAt: "2026-10-17T10:00:00+00:00",
    });
    expect(created.status).toBe(200);
    const id = (created.body as { id: string }).id;
    expect((await call("list", {}, "user-b")).body).toEqual([]);
    expect((await call("list", {}, "user-c")).body).toEqual([]);
    expect(
      (
        await call(
          "update",
          {
            id,
            value: { kind: "waist", value: 81, unit: "cm", measuredAt: "2026-10-17T10:00:00Z" },
          },
          "user-b",
        )
      ).status,
    ).toBe(404);
    expect((await call("delete", { id }, "user-c")).status).toBe(404);
    expect((await call("list", {}, "user-d")).body).toEqual([]);
    expect(
      (
        await call(
          "update",
          {
            id,
            value: { kind: "waist", value: 82, unit: "cm", measuredAt: "2026-10-17T10:00:00Z" },
          },
          "user-d",
        )
      ).status,
    ).toBe(404);
    expect((await call("delete", { id }, "user-d")).status).toBe(404);
    expect((await call("list", {})).body).toMatchObject([
      { id, value: 80, unit: "cm", source: "manual" },
    ]);
  });

  test("input rejects spoofed ownership, incompatible units, invalid times and non-finite values", async () => {
    await call("setPreference", { enabled: true });
    const base = { kind: "weight", value: 70, unit: "kg", measuredAt: "2026-10-17T10:00:00Z" };
    expect((await call("create", { ...base, userId: "user-b" })).status).toBe(400);
    expect((await call("create", { ...base, organizationId: "org-b" })).status).toBe(400);
    expect((await call("create", { ...base, kind: "waist", unit: "kg" })).status).toBe(400);
    expect((await call("create", { ...base, measuredAt: "not-a-time" })).status).toBe(400);
    expect((await call("create", { ...base, measuredAt: "2026-10-17T10:00:00" })).status).toBe(400);
    expect((await call("create", { ...base, value: null })).status).toBe(400);
  });

  test("permission and trusted non-impersonated self gates are enforced", async () => {
    noWeightAccess.add("user-a");
    expect((await call("preference", {})).status).toBe(403);
    noWeightAccess.clear();
    expect(
      (await call("setPreference", { enabled: true }, "user-a", { "x-test-impersonated": "admin" }))
        .status,
    ).toBe(403);
  });

  test("owner can edit/delete own values; revoking opt-in blocks feature access", async () => {
    await call("setPreference", { enabled: true });
    const created = await call("create", {
      kind: "weight",
      value: 70,
      unit: "lb",
      measuredAt: "2026-10-17T10:00:00Z",
    });
    const id = (created.body as { id: string }).id;
    expect(
      (
        await call("update", {
          id,
          value: { kind: "weight", value: 71, unit: "lb", measuredAt: "2026-10-17T11:00:00Z" },
        })
      ).body,
    ).toMatchObject({ id, value: 71, unit: "lb", measuredAt: "2026-10-17T11:00:00.000Z" });
    await call("setPreference", { enabled: false });
    expect((await call("list", {})).body).toEqual([]);
    expect((await call("delete", { id })).status).toBe(404);
    await call("setPreference", { enabled: true });
    expect(await call("delete", { id })).toMatchObject({ status: 200, body: { deleted: true } });
  });

  test("data-rights export and subject erasure include only the member's rows", async () => {
    await call("setPreference", { enabled: true });
    await call("create", {
      kind: "weight",
      value: 70,
      unit: "kg",
      measuredAt: "2026-10-17T10:00:00Z",
    });
    await call("setPreference", { enabled: true }, "user-b");
    await call(
      "create",
      { kind: "hip", value: 95, unit: "cm", measuredAt: "2026-10-17T10:00:00Z" },
      "user-b",
    );
    const exported = await exportSubjectData(db, { userId: "user-a", organizationIds: [] });
    const entity = exported.files.find(
      (file) => file.path === "entities/private_body_measurement.json",
    );
    expect(JSON.parse(entity!.content)).toHaveLength(1);
    expect(JSON.parse(entity!.content)[0]).toMatchObject({ user_id: "user-a", kind: "weight" });
    const erased = await deleteSubjectData(db, { userId: "user-a", organizationIds: [] });
    expect(erased.rowCounts.private_body_measurement).toBe(1);
    expect(erased.rowCounts.private_body_measurement_preference).toBe(1);
    const remaining = await db.execute(sql`select user_id from private_body_measurement`);
    expect(remaining.rows).toEqual([{ user_id: "user-b" }]);
  });

  /** A real oRPC client, so uploads go through the multipart File encoding. */
  function clientFor(user: string, extra: Record<string, string> = {}) {
    const link = new RPCLink({
      url: "http://test.local/rpc",
      headers: { "x-test-user": user, ...extra },
      fetch: async (request) => {
        const { matched, response } = await rpc.handle(request as Request, {
          prefix: "/rpc",
          context: contextFor(new Headers((request as Request).headers)),
        });
        if (!matched || !response) throw new Error("unmatched private-body RPC path");
        return response;
      },
    });
    return createORPCClient<{
      privateBody: {
        photos: (input: object) => Promise<{
          enabled: boolean;
          storage: boolean;
          photos: { id: string; contentType: string; sizeBytes: number }[];
        }>;
        uploadPhoto: (input: { photo: Blob }) => Promise<{ id: string; contentType: string }>;
        photoFile: (input: { id: string }) => Promise<Blob>;
      };
    }>(link as never);
  }
  async function status(promise: Promise<unknown>): Promise<number | "ok"> {
    try {
      await promise;
      return "ok";
    } catch (error) {
      return (error as { status?: number }).status ?? 0;
    }
  }
  const jpeg = async () => new File([await jpegWithExif()], "IMG_0001.jpg", { type: "image/jpeg" });

  describe("progress photos (#85)", () => {
    test("are off until the member opts in, and uploads are refused while off", async () => {
      const client = clientFor("user-a");
      expect(await client.privateBody.photos({})).toEqual({
        enabled: false,
        storage: true,
        photos: [],
      });
      expect(await status(client.privateBody.uploadPhoto({ photo: await jpeg() }))).toBe(409);
      const stored = await db.execute(sql`select count(*)::int as n from stored_object`);
      expect(stored.rows[0]).toEqual({ n: 0 });
    });

    test("are stripped of EXIF/GPS metadata and stored privately", async () => {
      await call("setPreference", { enabled: true });
      const client = clientFor("user-a");
      const uploaded = await client.privateBody.uploadPhoto({ photo: await jpeg() });
      expect(uploaded.contentType).toBe("image/jpeg");

      const [row] = (
        await db.execute(
          sql`select storage_key, purpose, created_by_user_id, photo_state from stored_object where id = ${uploaded.id}`,
        )
      ).rows as {
        storage_key: string;
        purpose: string;
        created_by_user_id: string;
        photo_state: string;
      }[];
      expect(row).toMatchObject({
        purpose: "progress_photo",
        created_by_user_id: "user-a",
        photo_state: "ready",
      });
      // The stored bytes carry none of the original metadata canaries or the file name.
      const bytes = (await readFile(join(storageRoot, row!.storage_key))).toString("latin1");
      for (const canary of [...IMAGE_SANITIZATION_FIXTURE_CANARIES, "IMG_0001", "Exif"])
        expect(bytes).not.toContain(canary);

      expect((await client.privateBody.photos({})).photos.map((photo) => photo.id)).toEqual([
        uploaded.id,
      ]);
      const served = await client.privateBody.photoFile({ id: uploaded.id });
      expect(served.type).toBe("image/jpeg");
      expect(Buffer.from(await served.arrayBuffer()).toString("latin1")).toBe(bytes);
    });

    test("are visible only to the uploader, not to same-org owners or other tenants", async () => {
      await call("setPreference", { enabled: true });
      const uploaded = await clientFor("user-a").privateBody.uploadPhoto({ photo: await jpeg() });
      for (const user of ["user-b", "user-c", "user-d"]) {
        await call("setPreference", { enabled: true }, user);
        expect((await clientFor(user).privateBody.photos({})).photos).toEqual([]);
        expect(await status(clientFor(user).privateBody.photoFile({ id: uploaded.id }))).toBe(404);
        const link = await rpc.handle(
          new Request("http://test.local/rpc/storage/downloadUrl", {
            method: "POST",
            headers: { "content-type": "application/json", "x-test-user": user },
            body: JSON.stringify({ json: { objectId: uploaded.id } }),
          }),
          {
            prefix: "/rpc",
            context: contextFor(new Headers({ "x-test-user": user })),
          },
        );
        expect(link.response?.status).toBe(404);
      }
    });

    test("turning the opt-in off hides photos until it is turned on again", async () => {
      await call("setPreference", { enabled: true });
      const client = clientFor("user-a");
      const uploaded = await client.privateBody.uploadPhoto({ photo: await jpeg() });
      await call("setPreference", { enabled: false });
      expect((await client.privateBody.photos({})).photos).toEqual([]);
      expect(await status(client.privateBody.photoFile({ id: uploaded.id }))).toBe(404);
      await call("setPreference", { enabled: true });
      expect((await client.privateBody.photos({})).photos.map((photo) => photo.id)).toEqual([
        uploaded.id,
      ]);
    });

    test("rejects non-images, impersonated sessions and spoofed owner fields", async () => {
      await call("setPreference", { enabled: true });
      const client = clientFor("user-a");
      const text = new File(["not an image"], "note.jpg", { type: "image/jpeg" });
      expect(await status(client.privateBody.uploadPhoto({ photo: text }))).toBe(400);
      const impersonated = clientFor("user-a", { "x-test-impersonated": "admin" });
      expect(await status(impersonated.privateBody.uploadPhoto({ photo: await jpeg() }))).toBe(403);
      expect(
        await status(
          client.privateBody.uploadPhoto({ photo: await jpeg(), userId: "user-b" } as never),
        ),
      ).toBe(400);
      const stored = await db.execute(sql`select count(*)::int as n from stored_object`);
      expect(stored.rows[0]).toEqual({ n: 0 });
    });
  });
});
