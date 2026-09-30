import { expect, mock, spyOn, test } from "bun:test";
import { CanonicalMetricNotFoundError } from "./ingest";
import type { HealthRecordRepository } from "./repository";
import {
  createMetricMaintenanceRunner,
  isMetricMaintenanceDue,
  parseMetricMaintenanceInput,
  type MetricMaintenanceAudit,
} from "./scheduler";

const now = new Date("2026-09-30T12:00:00Z");
const scope = { organizationId: "org-a", actorUserId: "actor-a" };
const input = { metricCode: "weight", dueAt: now };
function fixture() {
  const maintenance = mock(
    async (
      request: Parameters<HealthRecordRepository["runMetricMaintenance"]>[0],
    ): Promise<Awaited<ReturnType<HealthRecordRepository["runMetricMaintenance"]>>> => ({
      status: "completed",
      canonicalMetricCode: request.metricCode,
      removedDuplicates: 0,
      retention:
        request.retentionDays === undefined
          ? null
          : {
              deletedCount: 2,
              canonicalMetricCode: request.metricCode,
              retentionDays: request.retentionDays,
              fromUtc: "2026-09-23T12:00:00.000Z",
              toUtc: now.toISOString(),
            },
    }),
  );
  const audit = mock(async (_event: MetricMaintenanceAudit) => 7);
  const authorize = mock(async () => true);
  const run = createMetricMaintenanceRunner({
    repository: { runMetricMaintenance: maintenance },
    writeAudit: audit,
    authorizeRetention: authorize,
  });
  return { maintenance, audit, authorize, run };
}

test("due instants are deterministic, inclusive, and do not use wall clock or DST", () => {
  expect(isMetricMaintenanceDue({ now, dueAt: new Date(now.getTime() + 1) })).toBe(false);
  expect(isMetricMaintenanceDue({ now, dueAt: now })).toBe(true);
  expect(isMetricMaintenanceDue({ now, dueAt: new Date(now.getTime() - 1) })).toBe(true);
  expect(
    isMetricMaintenanceDue({
      now: new Date("2026-11-01T01:30:00-05:00"),
      dueAt: new Date("2026-11-01T01:30:00-04:00"),
    }),
  ).toBe(true);
  expect(() => isMetricMaintenanceDue({ now: new Date(NaN), dueAt: now })).toThrow();
  expect(() => isMetricMaintenanceDue({ now, dueAt: new Date(NaN) })).toThrow();
});

test("absent retention opt-in does not pass a pruning policy; single sanitized summary audit", async () => {
  const { run, maintenance, authorize, audit } = fixture();
  const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  try {
    const result = await run(scope, input, now);
    expect(result.status).toBe("completed");
    expect(maintenance.mock.calls[0]?.[0]).toEqual({
      organizationId: "org-a",
      metricCode: "weight",
      now,
      maxDeleteCount: 100,
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toEqual({
      ...scope,
      eventType: "METRIC_RECURRENCE_RUN",
      targetType: "metric_maintenance",
      targetId: "weight",
      metadata: {
        metricCode: "weight",
        runAt: now.toISOString(),
        removedDuplicates: 0,
        deletedCount: 0,
        retentionDays: null,
        maxDeleteCount: 100,
      },
    });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

test("explicit policy requires trusted authorization and forwards exact bounds", async () => {
  const { run, maintenance, authorize } = fixture();
  await run(scope, { ...input, retentionDays: 7, maxDeleteCount: 3 }, now);
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(maintenance.mock.calls[0]?.[0]).toEqual({
    organizationId: "org-a",
    metricCode: "weight",
    now,
    retentionDays: 7,
    maxDeleteCount: 3,
  });
});

test("denied or absent authorizer cannot prune or emit success audit", async () => {
  const { run, maintenance, authorize, audit } = fixture();
  authorize.mockResolvedValue(false);
  await expect(run(scope, { ...input, retentionDays: 7 }, now)).rejects.toThrow("not authorized");
  const noPolicy = createMetricMaintenanceRunner({
    repository: { runMetricMaintenance: maintenance },
    writeAudit: audit,
  });
  await expect(noPolicy(scope, { ...input, retentionDays: 7 }, now)).rejects.toThrow(
    "not authorized",
  );
  expect(maintenance).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("strict inputs reject identities, raw PHI, unsupported policy flags and bad bounds", () => {
  for (const key of [
    "organizationId",
    "userId",
    "actorUserId",
    "payload",
    "authorized",
    "timezone",
  ]) {
    expect(() => parseMetricMaintenanceInput({ ...input, [key]: "patient secret" })).toThrow();
  }
  for (const days of [0, -1, 1.5, 3651, NaN, Infinity, "7", null])
    expect(() => parseMetricMaintenanceInput({ ...input, retentionDays: days })).toThrow();
  for (const count of [0, -1, 1.5, 1001, NaN, Infinity])
    expect(() => parseMetricMaintenanceInput({ ...input, maxDeleteCount: count })).toThrow();
  for (const days of [1, 3650])
    expect(parseMetricMaintenanceInput({ ...input, retentionDays: days }).retentionDays).toBe(days);
});

test("not due and busy runs have no success audit", async () => {
  const { run, maintenance, audit } = fixture();
  expect(await run(scope, { ...input, dueAt: new Date(now.getTime() + 1) }, now)).toEqual({
    status: "not_due",
  });
  expect(maintenance).not.toHaveBeenCalled();
  maintenance.mockResolvedValue({ status: "busy" });
  expect(await run(scope, input, now)).toEqual({ status: "busy" });
  expect(audit).not.toHaveBeenCalled();
});

test("unknown taxonomy and failed registered metric lookup cannot audit success", async () => {
  const { run, maintenance, audit } = fixture();
  await expect(run(scope, { ...input, metricCode: "unknown_metric" }, now)).rejects.toBeInstanceOf(
    CanonicalMetricNotFoundError,
  );
  expect(maintenance).not.toHaveBeenCalled();
  maintenance.mockRejectedValue(new CanonicalMetricNotFoundError("weight"));
  await expect(run(scope, input, now)).rejects.toBeInstanceOf(CanonicalMetricNotFoundError);
  expect(audit).not.toHaveBeenCalled();
});

test("failed audit is observable without pretending the committed run rolled back", async () => {
  const { maintenance } = fixture();
  const run = createMetricMaintenanceRunner({
    repository: { runMetricMaintenance: maintenance },
    writeAudit: async () => null,
  });
  expect(await run(scope, input, now)).toMatchObject({ status: "completed", auditWritten: false });
});
