import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Context } from "../context";
import { ProvenanceReferenceError } from "@openhealth/health-record/repository";
import * as healthRecord from "@openhealth/health-record";
import * as auditSecurity from "@openhealth/audit-security";
import * as authzGuard from "@openhealth/auth/authz/guard";

// Module mocks persist across files, and their namespace bindings are live.
// Snapshot exports before mocking so cleanup cannot capture our replacements.
const actualHealthRecord = { ...healthRecord };
const actualAuditSecurity = { ...auditSecurity };
const actualAuthzGuard = { ...authzGuard };

let role = "owner";
class AuthzHttpError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly status = 403;
}
const requirePermission = mock(
  async (_request: unknown, permission: { resource: string; action: string }) => {
    if (role === "viewer" && permission.action === "write") throw new AuthzHttpError();
    if (role === "no-member") throw new AuthzHttpError();
    return { user: { id: "actor" }, activeOrganizationId: "org-a", member: { role }, role };
  },
);
mock.module("@openhealth/auth/authz/guard", () => ({
  ...actualAuthzGuard,
  AuthzHttpError,
  requirePermission,
}));
const list = mock(async (_org: string, _filters: unknown) => ({ items: [], nextCursor: null }));
const changes = mock(async (_org: string, _options: unknown) => ({ items: [] }));
const write = mock(async (_link: unknown) => ({ id: 1, createdAt: "2026-09-30T00:00:00Z" }));
const audit = mock(async (_input: unknown) => {});
mock.module("@openhealth/audit-security", () => ({
  ...actualAuditSecurity,
  writeAuditLog: audit,
  assertTenantBoundary: mock(),
  TenantViolationError: class extends Error {},
}));
// Resolve the real export graph before replacing it: importing from inside an
// async factory can deadlock when another router has already loaded the barrel.
mock.module("@openhealth/health-record", () => {
  return {
    ...actualHealthRecord,
    ProvenanceReferenceError,
    PROVENANCE_TABLES: ["health_event", "metric_sample", "ingestion_raw_artifact"],
    createHealthRecordRepository: () => ({
      listTimeline: list,
      listChangesSinceReview: changes,
      writeProvenanceLink: write,
    }),
  };
});
const { timelineRouter } = await import("./timeline");
afterAll(() => {
  mock.module("@openhealth/health-record", () => actualHealthRecord);
  mock.module("@openhealth/audit-security", () => actualAuditSecurity);
  mock.module("@openhealth/auth/authz/guard", () => actualAuthzGuard);
});
function context(authenticated = true): Context {
  return {
    session: authenticated ? { user: { id: "actor" } } : null,
    correlationId: "test",
    honoContext: { req: { raw: { headers: new Headers() } } },
  } as Context;
}
beforeEach(() => {
  role = "owner";
  requirePermission.mockClear();
  list.mockClear();
  changes.mockClear();
  write.mockClear();
  audit.mockClear();
});
test("reads require records:read and use only active authz org", async () => {
  await timelineRouter.list.callable({ context: context() })({
    source: "manual",
    from: "2026-09-01",
    limit: 1,
  });
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  expect(list.mock.calls[0]?.[0]).toBe("org-a");
  await timelineRouter.changesSinceReview.callable({ context: context() })({ limit: 5 });
  expect(changes.mock.calls[0]).toEqual(["org-a", { limit: 5 }]);
  expect(audit).not.toHaveBeenCalled();
});
test("domain cursors retain records:read authority and accept only migrated record kinds", async () => {
  for (const table of [
    "consultation",
    "imaging_study",
    "cardiac_exam",
    "weekly_review",
    "insight",
    "scheduled_event",
    "daily_reminder",
  ]) {
    const cursor = `2026-09-29T00:00:00.000Z|${table}:1`;
    await timelineRouter.list.callable({ context: context() })({ cursor, limit: 1 });
    expect(list.mock.calls.at(-1)).toEqual(["org-a", { cursor, limit: 1 }]);
    expect(requirePermission.mock.calls.at(-1)?.[1]).toEqual({
      resource: "records",
      action: "read",
    });
  }
  await expect(
    timelineRouter.list.callable({ context: context() })({
      cursor: "2026-09-29T00:00:00.000Z|medication_change:1",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(audit).not.toHaveBeenCalled();
});
test("unauthenticated and unauthorized writes do not reach repository or audit", async () => {
  const input = {
    targetTable: "health_event" as const,
    targetId: 1,
    sourceTable: "metric_sample" as const,
    sourceId: 2,
    relation: "derived_from" as const,
  };
  await expect(timelineRouter.list.callable({ context: context(false) })({})).rejects.toMatchObject(
    { code: "UNAUTHENTICATED" },
  );
  for (const denied of ["viewer", "no-member"]) {
    role = denied;
    await expect(
      timelineRouter.writeProvenanceLink.callable({ context: context() })(input),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  }
  expect(write).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
test("strict inputs reject org/user/metadata overrides and invalid boundaries", async () => {
  const call = timelineRouter.list.callable({ context: context() });
  for (const input of [
    { organizationId: "org-b" },
    { userId: "victim" },
    { from: "2026-02-30" },
    { from: "2026-09-30", to: "2026-09-01" },
    { cursor: "bad" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const base = {
    targetTable: "health_event",
    targetId: 1,
    sourceTable: "metric_sample",
    sourceId: 2,
    relation: "derived_from",
  };
  for (const extra of [
    { organizationId: "org-b" },
    { userId: "victim" },
    { metadataJson: { private: "PRIVATE" } },
    { targetTable: "preferred_health_event" },
  ])
    await expect(
      timelineRouter.writeProvenanceLink.callable({ context: context() })({
        ...base,
        ...extra,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(write).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});
test("successful writer audits exactly once, identity authz derived, no PHI logs", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const input = {
      targetTable: "health_event" as const,
      targetId: 1,
      sourceTable: "metric_sample" as const,
      sourceId: 2,
      relation: "derived_from" as const,
    };
    await timelineRouter.writeProvenanceLink.callable({ context: context() })(input);
    expect(write.mock.calls[0]?.[0]).toEqual({ ...input, organizationId: "org-a" });
    expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "write" });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "actor",
      eventType: "RECORD_CREATED",
      targetType: "provenance_link",
      targetId: "1",
    });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});
test("tenant reference rejection never audits success or leaks internal payload", async () => {
  write.mockRejectedValueOnce(new ProvenanceReferenceError());
  await expect(
    timelineRouter.writeProvenanceLink.callable({ context: context() })({
      targetTable: "health_event",
      targetId: 1,
      sourceTable: "metric_sample",
      sourceId: 999,
      relation: "derived_from",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});
