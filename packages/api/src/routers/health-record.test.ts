import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Context } from "../context";
import { CanonicalMetricNotFoundError, CrossTenantReferenceError } from "@openvalens/health-record";
import * as healthRecord from "@openvalens/health-record";
import * as auditSecurity from "@openvalens/audit-security";
import * as authzGuard from "@openvalens/auth/authz/guard";

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
mock.module("@openvalens/auth/authz/guard", () => ({
  ...actualAuthzGuard,
  AuthzHttpError,
  requirePermission,
}));

const resolveCanonicalMetric = mock(async (_org: string, metricCode: string) => ({
  resolved: {
    canonicalMetricCode: metricCode === "weight" ? "weight" : "blood_marker_glucose",
    displayName: metricCode === "weight" ? "Weight" : "Glucose",
    category: metricCode === "weight" ? "body" : "labs",
    unit: metricCode === "weight" ? "kg" : "varies",
    valueType: "number" as const,
    aggregationDefault: "latest" as const,
    isBloodMarkerFamily: metricCode !== "weight",
  },
  tenant:
    metricCode === "weight"
      ? {
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
        }
      : null,
}));

const ingestMetricDefinition = mock(
  async (input: {
    organizationId: string;
    payload: { metricCode: string; displayName?: string | null; sourceId?: number | null };
  }) => ({
    id: 42,
    code: input.payload.metricCode,
    displayName: input.payload.displayName ?? "Weight",
    category: "body",
    unit: "kg",
    valueType: "number",
    aggregationDefault: "latest",
    isActive: true,
    canonicalMetricCode: input.payload.metricCode,
    isBloodMarkerFamily: false,
    taxonomy: {
      canonicalMetricCode: input.payload.metricCode,
      displayName: "Weight",
      category: "body",
      unit: "kg",
      valueType: "number",
      aggregationDefault: "latest",
      isBloodMarkerFamily: false,
    },
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  }),
);

const ingestMetricSample = mock(
  async (input: {
    organizationId: string;
    userId: string;
    payload: {
      metricCode: string;
      observedAt: string;
      valueNumeric?: number | null;
      valueString?: string | null;
    };
  }) => ({
    id: 7,
    organizationId: input.organizationId,
    metricDefinitionId: 1,
    dataSourceId: null,
    sampledAt: "2026-09-29T12:00:00.000Z",
    numericValue: input.payload.valueNumeric ?? null,
    textValue: input.payload.valueString ?? null,
    unit: "kg",
    externalSampleId: null,
    dedupeHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
    createdAt: "2026-09-30T00:00:00.000Z",
    canonicalMetricCode: input.payload.metricCode,
    taxonomyUnit: "kg",
    ingestQualityFlags: [] as string[],
  }),
);

const ingestWriteIngestionJob = mock(
  async (input: { organizationId: string; payload: { jobType: string } }) => ({
    id: 99,
    organizationId: input.organizationId,
    jobType: input.payload.jobType,
    status: "queued",
    triggeredBy: "api",
    providerConnectionId: null,
    idempotencyKey: null,
    windowStart: null,
    windowEnd: null,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  }),
);

const getMetricRetentionPolicy = mock(
  async (input: { organizationId: string; metricCode: string }) => ({
    metricCode: input.metricCode,
    canonicalMetricCode: input.metricCode === "weight" ? "weight" : "blood_marker_glucose",
    isBloodMarkerFamily: input.metricCode !== "weight",
    retentionDays: null,
    timezone: "UTC",
    category: input.metricCode === "weight" ? "body" : "labs",
    unit: input.metricCode === "weight" ? "kg" : "varies",
  }),
);

const pruneMetricSamples = mock(
  async (input: {
    organizationId: string;
    metricCode: string;
    now: Date;
    retentionDays?: number;
    timezone?: string;
  }) => ({
    deletedCount: 4,
    fromUtc: "2025-09-30T12:00:00.000Z",
    toUtc: "2026-09-30T12:00:00.000Z",
    retentionDays: input.retentionDays ?? 365,
    canonicalMetricCode: input.metricCode === "weight" ? "weight" : "blood_marker_glucose",
  }),
);

const applyDedupeForMetric = mock(
  async (input: { organizationId: string; metricCode: string; now: Date }) => ({
    removedDuplicates: 3,
    canonicalMetricCode: input.metricCode === "weight" ? "weight" : "blood_marker_glucose",
  }),
);

const audit = mock(async (_input: unknown) => {});

mock.module("@openvalens/audit-security", () => ({
  ...actualAuditSecurity,
  writeAuditLog: audit,
  assertTenantBoundary: mock(),
  TenantViolationError: class extends Error {},
}));
mock.module("@openvalens/health-record", () => ({
  ...actualHealthRecord,
  CanonicalMetricNotFoundError,
  CrossTenantReferenceError,
  createHealthRecordRepository: () => ({
    resolveCanonicalMetric,
    ingestMetricDefinition,
    ingestMetricSample,
    ingestWriteIngestionJob,
    getMetricRetentionPolicy,
    pruneMetricSamples,
    applyDedupeForMetric,
  }),
}));
const { healthRecordRouter } = await import("./health-record");
const { appRouter } = await import("./index");
afterAll(() => {
  mock.module("@openvalens/health-record", () => actualHealthRecord);
  mock.module("@openvalens/audit-security", () => actualAuditSecurity);
  mock.module("@openvalens/auth/authz/guard", () => actualAuthzGuard);
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
  resolveCanonicalMetric.mockClear();
  ingestMetricDefinition.mockClear();
  ingestMetricSample.mockClear();
  ingestWriteIngestionJob.mockClear();
  getMetricRetentionPolicy.mockClear();
  pruneMetricSamples.mockClear();
  applyDedupeForMetric.mockClear();
  audit.mockClear();
});

// ---- Health-record ingest surface (Issue #17 bounded ingest write seam) ----

test("healthRecord router mounts at appRouter.healthRecord", () => {
  expect(appRouter.healthRecord.resolveCanonicalMetric).toBe(
    healthRecordRouter.resolveCanonicalMetric,
  );
  expect(appRouter.healthRecord.ingestMetricDefinition).toBe(
    healthRecordRouter.ingestMetricDefinition,
  );
  expect(appRouter.healthRecord.ingestMetricSample).toBe(healthRecordRouter.ingestMetricSample);
  expect(appRouter.healthRecord.ingestWriteIngestionJob).toBe(
    healthRecordRouter.ingestWriteIngestionJob,
  );
});

test("resolveCanonicalMetric requires records:read and passes only active authz org", async () => {
  const result = await healthRecordRouter.resolveCanonicalMetric.callable({
    context: context(),
  })({ metricCode: "weight" });
  expect(result.resolved.canonicalMetricCode).toBe("weight");
  expect(result.tenant?.id).toBe(1);
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  expect(resolveCanonicalMetric.mock.calls[0]?.[0]).toBe("org-a");
  expect(audit).not.toHaveBeenCalled();
});

test("resolveCanonicalMetric returns tenant=null for unregistered blood_marker family", async () => {
  const result = await healthRecordRouter.resolveCanonicalMetric.callable({
    context: context(),
  })({ metricCode: "blood_marker_glucose" });
  expect(result.resolved.canonicalMetricCode).toBe("blood_marker_glucose");
  expect(result.tenant).toBeNull();
});

test("ingestMetricDefinition audits once with targetType metric_definition", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const result = await healthRecordRouter.ingestMetricDefinition.callable({
      context: context(),
    })({
      metricCode: "weight",
      displayName: "Body Mass",
    });
    expect(ingestMetricDefinition.mock.calls[0]).toEqual([
      {
        organizationId: "org-a",
        payload: { metricCode: "weight", displayName: "Body Mass" },
      },
    ]);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "actor",
      eventType: "RECORD_CREATED",
      targetType: "metric_definition",
      targetId: "42",
      metadata: { resource: "records", action: "write", metricCode: "weight" },
    });
    expect(result.targetId).toBe("42");
    expect(result.unit).toBe("kg");
    expect(result.taxonomy.unit).toBe("kg");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("ingestMetricDefinition surfaces CanonicalMetricNotFoundError as NOT_FOUND without audit", async () => {
  ingestMetricDefinition.mockRejectedValueOnce(new CanonicalMetricNotFoundError("made_up"));
  await expect(
    healthRecordRouter.ingestMetricDefinition.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});

test("ingestMetricDefinition surfaces CrossTenantReferenceError as NOT_FOUND without audit", async () => {
  ingestMetricDefinition.mockRejectedValueOnce(new CrossTenantReferenceError("data_source", 99));
  await expect(
    healthRecordRouter.ingestMetricDefinition.callable({ context: context() })({
      metricCode: "weight",
      sourceId: 99,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});

test("ingestMetricSample audits once with targetType metric_sample and taxonomy metadata", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const result = await healthRecordRouter.ingestMetricSample.callable({
      context: context(),
    })({
      metricCode: "weight",
      observedAt: "2026-09-29T12:00:00.000Z",
      valueNumeric: 84,
    });
    expect(ingestMetricSample.mock.calls[0]).toEqual([
      {
        organizationId: "org-a",
        userId: "actor",
        payload: {
          metricCode: "weight",
          observedAt: "2026-09-29T12:00:00.000Z",
          valueNumeric: 84,
        },
      },
    ]);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "actor",
      eventType: "RECORD_CREATED",
      targetType: "metric_sample",
      targetId: "7",
      metadata: {
        resource: "records",
        action: "write",
        metricCode: "weight",
        taxonomyUnit: "kg",
        ingestQualityFlags: [],
      },
    });
    expect(result.unit).toBe("kg");
    expect(result.taxonomyUnit).toBe("kg");
    expect(result.canonicalMetricCode).toBe("weight");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("ingestMetricSample surfaces CanonicalMetricNotFoundError as NOT_FOUND without audit", async () => {
  ingestMetricSample.mockRejectedValueOnce(new CanonicalMetricNotFoundError("made_up"));
  await expect(
    healthRecordRouter.ingestMetricSample.callable({ context: context() })({
      metricCode: "weight",
      observedAt: "2026-09-29T12:00:00.000Z",
      valueNumeric: 1,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});

test("ingestWriteIngestionJob audits once with targetType ingestion_job", async () => {
  const result = await healthRecordRouter.ingestWriteIngestionJob.callable({
    context: context(),
  })({ jobType: "health_connect" });
  expect(ingestWriteIngestionJob.mock.calls[0]?.[0]).toEqual({
    organizationId: "org-a",
    payload: { jobType: "health_connect" },
  });
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0]?.[0]).toMatchObject({
    organizationId: "org-a",
    actorUserId: "actor",
    eventType: "RECORD_CREATED",
    targetType: "ingestion_job",
    targetId: "99",
    metadata: {
      resource: "records",
      action: "write",
      jobType: "health_connect",
      triggeredBy: "api",
    },
  });
  expect(result.status).toBe("queued");
  expect(result.triggeredBy).toBe("api");
});

test("unauthenticated and viewer writes do not reach the repository or audit", async () => {
  await expect(
    healthRecordRouter.resolveCanonicalMetric.callable({ context: context(false) })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    healthRecordRouter.ingestMetricDefinition.callable({ context: context(false) })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    healthRecordRouter.ingestMetricSample.callable({ context: context(false) })({
      metricCode: "weight",
      observedAt: "2026-09-29T12:00:00.000Z",
      valueNumeric: 1,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  for (const denied of ["viewer", "no-member"]) {
    role = denied;
    await expect(
      healthRecordRouter.ingestMetricDefinition.callable({ context: context() })({
        metricCode: "weight",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      healthRecordRouter.ingestMetricSample.callable({ context: context() })({
        metricCode: "weight",
        observedAt: "2026-09-29T12:00:00.000Z",
        valueNumeric: 1,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      healthRecordRouter.ingestWriteIngestionJob.callable({ context: context() })({
        jobType: "health_connect",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  }
  expect(resolveCanonicalMetric).not.toHaveBeenCalled();
  expect(ingestMetricDefinition).not.toHaveBeenCalled();
  expect(ingestMetricSample).not.toHaveBeenCalled();
  expect(ingestWriteIngestionJob).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("strict inputs reject org/user overrides, missing fields, and bad metric codes", async () => {
  const baseSample = {
    metricCode: "weight",
    observedAt: "2026-09-29T12:00:00.000Z",
    valueNumeric: 1,
  };
  const call = healthRecordRouter.ingestMetricSample.callable({ context: context() });
  for (const input of [
    { ...baseSample, organizationId: "org-b" },
    { ...baseSample, userId: "victim" },
    { ...baseSample, metadataJson: { private: "PRIVATE" } },
    { ...baseSample, metricCode: "PRIVATE_CODE" },
    { ...baseSample, metricCode: "weight", observedAt: "not-a-date" },
    { ...baseSample, metricCode: "weight", observedAt: undefined },
    { metricCode: "weight", observedAt: "2026-09-29T12:00:00.000Z" },
    { metricCode: "weight", observedAt: "2026-09-29T12:00:00.000Z", valueNumeric: Number.NaN },
    { metricCode: "weight", observedAt: "2026-09-29T12:00:00.000Z", valueString: "" },
    { metricCode: "weight", observedAt: "2026-09-29T12:00:00.000Z", dedupeHash: "short" },
    {
      metricCode: "weight",
      observedAt: "2026-09-29T12:00:00.000Z",
      valueNumeric: 1,
      format: "csv",
    },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(ingestMetricSample).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("ingestMetricDefinition strict input rejects overrides and bad metric codes", async () => {
  const call = healthRecordRouter.ingestMetricDefinition.callable({ context: context() });
  for (const input of [
    { metricCode: "weight", organizationId: "org-b" },
    { metricCode: "weight", userId: "victim" },
    { metricCode: "PRIVATE_CODE" },
    { metricCode: "weight", displayName: "" },
    { metricCode: "weight", sourceId: -1 },
    { metricCode: "weight", unknownExtra: "nope" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(ingestMetricDefinition).not.toHaveBeenCalled();
});

test("ingestWriteIngestionJob strict input rejects overrides and bad job types", async () => {
  const call = healthRecordRouter.ingestWriteIngestionJob.callable({ context: context() });
  for (const input of [
    { jobType: "health_connect", organizationId: "org-b" },
    { jobType: "health_connect", userId: "victim" },
    { jobType: "" },
    { jobType: "   " },
    { jobType: "health_connect", providerConnectionId: -1 },
    { jobType: "health_connect", windowStart: "not-a-date" },
    { jobType: "health_connect", unknownExtra: "nope" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(ingestWriteIngestionJob).not.toHaveBeenCalled();
});

// ---- Recurrence surface (Issue #17 bounded recurrence slice) ----

test("metricRetentionPolicy requires records:read and passes only active authz org", async () => {
  const result = await healthRecordRouter.metricRetentionPolicy.callable({
    context: context(),
  })({ metricCode: "weight" });
  expect(result.metricCode).toBe("weight");
  expect(result.canonicalMetricCode).toBe("weight");
  expect(result.retentionDays).toBeNull();
  expect(getMetricRetentionPolicy.mock.calls[0]?.[0]).toEqual({
    organizationId: "org-a",
    metricCode: "weight",
  });
  expect(requirePermission.mock.calls[0]?.[1]).toEqual({ resource: "records", action: "read" });
  expect(audit).not.toHaveBeenCalled();
});

test("metricRetentionPolicy surfaces CanonicalMetricNotFoundError as NOT_FOUND without audit", async () => {
  getMetricRetentionPolicy.mockRejectedValueOnce(new CanonicalMetricNotFoundError("made_up"));
  await expect(
    healthRecordRouter.metricRetentionPolicy.callable({ context: context() })({
      metricCode: "made_up",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});

test("runMetricRetention is disabled: refuses owners with or without retentionDays, never prunes or audits", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const call = healthRecordRouter.runMetricRetention.callable({ context: context() });
    for (const input of [{ metricCode: "weight" }, { metricCode: "weight", retentionDays: 7 }])
      for (let attempt = 0; attempt < 2; attempt += 1)
        await expect(call(input)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(pruneMetricSamples).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("runMetricDedupe audits once with targetType metric_dedupe_applied and no PHI", async () => {
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const result = await healthRecordRouter.runMetricDedupe.callable({ context: context() })({
      metricCode: "blood_marker_glucose",
    });
    expect(applyDedupeForMetric.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org-a",
      metricCode: "blood_marker_glucose",
    });
    expect(audit).toHaveBeenCalledTimes(1);
    const auditArg = audit.mock.calls[0]?.[0] as {
      eventType: string;
      targetType: string;
      targetId: string;
      metadata: Record<string, unknown>;
      organizationId: string;
      actorUserId: string;
      correlationId: string;
    };
    expect(auditArg.eventType).toBe("RECORD_DELETED");
    expect(auditArg.targetType).toBe("metric_dedupe_applied");
    expect(auditArg.targetId).toBe("blood_marker_glucose:3");
    expect(auditArg.organizationId).toBe("org-a");
    expect(auditArg.actorUserId).toBe("actor");
    expect(auditArg.correlationId).toBe("test");
    const metadata = auditArg.metadata;
    expect(metadata.metricCode).toBe("blood_marker_glucose");
    expect(metadata.removedDuplicates).toBe(3);
    expect(metadata.resource).toBe("records");
    expect(metadata.action).toBe("write");
    expect(Object.keys(metadata).sort()).toEqual([
      "action",
      "metricCode",
      "removedDuplicates",
      "resource",
    ]);
    expect(result.removedDuplicates).toBe(3);
    expect(result.canonicalMetricCode).toBe("blood_marker_glucose");
    expect(result.targetId).toBe("blood_marker_glucose:3");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("runMetricDedupe surfaces CanonicalMetricNotFoundError as NOT_FOUND without audit", async () => {
  applyDedupeForMetric.mockRejectedValueOnce(new CanonicalMetricNotFoundError("made_up"));
  await expect(
    healthRecordRouter.runMetricDedupe.callable({ context: context() })({
      metricCode: "made_up",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(audit).not.toHaveBeenCalled();
});

test("runMetricRetention strict input rejects overrides, bad metric codes, and bad retention bounds", async () => {
  const call = healthRecordRouter.runMetricRetention.callable({ context: context() });
  for (const input of [
    { metricCode: "weight", organizationId: "org-b" },
    { metricCode: "weight", userId: "victim" },
    { metricCode: "PRIVATE_CODE" },
    { metricCode: "weight", retentionDays: 0 },
    { metricCode: "weight", retentionDays: 3651 },
    { metricCode: "weight", retentionDays: 1.5 },
    { metricCode: "weight", timezone: "" },
    { metricCode: "weight", unknownExtra: "nope" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(pruneMetricSamples).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("runMetricDedupe strict input rejects overrides and bad metric codes", async () => {
  const call = healthRecordRouter.runMetricDedupe.callable({ context: context() });
  for (const input of [
    { metricCode: "weight", organizationId: "org-b" },
    { metricCode: "weight", userId: "victim" },
    { metricCode: "PRIVATE_CODE" },
    { metricCode: "", unknownExtra: "nope" },
    { metricCode: "weight", retentionDays: 30 },
    { metricCode: "weight", timezone: "UTC" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(applyDedupeForMetric).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("metricRetentionPolicy rejects unknown metric and bad overrides via strict input", async () => {
  const call = healthRecordRouter.metricRetentionPolicy.callable({ context: context() });
  for (const input of [
    { metricCode: "weight", organizationId: "org-b" },
    { metricCode: "weight", userId: "victim" },
    { metricCode: "PRIVATE_CODE" },
    { metricCode: "weight", retentionDays: 0 },
    { metricCode: "weight", retentionDays: 3651 },
    { metricCode: "weight", timezone: "" },
    { metricCode: "weight", unknownExtra: "nope" },
  ])
    await expect(call(input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(getMetricRetentionPolicy).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("unauthenticated and reviewer (viewer) cannot run retention/dedupe writes; non-members blocked on reads too", async () => {
  // Viewer can read but cannot write — the role gate rejects writes only.
  role = "viewer";
  await expect(
    healthRecordRouter.runMetricRetention.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    healthRecordRouter.runMetricDedupe.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  // Reads still go through for viewer.
  await expect(
    healthRecordRouter.metricRetentionPolicy
      .callable({ context: context() })({
        metricCode: "weight",
      })
      .then((result) => result.metricCode),
  ).resolves.toBe("weight");
  // Non-members are denied across read + write.
  role = "no-member";
  await expect(
    healthRecordRouter.metricRetentionPolicy.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    healthRecordRouter.runMetricRetention.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    healthRecordRouter.runMetricDedupe.callable({ context: context() })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  // Unauthenticated callers are rejected before any role check.
  await expect(
    healthRecordRouter.metricRetentionPolicy.callable({ context: context(false) })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    healthRecordRouter.runMetricRetention.callable({ context: context(false) })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    healthRecordRouter.runMetricDedupe.callable({ context: context(false) })({
      metricCode: "weight",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(pruneMetricSamples).not.toHaveBeenCalled();
  expect(applyDedupeForMetric).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
