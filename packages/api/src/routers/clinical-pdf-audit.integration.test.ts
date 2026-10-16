import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { ROLE_PERMISSION_PRESETS, isRole } from "@openvalens/auth/access/roles";
import type { Action, Resource } from "@openvalens/auth/access/permissions";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";
import { extractText, getDocumentProxy } from "unpdf";

import type { Context } from "../context";
import { appRouter } from "./index";

/**
 * Issue #132 — `exports.clinicalPdf` and `audit.timeline` over HTTP (oRPC
 * `RPCHandler`) against a disposable PostgreSQL: the generated PDF is parsed
 * and checked for tenant isolation and copy; the PDF is never persisted; the
 * audit timeline is tenant-scoped, permissioned, filterable and value-free.
 * Permissions are evaluated with the real role presets. All data is synthetic.
 */

const url = process.env.CLINICAL_PDF_AUDIT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/clinical_pdf_audit_test"
  )
    throw new Error("Empty disposable loopback clinical_pdf_audit_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** org-a: owner A, collaborator C, viewer V. org-b: owner B. N has no membership. */
const MEMBERS: Record<string, { org: string; role: string } | null> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-c": { org: "org-a", role: "collaborator" },
  "user-v": { org: "org-a", role: "viewer" },
  "user-b": { org: "org-b", role: "owner" },
  "user-n": null,
};

function actorOf(headers: Headers): string | null {
  return headers.get("x-test-user");
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      if (!id) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]?.org ?? null,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      const membership = id ? MEMBERS[id] : null;
      if (!id || !membership) return null;
      return { id: `m-${id}`, userId: id, organizationId: membership.org, role: membership.role };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      const membership = id ? MEMBERS[id] : null;
      return membership ? { role: membership.role } : null;
    },
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const id = actorOf(headers);
      const role = id ? MEMBERS[id]?.role : undefined;
      if (!role || !isRole(role)) return { success: false };
      const matrix = ROLE_PERMISSION_PRESETS[role];
      const success = Object.entries(body.permissions).every(([resource, actions]) =>
        actions.every((action) => matrix[resource as Resource]?.[action as Action] === true),
      );
      return { success };
    },
  },
} as unknown as Auth;

type RpcError = { code: string; status: number; message: string };

describe.skipIf(!url)("clinical PDF and audit timeline over HTTP against PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/clinical_pdf_audit_test" });
  const rpc = new RPCHandler(appRouter);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: id
        ? { user: { id }, session: { activeOrganizationId: MEMBERS[id]?.org ?? null } }
        : null,
      db,
      correlationId: "corr-132",
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    path: string,
    input: unknown,
    user: string | null = "user-a",
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", ...extraHeaders });
    if (user) headers.set("x-test-user", user);
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
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  type PdfOutput = {
    fileName: string;
    contentType: string;
    contentBase64: string;
    byteLength: number;
    pageCount: number;
    selectedDomains: string[];
  };

  async function pdfText(output: PdfOutput): Promise<string> {
    const bytes = new Uint8Array(Buffer.from(output.contentBase64, "base64"));
    expect(bytes.byteLength).toBe(output.byteLength);
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/\s+/g, " ");
  }

  type TimelineOutput = {
    entries: {
      id: number;
      occurredAt: string;
      eventType: string;
      targetType: string | null;
      targetId: string | null;
      actorUserId: string | null;
      details: Record<string, unknown>;
      redacted: boolean;
    }[];
    nextCursor: { occurredAt: string; id: number } | null;
    viewerUserId: string;
  };

  const count = async (table: string, where = "true") =>
    Number(
      (
        (await db.execute(sql.raw(`select count(*)::int as n from ${table} where ${where}`)))
          .rows[0] as { n: number }
      ).n,
    );

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values
        ('user-a', 'a@example.test'), ('user-c', 'c@example.test'), ('user-v', 'v@example.test'),
        ('user-b', 'b@example.test'), ('user-n', 'n@example.test');
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b');
      insert into member (id, organization_id, user_id, role) values
        ('m-user-a', 'org-a', 'user-a', 'owner'), ('m-user-c', 'org-a', 'user-c', 'collaborator'),
        ('m-user-v', 'org-a', 'user-v', 'viewer'), ('m-user-b', 'org-b', 'user-b', 'owner');
      insert into blood_panel (id, organization_id, date, facility, created_at) values
        (101, 'org-a', '2026-03-02', 'Example Lab North', '2026-03-02T09:00:00.000Z'),
        (201, 'org-b', '2026-03-03', 'PRIVATE org-b facility', '2026-03-03T09:00:00.000Z');
      insert into blood_marker (organization_id, panel_id, category, test_name, test_key,
          value_numeric, value_text, unit, ref_range_text, flag) values
        ('org-a', 101, 'Synthetic', 'Synthetic marker A', 'synthetic_a', 5.4, null, 'mmol/L', '3.9-5.5', 'HIGH'),
        ('org-b', 201, 'Synthetic', 'PRIVATE org-b marker', 'synthetic_b', 9.9, null, 'mg/dL', null, null);
      insert into medication (organization_id, user_id, name, dose, frequency, status) values
        ('org-a', 'user-a', 'Synthetic medication A', '10 mg', 'daily', 'active'),
        ('org-b', 'user-b', 'PRIVATE org-b medication', '1 mg', 'daily', 'active');
      insert into access_audit_log (organization_id, actor_user_id, event_type, target_type, target_id,
          before_json, after_json, created_at) values
        ('org-a', 'user-a', 'RECORD_CREATED', 'blood_panel', '101', null,
          '{"after":{"testName":"Synthetic marker A","valueNumeric":5.4},"metadata":{"resource":"blood","action":"write","metricCode":"synthetic_secret_code"},"ipAddress":"192.0.2.10","userAgent":"SyntheticAgent/1.0"}',
          '2026-01-10T09:00:00.000Z'),
        ('org-a', 'user-c', 'RECORD_UPDATED', 'medication', '7',
          '{"name":"Synthetic medication A","dose":"5 mg"}',
          '{"after":{"dose":"10 mg"},"metadata":{"resource":"medications","action":"write"}}',
          '2026-02-15T12:00:00.000Z'),
        ('org-a', 'user-a', 'MEMBER_INVITED', 'invitation', 'inv-1', null,
          '{"metadata":{"role":"viewer"}}', '2026-02-20T08:00:00.000Z'),
        ('org-b', 'user-b', 'RECORD_CREATED', 'blood_panel', '201', null,
          '{"after":{"testName":"PRIVATE org-b marker"}}', '2026-02-01T10:00:00.000Z');
    `),
    );
    setRegisteredAuth(fakeAuth);
  });

  afterAll(() => clearRegisteredAuth());

  test("owner downloads a real PDF with only their workspace's records", async () => {
    const before = await count("access_audit_log", "event_type = 'EXPORT_GENERATED'");
    const { status, body } = await call<PdfOutput>("exports/clinicalPdf", {
      domains: ["blood", "medications"],
    });
    expect(status).toBe(200);
    expect(body.contentType).toBe("application/pdf");
    expect(body.fileName).toMatch(/^health-record-summary-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(body.selectedDomains).toEqual(["blood", "medications"]);

    const text = await pdfText(body);
    expect(text).toContain("Health record summary");
    expect(text).toContain("Synthetic marker A");
    expect(text).toContain("mmol/L");
    expect(text).toContain("3.9-5.5");
    expect(text).toContain("Example Lab North");
    expect(text).toContain("2026-03-02");
    expect(text).toContain("Synthetic medication A");
    expect(text).toContain("not a medical device");
    expect(text).not.toContain("PRIVATE org-b");
    expect(text).not.toMatch(/\bHIGH\b/);

    // One value-free audit row for the export.
    expect(await count("access_audit_log", "event_type = 'EXPORT_GENERATED'")).toBe(before + 1);
    const audit = (
      await db.execute(
        sql`select organization_id, actor_user_id, after_json::text as after from access_audit_log where event_type = 'EXPORT_GENERATED' order by id desc limit 1`,
      )
    ).rows[0] as { organization_id: string; actor_user_id: string; after: string };
    expect(audit.organization_id).toBe("org-a");
    expect(audit.actor_user_id).toBe("user-a");
    expect(audit.after).toContain('"format": "pdf"');
    expect(audit.after).not.toContain("Synthetic marker");
  });

  test("the other workspace's owner gets only their own records", async () => {
    const { status, body } = await call<PdfOutput>("exports/clinicalPdf", {}, "user-b");
    expect(status).toBe(200);
    const text = await pdfText(body);
    expect(text).toContain("PRIVATE org-b marker");
    expect(text).not.toContain("Synthetic marker A");
    expect(text).not.toContain("Example Lab North");
  });

  test("the PDF is transient: nothing is stored and nothing is logged", async () => {
    const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      const { status } = await call<PdfOutput>("exports/clinicalPdf", {}, "user-v");
      expect(status).toBe(200);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
    expect(await count("stored_object")).toBe(0);
  });

  test("PDF export is denied without a session or membership and rejects overrides", async () => {
    const before = await count("access_audit_log", "event_type = 'EXPORT_GENERATED'");
    const anonymous = await call<RpcError>("exports/clinicalPdf", {}, null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe("UNAUTHENTICATED");

    const noMembership = await call<RpcError>("exports/clinicalPdf", {}, "user-n");
    expect(noMembership.status).toBe(403);

    for (const input of [
      { domains: ["audit"] },
      { domains: ["insights"] },
      { domains: ["blood", "not-a-domain"] },
      { domains: [] },
      { organizationId: "org-b" },
      { format: "html" },
    ]) {
      const rejected = await call<RpcError>("exports/clinicalPdf", input);
      expect(rejected.body.code).toBe("INVALID_INPUT");
    }
    const header = await call<RpcError>("exports/clinicalPdf", {}, "user-a", {
      "x-organization-id": "org-b",
    });
    expect(header.body.code).toBe("INVALID_INPUT");
    expect(await count("access_audit_log", "event_type = 'EXPORT_GENERATED'")).toBe(before);
  });

  test("audit timeline is tenant-scoped and returns events, not values", async () => {
    const { status, body } = await call<TimelineOutput>("audit/timeline", {});
    expect(status).toBe(200);
    expect(body.viewerUserId).toBe("user-a");
    expect(body.entries.length).toBeGreaterThanOrEqual(3);
    // Newest first.
    const times = body.entries.map((entry) => entry.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);

    const serialized = JSON.stringify(body);
    for (const leaked of [
      "org-b",
      "PRIVATE",
      "Synthetic marker A",
      "5.4",
      "5 mg",
      "10 mg",
      "synthetic_secret_code",
      "192.0.2.10",
      "SyntheticAgent",
      '"role"',
    ]) {
      expect(serialized).not.toContain(leaked);
    }

    const created = body.entries.find((entry) => entry.eventType === "RECORD_CREATED");
    expect(created).toMatchObject({
      targetType: "blood_panel",
      targetId: "101",
      actorUserId: "user-a",
      details: { resource: "blood", action: "write" },
    });

    const other = await call<TimelineOutput>("audit/timeline", {}, "user-b");
    expect(other.status).toBe(200);
    const otherTargets = other.body.entries.map((entry) => entry.targetId);
    expect(otherTargets).toContain("201");
    expect(otherTargets).not.toContain("101");
    expect(JSON.stringify(other.body)).not.toContain("user-a");
  });

  test("audit timeline filters by event type, target, actor and date range", async () => {
    const byType = await call<TimelineOutput>("audit/timeline", { eventTypes: ["RECORD_UPDATED"] });
    expect(byType.body.entries.map((entry) => entry.targetType)).toEqual(["medication"]);

    const byTarget = await call<TimelineOutput>("audit/timeline", { targetTypes: ["invitation"] });
    expect(byTarget.body.entries.map((entry) => entry.eventType)).toEqual(["MEMBER_INVITED"]);

    const byActor = await call<TimelineOutput>("audit/timeline", { actorUserId: "user-c" });
    expect(byActor.body.entries.map((entry) => entry.eventType)).toEqual(["RECORD_UPDATED"]);

    const byDates = await call<TimelineOutput>("audit/timeline", {
      fromDate: "2026-02-01",
      toDate: "2026-02-15",
    });
    expect(byDates.body.entries.map((entry) => entry.eventType)).toEqual(["RECORD_UPDATED"]);

    const first = await call<TimelineOutput>("audit/timeline", { limit: 1 });
    expect(first.body.entries).toHaveLength(1);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await call<TimelineOutput>("audit/timeline", {
      limit: 1,
      cursor: first.body.nextCursor,
    });
    expect(second.body.entries).toHaveLength(1);
    expect(second.body.entries[0]!.id).not.toBe(first.body.entries[0]!.id);

    for (const input of [
      { fromDate: "2026-03-01", toDate: "2026-02-01" },
      { fromDate: "yesterday" },
      { eventTypes: ["NOT_AN_EVENT"] },
      { organizationId: "org-b" },
      { limit: 1000 },
    ]) {
      const rejected = await call<RpcError>("audit/timeline", input);
      expect(rejected.body.code).toBe("INVALID_INPUT");
    }
  });

  test("audit timeline is denied to collaborators, viewers, non-members and anonymous callers", async () => {
    for (const user of ["user-c", "user-v"]) {
      const denied = await call<RpcError>("audit/timeline", {}, user);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("PERMISSION_DENIED");
    }
    const noMembership = await call<RpcError>("audit/timeline", {}, "user-n");
    expect(noMembership.status).toBe(403);
    const anonymous = await call<RpcError>("audit/timeline", {}, null);
    expect(anonymous.status).toBe(401);
    const header = await call<RpcError>("audit/timeline", {}, "user-a", {
      "x-organization-id": "org-b",
    });
    expect(header.body.code).toBe("INVALID_INPUT");
  });
});
