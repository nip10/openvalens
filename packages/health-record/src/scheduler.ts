import { CanonicalMetricNotFoundError, resolveCanonicalMetricCode } from "./ingest";
import { isValidRetentionDays } from "./recurrence";
import type { HealthRecordRepository } from "./repository";

/** Trusted-server scope, never procedure input. Tenant enumeration and
 * records:write/membership authorization belong to the integrating server. */
export type MaintenanceScope = { organizationId: string; actorUserId: string | null };
export type MetricMaintenanceInput = {
  metricCode: string;
  dueAt: Date;
  retentionDays?: number;
  maxDeleteCount?: number;
};
export type MetricMaintenanceAudit = MaintenanceScope & {
  eventType: "METRIC_RECURRENCE_RUN";
  targetType: "metric_maintenance";
  targetId: string;
  metadata: {
    metricCode: string;
    runAt: string;
    removedDuplicates: number;
    deletedCount: number;
    retentionDays: number | null;
    maxDeleteCount: number;
  };
};

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Equality is due. UTC instants, no timezone/DST or implicit wall clock.
 * The caller owns dueAt and must advance it after a successful run. */
export function isMetricMaintenanceDue(input: { now: Date; dueAt: Date }): boolean {
  if (!validDate(input.now) || !validDate(input.dueAt))
    throw new Error("Invalid schedule instant.");
  return input.now.getTime() >= input.dueAt.getTime();
}

/** Strict runtime boundary even for non-API callers; no identity overrides,
 * policy booleans, payloads or clinical values are accepted. */
export function parseMetricMaintenanceInput(value: unknown): MetricMaintenanceInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid maintenance input.");
  const input = value as Record<string, unknown>;
  const keys = ["metricCode", "dueAt", "retentionDays", "maxDeleteCount"];
  if (
    Object.keys(input).some((key) => !keys.includes(key)) ||
    typeof input.metricCode !== "string" ||
    !/^[a-z][a-z0-9_]{0,119}$/.test(input.metricCode) ||
    !validDate(input.dueAt)
  )
    throw new Error("Invalid maintenance input.");
  if (
    input.retentionDays !== undefined &&
    (typeof input.retentionDays !== "number" || !isValidRetentionDays(input.retentionDays))
  )
    throw new Error("Invalid retention bound.");
  if (
    input.maxDeleteCount !== undefined &&
    (typeof input.maxDeleteCount !== "number" ||
      !Number.isInteger(input.maxDeleteCount) ||
      input.maxDeleteCount < 1 ||
      input.maxDeleteCount > 1000)
  )
    throw new Error("Invalid deletion bound.");
  return {
    metricCode: input.metricCode,
    dueAt: new Date(input.dueAt),
    ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
    ...(input.maxDeleteCount !== undefined ? { maxDeleteCount: input.maxDeleteCount } : {}),
  };
}

/** No background registration or all-org reader. One bounded tenant/metric
 * invocation. Repository methods do not audit; only this summary is sent to
 * the injected redacting writer (e.g. writeAuditLog). Audit is best effort,
 * after commit, not a durable schedule tracker or exactly-once guarantee. */
export function createMetricMaintenanceRunner(dependencies: {
  repository: Pick<HealthRecordRepository, "runMetricMaintenance">;
  authorizeRetention?: (
    scope: MaintenanceScope,
    policy: { metricCode: string; retentionDays: number },
  ) => Promise<boolean>;
  writeAudit: (event: MetricMaintenanceAudit) => Promise<number | null>;
}) {
  return async (scope: MaintenanceScope, value: unknown, now: Date) => {
    const input = parseMetricMaintenanceInput(value);
    const runAt = new Date(now);
    const resolved = resolveCanonicalMetricCode({ metricCode: input.metricCode });
    if (!resolved) throw new CanonicalMetricNotFoundError("unknown");
    if (!isMetricMaintenanceDue({ now: runAt, dueAt: input.dueAt }))
      return { status: "not_due" as const };
    const trustedScope = { organizationId: scope.organizationId, actorUserId: scope.actorUserId };
    if (
      input.retentionDays !== undefined &&
      !(await dependencies.authorizeRetention?.(trustedScope, {
        metricCode: resolved.canonicalMetricCode,
        retentionDays: input.retentionDays,
      }))
    )
      throw new Error("Retention policy is not authorized.");
    const maxDeleteCount = input.maxDeleteCount ?? 100;
    const result = await dependencies.repository.runMetricMaintenance({
      organizationId: trustedScope.organizationId,
      metricCode: resolved.canonicalMetricCode,
      now: runAt,
      maxDeleteCount,
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
    });
    if (result.status === "busy") return result;
    // The maintenance transaction has already committed. An audit failure
    // must not be reported as a failed (rolled back) run.
    let auditId: number | null = null;
    try {
      auditId = await dependencies.writeAudit({
        ...trustedScope,
        eventType: "METRIC_RECURRENCE_RUN",
        targetType: "metric_maintenance",
        targetId: resolved.canonicalMetricCode,
        metadata: {
          metricCode: resolved.canonicalMetricCode,
          runAt: runAt.toISOString(),
          removedDuplicates: result.removedDuplicates,
          deletedCount: result.retention?.deletedCount ?? 0,
          retentionDays: input.retentionDays ?? null,
          maxDeleteCount,
        },
      });
    } catch {
      auditId = null;
    }
    return { ...result, auditWritten: auditId !== null };
  };
}
