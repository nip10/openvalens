import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "bun:test";
import { createDb, sql } from "@openvalens/db";
import { aiAppCall, aiAppGrant, aiAppKey } from "@openvalens/db/schema/ai-apps";
import { accessAuditLog, member, organization, user } from "@openvalens/db/schema/auth";
import { and, eq } from "drizzle-orm";

import {
  AI_APP_CONSENT_VERSION,
  AiAppGrantError,
  createAiAppsService,
  type AiAppKeyCreatedEvent,
} from "./grants";
import { hashPersonalKey } from "./keys";

/**
 * Grants and personal API keys (Issue #439) against a disposable PostgreSQL:
 * revoke, expiry, the owner's workspace switch, membership changes, the key
 * limit, audit events and usage retention. Synthetic data only.
 */

const url = process.env.AI_APPS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/ai_apps_test")
    throw new Error("Empty disposable loopback ai_apps_test database required.");
}

describe.skipIf(!url)("AI-app grants against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/ai_apps_test" });
  const ORG = "org-ai-apps-owner";
  const OTHER_ORG = "org-ai-apps-other";
  const OWNER = "user-ai-apps-owner";
  const VIEWER = "user-ai-apps-viewer";
  let clock = new Date("2026-11-12T10:00:00.000Z");
  const emails: AiAppKeyCreatedEvent[] = [];
  const service = createAiAppsService({
    db,
    now: () => clock,
    onKeyCreated: async (event) => {
      emails.push(event);
    },
  });

  function createKey(overrides: Partial<Parameters<typeof service.createPersonalKey>[0]> = {}) {
    return service.createPersonalKey({
      userId: OWNER,
      organizationId: ORG,
      label: "Claude Code",
      scopes: [],
      expiresInDays: 90,
      consentVersion: AI_APP_CONSENT_VERSION,
      ...overrides,
    });
  }

  async function expectCode(promise: Promise<unknown>, code: string) {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiAppGrantError);
    expect((error as AiAppGrantError).code).toBe(code as AiAppGrantError["code"]);
  }

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(organization).values([
      { id: ORG, name: "Owner records", slug: "ai-apps-owner" },
      { id: OTHER_ORG, name: "Other", slug: "ai-apps-other" },
    ]);
    await db.insert(user).values([
      { id: OWNER, email: "owner@example.test" },
      { id: VIEWER, email: "viewer@example.test" },
    ]);
    await db.insert(member).values([
      { id: "m-owner", organizationId: ORG, userId: OWNER, role: "owner" },
      { id: "m-viewer", organizationId: ORG, userId: VIEWER, role: "viewer" },
      { id: "m-owner-other", organizationId: OTHER_ORG, userId: OWNER, role: "owner" },
    ]);
  });

  test("a key is shown once, stored only as a digest, and authenticates", async () => {
    const created = await createKey({ scopes: ["nutrition:read"] });
    expect(created.key).toMatch(/^ov_/);
    expect(created.grant).toMatchObject({
      kind: "personal_key",
      scopes: ["nutrition:read", "records:read"],
      consentVersion: "mcp-v1",
      status: "active",
      displayPrefix: created.key.slice(0, 9),
    });
    expect(created.grant.expiresAt).toBe("2027-02-10T10:00:00.000Z");

    const [stored] = await db.select().from(aiAppKey).where(eq(aiAppKey.grantId, created.grant.id));
    expect(stored?.keyHash).toBe(hashPersonalKey(created.key));
    expect(JSON.stringify(stored)).not.toContain(created.key);

    const listed = await service.listGrants({ userId: OWNER, organizationId: ORG });
    expect(JSON.stringify(listed)).not.toContain(created.key);
    expect(listed.map((grant) => grant.id)).toContain(created.grant.id);

    const auth = await service.authenticate(`Bearer ${created.key}`);
    expect(auth).toEqual({
      ok: true,
      principal: {
        grantId: created.grant.id,
        kind: "personal_key",
        userId: OWNER,
        organizationId: ORG,
        scopes: ["nutrition:read", "records:read"],
        label: "Claude Code",
      },
    });

    // The security email names the key and never carries it.
    const email = emails.find((event) => event.grantId === created.grant.id);
    expect(email?.displayPrefix).toBe(created.key.slice(0, 9));
    expect(JSON.stringify(email)).not.toContain(created.key);

    const events = await db
      .select({ eventType: accessAuditLog.eventType })
      .from(accessAuditLog)
      .where(eq(accessAuditLog.targetId, created.grant.id));
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "AI_APP_CONSENT_GIVEN",
      "AI_APP_GRANT_CREATED",
    ]);
  });

  test("a revoked key is rejected on the very next call", async () => {
    const created = await createKey();
    expect((await service.authenticate(`Bearer ${created.key}`)).ok).toBe(true);
    expect(
      await service.revokeGrant({ userId: OWNER, organizationId: ORG, grantId: created.grant.id }),
    ).toEqual({ revoked: true, found: true });
    expect(await service.authenticate(`Bearer ${created.key}`)).toEqual({
      ok: false,
      reason: "revoked",
    });
    // Idempotent, and nobody else can revoke it.
    expect(
      await service.revokeGrant({ userId: OWNER, organizationId: ORG, grantId: created.grant.id }),
    ).toEqual({ revoked: false, found: true });
    expect(
      await service.revokeGrant({ userId: VIEWER, organizationId: ORG, grantId: created.grant.id }),
    ).toEqual({ revoked: false, found: false });
    const events = await db
      .select({ eventType: accessAuditLog.eventType })
      .from(accessAuditLog)
      .where(eq(accessAuditLog.targetId, created.grant.id));
    expect(events.map((event) => event.eventType)).toContain("AI_APP_GRANT_REVOKED");
    expect(events.map((event) => event.eventType)).toContain("AI_APP_CONSENT_WITHDRAWN");
  });

  test("the owner turning AI apps off stops existing keys and new ones", async () => {
    const created = await createKey();
    await service.setWorkspaceSetting({
      userId: OWNER,
      organizationId: ORG,
      membersCanConnect: false,
    });
    expect(await service.authenticate(`Bearer ${created.key}`)).toEqual({
      ok: false,
      reason: "workspace_disabled",
    });
    await expectCode(createKey(), "WORKSPACE_DISABLED");
    // A key for another workspace keeps working.
    const other = await createKey({ organizationId: OTHER_ORG });
    expect((await service.authenticate(`Bearer ${other.key}`)).ok).toBe(true);

    await service.setWorkspaceSetting({
      userId: OWNER,
      organizationId: ORG,
      membersCanConnect: true,
    });
    expect((await service.authenticate(`Bearer ${created.key}`)).ok).toBe(true);
    await expectCode(
      service.setWorkspaceSetting({
        userId: VIEWER,
        organizationId: ORG,
        membersCanConnect: false,
      }),
      "NOT_OWNER",
    );
  });

  test("only the workspace owner holds a grant, and a downgrade stops it", async () => {
    await expectCode(createKey({ userId: VIEWER }), "NOT_OWNER");
    const created = await createKey({ organizationId: OTHER_ORG });
    await db
      .update(member)
      .set({ role: "viewer" })
      .where(and(eq(member.organizationId, OTHER_ORG), eq(member.userId, OWNER)));
    expect(await service.authenticate(`Bearer ${created.key}`)).toEqual({
      ok: false,
      reason: "not_owner",
    });
    await db
      .update(member)
      .set({ role: "owner" })
      .where(and(eq(member.organizationId, OTHER_ORG), eq(member.userId, OWNER)));
  });

  test("expiry stops a key and is audited once", async () => {
    const created = await createKey({ expiresInDays: 30 });
    clock = new Date("2026-12-12T10:00:01.000Z");
    expect(await service.authenticate(`Bearer ${created.key}`)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await service.authenticate(`Bearer ${created.key}`)).toEqual({
      ok: false,
      reason: "expired",
    });
    const expired = await db
      .select({ id: accessAuditLog.id })
      .from(accessAuditLog)
      .where(
        and(
          eq(accessAuditLog.targetId, created.grant.id),
          eq(accessAuditLog.eventType, "AI_APP_GRANT_EXPIRED"),
        ),
      );
    expect(expired).toHaveLength(1);
    clock = new Date("2026-11-12T10:00:00.000Z");
  });

  test("unknown, malformed and missing bearers are refused", async () => {
    expect(await service.authenticate(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(await service.authenticate("Bearer not-a-key")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await service.authenticate(`Bearer ov_${"A".repeat(43)}`)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  test("reserved scopes and a stale consent version are refused", async () => {
    await expectCode(createKey({ scopes: ["water:write"] }), "INVALID_SCOPE");
    await expectCode(createKey({ scopes: ["cycle:read"] }), "INVALID_SCOPE");
    await expectCode(createKey({ consentVersion: "v1" }), "CONSENT_REQUIRED");
  });

  test("a member holds at most ten active personal keys", async () => {
    const active = await db
      .select({ id: aiAppGrant.id })
      .from(aiAppGrant)
      .where(and(eq(aiAppGrant.userId, OWNER)));
    // Revoke everything so the count starts from zero.
    for (const grant of active)
      await service.revokeGrant({ userId: OWNER, organizationId: ORG, grantId: grant.id });
    for (const grant of active)
      await service.revokeGrant({ userId: OWNER, organizationId: OTHER_ORG, grantId: grant.id });
    for (let index = 0; index < 10; index++) await createKey({ label: `Key ${index}` });
    await expectCode(createKey({ label: "Eleventh" }), "KEY_LIMIT_REACHED");
  });

  test("usage rows are recorded without arguments and purged after 90 days", async () => {
    const [grant] = await db
      .select({ id: aiAppGrant.id, organizationId: aiAppGrant.organizationId })
      .from(aiAppGrant)
      .where(eq(aiAppGrant.userId, OWNER))
      .limit(1);
    const principal = {
      grantId: grant!.id,
      kind: "personal_key" as const,
      userId: OWNER,
      organizationId: grant!.organizationId,
      scopes: ["records:read"],
      label: "x",
    };
    await service.recordCall({
      principal,
      tool: "labs",
      transport: "mcp",
      status: "ok",
      rowCount: 4,
    });
    const recent = await service.listRecentCalls({
      userId: OWNER,
      organizationId: grant!.organizationId,
      limit: 10,
    });
    expect(recent[0]).toMatchObject({ tool: "labs", transport: "mcp", status: "ok", rowCount: 4 });
    expect(Object.keys(recent[0]!).sort()).toEqual([
      "createdAt",
      "grantId",
      "rowCount",
      "status",
      "tool",
      "transport",
    ]);
    clock = new Date("2027-02-11T10:00:00.000Z");
    expect(await service.purgeExpiredCalls()).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(aiAppCall).where(eq(aiAppCall.grantId, grant!.id));
    expect(left).toHaveLength(0);
    clock = new Date("2026-11-12T10:00:00.000Z");
  });

  test("deleting the account removes every grant, key and call", async () => {
    await db.delete(user).where(eq(user.id, VIEWER));
    await db.delete(user).where(eq(user.id, OWNER));
    expect(await db.select().from(aiAppGrant)).toHaveLength(0);
    expect(await db.select().from(aiAppKey)).toHaveLength(0);
    expect(await db.select().from(aiAppCall)).toHaveLength(0);
  });
});
