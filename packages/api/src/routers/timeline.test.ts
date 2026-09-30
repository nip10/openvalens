import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Context } from "../context";
import { ProvenanceReferenceError, SourcePreferenceValidationError } from "@openhealth/health-record/repository";
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
const listMetrics = mock(async (_org: string) => [
  {
    id: 1,
    code: "weight",
    displayName: "Weight",
    category: "body",
    unit: "kg",
    valueType: "number",
    aggregationDefault: "latest",
    isActive: true,
    canonicalMetricCode: "weight",
    isBloodMarkerFamily: false,
    taxonomy: {
      code: "weight",
      displayName: "Weight",
      category: "body",
      unit: "kg",
      valueType: "number",
      aggregationDefault: "latest",
      supportedSources: ["watch", "phone", "scale"],
      hasDefaultPriority: true,
    },
  },
]);
const listSourcePriority = mock(async (_org: string, _user: string) => [
  {
    metricCode: "weight",
    canonicalMetricCode: "weight",
    isBloodMarkerFamily: false,
    manualOverride: null,
    familyHistoryEntry: null,
    defaultOrder: ["phone", "watch", "scale"],
    effectiveOrder: ["phone", "watch", "scale"],
    rule: "source_priority_then_quality_then_recency",
    reason: "default_order",
  },
]);
const upsertSourcePreference = mock(async (input: {
  organizationId: string;
  userId: string;
  metricCode: string;
  preferredSources: readonly string[];
}) => ({
  id: 7,
  metricCode: input.metricCode,
  userId: input.userId,
  preferredSources: [...input.preferredSources],
  scope: "user" as const,
  updatedAt: "2026-09-30T00:00:00Z",
}));
const deleteSourcePreference = mock(
  async (_input: { organizationId: string; userId: string; metricCode: string }) => ({
    removed: true,
    ids: [42],
  }),
);
const audit = mock(async (_input: unknown) => {});

// Resolve the real export graph before replacing it: importing from inside an
// async factory can deadlock when another router has already loaded the barrel.
mock.module("@openhealth/audit-security", () => ({
  ...actualAuditSecurity,
  writeAuditLog: audit,
  assertTenantBoundary: mock(),
  TenantViolationError: class extends Error {},
}));
mock.module("@openhealth/health-record", () => {
  return {
    ...actualHealthRecord,
    ProvenanceReferenceError,
    SourcePreferenceValidationError,
    PROVENANCE_TABLES: ["health_event", "metric_sample", "ingestion_raw_artifact"],
    createHealthRecordRepository: () => ({
      listTimeline: list,
      listChangesSinceReview: changes,
      writeProvenanceLink: write,
      listMetrics,
      listSourcePriority,
      upsertSourcePreference,
      deleteSourcePreference,
    }),
  };
});
const { timelineRouter } = await import("./timeline");
const { appRouter } = await import("./index");
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
  listMetrics.mockClear();
  listSourcePriority.mockClear();
  upsertSourcePreference.mockClear();
  deleteSourcePreference.mockClear();
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

// ---- Issue #17 bounded read-side: metric catalog + source priority procedures ----

test("listMetrics is mounted at appRouter.timeline.listMetrics and reads records:read for the active org", async () => {
  expect(appRouter.timeline.listMetrics).toBe(timelineRouter.listMetrics);
  const rows = await timelineRouter.listMetrics.callable({ context: context() })(undefined);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    code: "weight",
    canonicalMetricCode: "weight",
    isBloodMarkerFamily: false,
  });
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  expect(listMetrics.mock.calls[0]?.[0]).toBe("org-a");
  expect(audit).not.toHaveBeenCalled();
});

test("listSourcePriority reads records:read and resolves the active user's priorities", async () => {
  const rows = await timelineRouter.listSourcePriority.callable({ context: context() })(undefined);
  expect(rows[0]?.metricCode).toBe("weight");
  expect(rows[0]?.effectiveOrder).toEqual(["phone", "watch", "scale"]);
  expect(rows[0]?.reason).toBe("default_order");
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  expect(listSourcePriority.mock.calls[0]).toEqual(["org-a", "actor"]);
  expect(audit).not.toHaveBeenCalled();
});

test("unauthenticated requests cannot list metrics or source priority", async () => {
  await expect(
    timelineRouter.listMetrics.callable({ context: context(false) })(undefined),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    timelineRouter.listSourcePriority.callable({ context: context(false) })(undefined),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(requirePermission).not.toHaveBeenCalled();
});

test("non-member viewer is denied records:read for the new read procedures", async () => {
  role = "no-member";
  await expect(
    timelineRouter.listMetrics.callable({ context: context() })(undefined),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    timelineRouter.listSourcePriority.callable({ context: context() })(undefined),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(listMetrics).not.toHaveBeenCalled();
  expect(listSourcePriority).not.toHaveBeenCalled();
});

test("upsertSourcePreference derives org/user from authz, audits once, never logs payload", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const result = await timelineRouter.upsertSourcePreference.callable({ context: context() })({
      metricCode: "weight",
      preferredSources: ["phone", "watch"],
    });
    expect(upsertSourcePreference.mock.calls[0]).toEqual([
      { organizationId: "org-a", userId: "actor", metricCode: "weight", preferredSources: ["phone", "watch"] },
    ]);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "actor",
      eventType: "RECORD_CREATED",
      targetType: "source_preference",
      targetId: "7",
      metadata: { resource: "records", action: "write", metricCode: "weight" },
    });
    expect(result.targetId).toBe("7");
    expect(result.scope).toBe("user");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("deleteSourcePreference audits once with targetType source_preference_delete", async () => {
  const result = await timelineRouter.deleteSourcePreference.callable({ context: context() })({
    metricCode: "resting_heart_rate",
  });
  expect(deleteSourcePreference.mock.calls[0]).toEqual([
    { organizationId: "org-a", userId: "actor", metricCode: "resting_heart_rate" },
  ]);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0]?.[0]).toMatchObject({
    organizationId: "org-a",
    actorUserId: "actor",
    eventType: "RECORD_DELETED",
    targetType: "source_preference_delete",
    metadata: { resource: "records", action: "write", metricCode: "resting_heart_rate", removed: true },
  });
  expect(result.removed).toBe(true);
  expect(result.removedIds).toEqual([42]);
  expect(result.targetId).toBe("42");
});

test("strict source-preference upsert rejects org/user overrides and bad inputs", async () => {
  const call = timelineRouter.upsertSourcePreference.callable({ context: context() });
  for (const input of [
    { metricCode: "weight", preferredSources: ["phone"], organizationId: "org-b" },
    { metricCode: "weight", preferredSources: ["phone"], userId: "victim" },
    { metricCode: "weight", preferredSources: [], metadataJson: { private: "PRIVATE" } },
    { metricCode: "weight", preferredSources: ["phone"], format: "csv" },
    { metricCode: "PRIVATE", preferredSources: ["phone"] },
    { metricCode: "weight", preferredSources: ["phone", "phone", "phone", "phone", "phone", "phone", "phone", "phone", "phone"] },
    { metricCode: "weight" },
    { metricCode: "weight", preferredSources: [123] },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(upsertSourcePreference).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("viewer role is denied records:write for source-preference upsert/delete", async () => {
  role = "viewer";
  await expect(
    timelineRouter.upsertSourcePreference.callable({ context: context() })({
      metricCode: "weight",
      preferredSources: ["phone", "watch"],
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    timelineRouter.deleteSourcePreference.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(upsertSourcePreference).not.toHaveBeenCalled();
  expect(deleteSourcePreference).not.toHaveBeenCalled();
});

test("upsert validation failure surfaces as NOT_FOUND without audit", async () => {
  upsertSourcePreference.mockRejectedValueOnce(new SourcePreferenceValidationError("metric_not_found"));
  await expect(
    timelineRouter.upsertSourcePreference.callable({ context: context() })({
      metricCode: "blood_marker_glucose",
      preferredSources: ["lab_x", "phone"],
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});