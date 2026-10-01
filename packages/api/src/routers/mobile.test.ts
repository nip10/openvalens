import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import * as auditSecurity from "@openhealth/audit-security";
import * as authzGuard from "@openhealth/auth/authz/guard";
import * as ingestion from "@openhealth/ingestion";

import type { Context } from "../context";

// Snapshot exports before mocking so cleanup restores the real modules.
const actualIngestion = { ...ingestion };
const actualAuditSecurity = { ...auditSecurity };
const actualAuthzGuard = { ...authzGuard };
const { MobileDeviceNotRegisteredError, MobileDeviceRevokedError } = actualIngestion;

let role = "owner";
class AuthzHttpError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly status = 403;
}
const requirePermission = mock(
  async (_request: unknown, permission: { resource: string; action: string }) => {
    if (role === "viewer" && permission.action === "write") throw new AuthzHttpError();
    return { user: { id: "actor" }, activeOrganizationId: "org-a", member: { role }, role };
  },
);
mock.module("@openhealth/auth/authz/guard", () => ({
  ...actualAuthzGuard,
  AuthzHttpError,
  requirePermission,
}));

const audit = mock(async (_input: unknown) => {});
mock.module("@openhealth/audit-security", () => ({ ...actualAuditSecurity, writeAuditLog: audit }));

let ingestError: Error | null = null;
const registerMobileDevice = mock(async (_db: unknown, _input: Record<string, unknown>) => {
  if (ingestError) throw ingestError;
  return { providerConnectionId: 5 };
});
const ingestMobileBatch = mock(async (_db: unknown, _input: Record<string, unknown>) => {
  if (ingestError) throw ingestError;
  return {
    status: "applied" as const,
    jobId: 9,
    rawArtifactId: 42,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
  };
});
const getMobileSyncStatus = mock(async (_db: unknown, _input: Record<string, unknown>) => ({
  devices: [],
}));
mock.module("@openhealth/ingestion", () => ({
  ...actualIngestion,
  registerMobileDevice,
  ingestMobileBatch,
  getMobileSyncStatus,
}));

const { mobileRouter } = await import("./mobile");
const { appRouter } = await import("./index");

afterAll(() => {
  mock.module("@openhealth/ingestion", () => actualIngestion);
  mock.module("@openhealth/audit-security", () => actualAuditSecurity);
  mock.module("@openhealth/auth/authz/guard", () => actualAuthzGuard);
});

function context(): Context {
  return {
    session: { user: { id: "actor" } },
    db: {},
    correlationId: "corr-1",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as unknown as Context;
}

const DEVICE = "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11";
const batch = {
  schemaVersion: 1 as const,
  deviceId: DEVICE,
  provider: "health_connect" as const,
  recordType: "weight" as const,
  mode: "changes" as const,
  clientTimezone: "Europe/Lisbon",
  upserts: [
    {
      type: "weight" as const,
      externalRecordId: "w-1",
      sourceApp: null,
      startTime: "2026-10-01T07:00:00.000Z",
      valueKg: 72.4,
    },
  ],
  deletions: [],
};

beforeEach(() => {
  role = "owner";
  ingestError = null;
  for (const fn of [
    requirePermission,
    audit,
    registerMobileDevice,
    ingestMobileBatch,
    getMobileSyncStatus,
  ])
    fn.mockClear();
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "resolved";
}

test("mobile router mounts at appRouter.mobile", () => {
  expect(appRouter.mobile).toBe(mobileRouter);
});

test("registerDevice uses the session org, requires records:write and audits the connection", async () => {
  const result = await mobileRouter.registerDevice.callable({ context: context() })({
    deviceId: DEVICE,
    platform: "android",
    appVersion: "1.0.0",
  });
  expect(result).toEqual({ providerConnectionId: 5, targetId: "5" });
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "write" });
  expect(registerMobileDevice.mock.calls[0]?.[1]).toMatchObject({
    organizationId: "org-a",
    userId: "actor",
    deviceId: DEVICE,
    platform: "android",
  });
  expect(audit.mock.calls[0]?.[0]).toMatchObject({
    organizationId: "org-a",
    eventType: "RECORD_CREATED",
    targetType: "provider_connection",
    targetId: "5",
  });
});

test("ingestBatch passes the session org and correlation id, and audits the raw artifact", async () => {
  const result = await mobileRouter.ingestBatch.callable({ context: context() })(batch);
  expect(result).toEqual({
    status: "applied",
    rawArtifactId: 42,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    superseded: 0,
    targetId: "42",
  });
  expect(ingestMobileBatch.mock.calls[0]?.[1]).toMatchObject({
    organizationId: "org-a",
    traceId: "corr-1",
    batch: { deviceId: DEVICE, recordType: "weight" },
  });
  expect(audit.mock.calls[0]?.[0]).toMatchObject({
    eventType: "RECORD_CREATED",
    targetType: "ingestion_raw_artifact",
    targetId: "42",
  });
});

test("ingestBatch blocks another org's id as a tenant violation and audits the attempt", async () => {
  const call = mobileRouter.ingestBatch.callable({ context: context() });
  expect(await codeOf(call({ ...batch, organizationId: "org-b" } as typeof batch))).toBe(
    "TENANT_VIOLATION",
  );
  expect(audit.mock.calls[0]?.[0]).toMatchObject({ eventType: "TENANT_VIOLATION_BLOCKED" });
  expect(ingestMobileBatch).not.toHaveBeenCalled();
});

test("ingestBatch rejects any extra org or user field with INVALID_INPUT", async () => {
  const call = mobileRouter.ingestBatch.callable({ context: context() });
  expect(await codeOf(call({ ...batch, organizationId: "org-a" } as typeof batch))).toBe(
    "INVALID_INPUT",
  );
  expect(await codeOf(call({ ...batch, userId: "someone" } as typeof batch))).toBe("INVALID_INPUT");
  expect(ingestMobileBatch).not.toHaveBeenCalled();
});

test("unregistered and revoked devices get PERMISSION_DENIED and no audit entry", async () => {
  const call = mobileRouter.ingestBatch.callable({ context: context() });
  ingestError = new MobileDeviceNotRegisteredError();
  expect(await codeOf(call(batch))).toBe("PERMISSION_DENIED");
  ingestError = new MobileDeviceRevokedError();
  expect(await codeOf(call(batch))).toBe("PERMISSION_DENIED");
  expect(
    await codeOf(
      mobileRouter.registerDevice.callable({ context: context() })({
        deviceId: DEVICE,
        platform: "ios",
        appVersion: "1",
      }),
    ),
  ).toBe("PERMISSION_DENIED");
  expect(audit).not.toHaveBeenCalled();
});

test("unexpected domain errors become INTERNAL without leaking the message", async () => {
  ingestError = new Error("weight 72.4 kg for user@example.com");
  try {
    await mobileRouter.ingestBatch.callable({ context: context() })(batch);
    throw new Error("expected failure");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("INTERNAL");
    expect((error as Error).message).not.toContain("72.4");
  }
});

test("viewers cannot ingest", async () => {
  role = "viewer";
  expect(await codeOf(mobileRouter.ingestBatch.callable({ context: context() })(batch))).toBe(
    "PERMISSION_DENIED",
  );
  expect(ingestMobileBatch).not.toHaveBeenCalled();
});

test("syncStatus requires records:read and is scoped to the session org", async () => {
  role = "viewer";
  expect(await mobileRouter.syncStatus.callable({ context: context() })({})).toEqual({
    devices: [],
  });
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  expect(getMobileSyncStatus.mock.calls[0]?.[1]).toEqual({ organizationId: "org-a" });
});
