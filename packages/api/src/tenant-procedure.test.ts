import { describe, expect, mock, test } from "bun:test";
import type { Database } from "@openhealth/db";
import { z } from "zod";

import type { Context } from "./context";

const ORG_ID = "org-1";

const requirePermission = mock(async () => ({
  user: { id: "user-1", email: "user@example.com", name: null },
  session: {
    id: "session-1",
    userId: "user-1",
    activeOrganizationId: ORG_ID,
    expiresAt: null,
  },
  activeOrganizationId: ORG_ID,
  member: { id: "member-1", userId: "user-1", organizationId: ORG_ID, role: "owner" },
  role: "owner",
}));

// Stub the authz guard so the tenant/audit behaviour can be exercised without a
// live Better Auth instance. `mock.module` must run before `./index` is loaded.
mock.module("@openhealth/auth/authz/guard", () => ({
  AuthzHttpError: class AuthzHttpError extends Error {
    readonly status = 403;
    readonly code = "PERMISSION_DENIED";
  },
  requirePermission,
  requireSession: mock(),
  requireOrgMembership: mock(),
}));

const { tenantScopedProcedure } = await import("./index");

const tenantInput = z.object({
  organizationId: z.string().optional(),
  message: z.string(),
});

type CapturedInsert = Record<string, unknown>;

function createMockDb(): { db: Database; inserts: CapturedInsert[] } {
  const inserts: CapturedInsert[] = [];
  const db = {
    insert: () => ({
      values: (payload: CapturedInsert) => {
        inserts.push(payload);
        return { returning: async () => [{ id: inserts.length }] };
      },
    }),
  } as unknown as Database;
  return { db, inserts };
}

function createContext(db: Database): Context {
  return {
    session: { user: { id: "user-1" } },
    db,
    correlationId: "corr-1",
    cronSecret: "test-cron-secret",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

function tenantProcedure() {
  return tenantScopedProcedure({
    resource: "records",
    action: "read",
    auditAction: "RECORD_CREATED",
    targetType: "record",
  }).input(tenantInput);
}

describe("tenantScopedProcedure", () => {
  test("writes an audit entry with the extracted targetId on success", async () => {
    const { db, inserts } = createMockDb();
    const procedure = tenantProcedure().handler(({ input }) => ({
      message: input.message,
      targetId: "demo-target-1",
    }));

    const result = await procedure.callable({ context: createContext(db) })({
      organizationId: ORG_ID,
      message: "hi",
    });

    expect(result).toEqual({ message: "hi", targetId: "demo-target-1" });
    expect(inserts).toHaveLength(1);

    const payload = inserts[0];
    expect(payload?.organizationId).toBe(ORG_ID);
    expect(payload?.actorUserId).toBe("user-1");
    expect(payload?.eventType).toBe("RECORD_CREATED");
    expect(payload?.targetType).toBe("record");
    expect(payload?.targetId).toBe("demo-target-1");
    expect(payload?.afterJson).toMatchObject({ correlationId: "corr-1" });
  });

  test("rejects cross-tenant calls with TENANT_VIOLATION and audits the block", async () => {
    const { db, inserts } = createMockDb();
    const procedure = tenantProcedure().handler(({ input }) => ({ message: input.message }));

    await expect(
      procedure.callable({ context: createContext(db) })({
        organizationId: "org-2",
        message: "hi",
      }),
    ).rejects.toMatchObject({ code: "TENANT_VIOLATION", status: 403 });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.eventType).toBe("TENANT_VIOLATION_BLOCKED");
    expect(inserts[0]?.organizationId).toBe(ORG_ID);
    expect(inserts[0]?.targetId).toBe("org-2");
  });

  test("passes when the input carries no target organization", async () => {
    const { db, inserts } = createMockDb();
    const procedure = tenantProcedure().handler(({ input }) => ({ message: input.message }));

    const result = await procedure.callable({ context: createContext(db) })({ message: "hi" });

    expect(result).toEqual({ message: "hi" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.eventType).toBe("RECORD_CREATED");
  });

  test("does not write an audit entry when the handler throws", async () => {
    const { db, inserts } = createMockDb();
    const procedure = tenantProcedure().handler(() => {
      throw new Error("handler boom");
    });

    await expect(
      procedure.callable({ context: createContext(db) })({ message: "hi" }),
    ).rejects.toThrow();

    expect(inserts).toHaveLength(0);
  });
});
