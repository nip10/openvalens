/**
 * Ingest contract surface (Issue #17 — bounded ingest write seam).
 *
 * Pure, deterministic helpers the ingest pipeline calls to land
 * `metric_definition` and `metric_sample` rows consistent with the
 * canonical taxonomy installed in 23a2c6f. Mirrors the anchovy
 * `persist-canonical-records.ts` + `normalization.ts` shapes; this
 * package owns the strict input contract, the deterministic dedupe
 * hash, the UTC normalization, and the cross-tenant reference
 * validation surface. DB writes live in `ingest-writer.ts`; this file
 * is pure and side-effect free so it can be exercised from any caller.
 */

import {
  BLOOD_MARKER_CODE_PREFIX,
  canonicalizeMetricCode,
  getMetricDefinition,
  isBloodMarkerFamilyCode,
  type CanonicalMetricAggregation,
  type CanonicalMetricValueType,
} from "./metric-taxonomy";

/**
 * Anchor-compatible metric taxonomy category set. Mirrors the anchor
 * `MetricCategory` from `apps/web/src/lib/v2/health-record/metric-taxonomy.ts`.
 */
export type MetricCategory =
  | "body"
  | "activity"
  | "cardiac"
  | "sleep"
  | "vitals"
  | "labs";

/**
 * Result of resolving a metric code against the canonical taxonomy.
 * `null` when the code is unknown and not part of a known family.
 */
export type ResolvedCanonicalMetric = {
  canonicalMetricCode: string;
  displayName: string;
  category: MetricCategory;
  unit: string;
  valueType: CanonicalMetricValueType;
  aggregationDefault: CanonicalMetricAggregation;
  isBloodMarkerFamily: boolean;
};

/**
 * Resolve a metric code against the taxonomy. Returns `null` when the
 * code cannot be canonicalized to a known metric or a known family.
 *
 * This is the *pure* half of the resolve: the repository composes this
 * with the active tenant's catalog so the caller can distinguish
 * "unknown taxonomy code" from "taxonomy-known but not yet registered
 * for this tenant".
 */
export function resolveCanonicalMetricCode(input: {
  metricCode: string;
}): ResolvedCanonicalMetric | null {
  const canonical = canonicalizeMetricCode(input.metricCode);
  if (isBloodMarkerFamilyCode(canonical)) {
    const wildcard = getMetricDefinition("blood_marker");
    if (!wildcard) return null;
    return {
      canonicalMetricCode: canonical,
      displayName: deriveBloodMarkerDisplayName(canonical),
      category: wildcard.category,
      unit: "varies",
      valueType: wildcard.valueType,
      aggregationDefault: wildcard.aggregationDefault,
      isBloodMarkerFamily: true,
    };
  }
  const definition = getMetricDefinition(canonical);
  if (!definition) return null;
  return {
    canonicalMetricCode: definition.code,
    displayName: definition.displayName,
    category: definition.category,
    unit: definition.unit,
    valueType: definition.valueType,
    aggregationDefault: definition.aggregationDefault,
    isBloodMarkerFamily: false,
  };
}

function deriveBloodMarkerDisplayName(canonical: string): string {
  // `blood_marker_glucose` → "Glucose"; `blood_marker_hba1c` → "Hba1c".
  const stripped = canonical.slice(BLOOD_MARKER_CODE_PREFIX.length);
  if (stripped.length === 0) return "Blood Marker";
  return stripped
    .split("_")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(" ");
}

/**
 * Input contract for landing a `metric_sample`. The strict shapes live
 * in the API layer (Zod); this type is the runtime contract.
 *
 * Note: `organizationId` and `userId` are authz-derived in the API
 * layer and never appear here.
 */
export type IngestMetricSampleInput = {
  metricCode: string;
  observedAt: Date | string;
  valueNumeric?: number | null;
  valueString?: string | null;
  sourceId?: number | null;
  externalSampleId?: string | null;
  payload?: Record<string, unknown> | null;
  dedupeHash?: string | null;
};

/**
 * Input contract for landing a `metric_definition`. `metricCode` must
 * canonicalize to a known taxonomy code (or `blood_marker_*` family).
 * Caller-supplied `displayName`, `category`, `unit`, `valueType`, and
 * `aggregationDefault` are persisted verbatim only when the canonical
 * taxonomy declares a fixed value; for canonical metric codes the
 * taxonomy values win (no fabricated unit/domain drift).
 */
export type IngestMetricDefinitionInput = {
  metricCode: string;
  displayName?: string | null;
  category?: MetricCategory | null;
  unit?: string | null;
  valueType?: CanonicalMetricValueType | null;
  aggregationDefault?: CanonicalMetricAggregation | null;
  sourceId?: number | null;
  payload?: Record<string, unknown> | null;
};

/**
 * Resulting materialised metric-definition insert. The canonical
 * taxonomy values win for fixed-vocabulary fields.
 */
export type MaterializedMetricDefinition = {
  organizationId: string;
  code: string;
  displayName: string;
  category: MetricCategory;
  unit: string;
  valueType: CanonicalMetricValueType;
  aggregationDefault: CanonicalMetricAggregation;
  isActive: true;
};

/**
 * Resulting materialised metric-sample insert. The unit is always the
 * taxonomy's canonical unit — never the caller's.
 */
export type MaterializedMetricSample = {
  organizationId: string;
  metricDefinitionId: number;
  dataSourceId: number | null;
  sampledAt: Date;
  numericValue: number | null;
  textValue: string | null;
  unit: string;
  externalSampleId: string | null;
  dedupeHash: string;
  metadataJson: Record<string, unknown>;
};

/**
 * Materialise a metric-definition payload from a canonical taxonomy
 * resolution. The taxonomy values always win for fixed-vocabulary
 * fields; the caller can only influence `displayName` for known
 * canonical codes (so a tenant can rename the metric for display).
 */
export function materializeMetricDefinition(input: {
  organizationId: string;
  resolved: ResolvedCanonicalMetric;
  displayNameOverride?: string | null;
  sourceId?: number | null;
  payload?: Record<string, unknown> | null;
}): MaterializedMetricDefinition & { sourceId: number | null } {
  const { resolved } = input;
  const displayName = input.displayNameOverride && input.displayNameOverride.length > 0
    ? input.displayNameOverride
    : resolved.displayName;
  return {
    organizationId: input.organizationId,
    code: resolved.canonicalMetricCode,
    displayName,
    category: resolved.category,
    unit: resolved.unit,
    valueType: resolved.valueType,
    aggregationDefault: resolved.aggregationDefault,
    isActive: true,
    sourceId: input.sourceId ?? null,
    payload: input.payload ?? null,
  } as MaterializedMetricDefinition & { sourceId: number | null; payload: Record<string, unknown> | null };
}

/**
 * Parse an inbound `observedAt` value into a UTC `Date`. Accepts a
 * `Date` instance or an ISO-8601 string. Rejects strings that cannot
 * be parsed, never logs the input.
 */
export function parseObservedAtUtc(input: string | Date): Date {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new Error("observedAt must be a valid date.");
    return input;
  }
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("observedAt must be a non-empty string or Date.");
  }
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new Error("observedAt must parse to a valid date.");
  }
  return new Date(parsed);
}

/**
 * Stable, deterministic serialisation. Mirrors the anchor's
 * `stableSerialize` so dedupe hashes are reproducible across runs and
 * callers.
 */
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compute the dedupe hash for a metric sample. Deterministic: the same
 * inputs always produce the same hash. The anchor uses
 * `createHash("sha256").update(...).digest("hex")`; we use the Web
 * Crypto API (`globalThis.crypto.subtle` is not available for
 * synchronous hashing in Node), so we fall back to Bun's
 * `Bun.CryptoHasher`.
 */
export function computeMetricSampleDedupeHash(input: {
  metricCode: string;
  observedAt: Date;
  valueNumeric: number | null;
  valueString: string | null;
  sourceId: number | null;
  externalSampleId: string | null;
}): string {
  const payload: Record<string, unknown> = {
    canonicalMetricCode: canonicalizeMetricCode(input.metricCode),
    observedAtIso: input.observedAt.toISOString(),
    valueNumeric: input.valueNumeric,
    valueString: input.valueString,
    sourceId: input.sourceId,
    externalSampleId: input.externalSampleId,
  };
  return digestStable("metric_sample", payload);
}

function digestStable(kind: "metric_sample" | "metric_definition", payload: Record<string, unknown>): string {
  const serialised = stableSerialize(payload);
  const hasher = typeof Bun !== "undefined" ? new Bun.CryptoHasher("sha256") : null;
  if (hasher) {
    hasher.update(`${kind}:${serialised}`);
    return hasher.digest("hex");
  }
  // Node fallback — uses `node:crypto` synchronously. We accept this
  // branch only when Bun's global is unavailable (tests running under
  // node), and never log the payload.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(`${kind}:${serialised}`).digest("hex");
}

/**
 * Materialise a metric-sample insert. Resolves the taxonomy unit,
 * normalises the date to UTC, derives the dedupe hash when the caller
 * did not supply one, and assembles the metadataJson envelope.
 */
export function materializeMetricSample(input: {
  organizationId: string;
  metricDefinitionId: number;
  resolved: ResolvedCanonicalMetric;
  raw: IngestMetricSampleInput;
}): MaterializedMetricSample {
  const observedAt = parseObservedAtUtc(input.raw.observedAt);
  const numericValue =
    input.raw.valueNumeric === undefined || input.raw.valueNumeric === null
      ? null
      : Number.isFinite(input.raw.valueNumeric)
        ? input.raw.valueNumeric
        : null;
  const textValue =
    input.raw.valueString === undefined || input.raw.valueString === null
      ? null
      : typeof input.raw.valueString === "string" && input.raw.valueString.length > 0
        ? input.raw.valueString
        : null;
  const sourceId = input.raw.sourceId ?? null;
  const externalSampleId = input.raw.externalSampleId ?? null;
  const dedupeHash =
    input.raw.dedupeHash && input.raw.dedupeHash.length > 0
      ? input.raw.dedupeHash
      : computeMetricSampleDedupeHash({
          metricCode: input.raw.metricCode,
          observedAt,
          valueNumeric: numericValue,
          valueString: textValue,
          sourceId,
          externalSampleId,
        });

  const metadataJson: Record<string, unknown> = {
    canonicalMetricCode: input.resolved.canonicalMetricCode,
    taxonomyUnit: input.resolved.unit,
    ...input.raw.payload,
  };

  return {
    organizationId: input.organizationId,
    metricDefinitionId: input.metricDefinitionId,
    dataSourceId: sourceId,
    sampledAt: observedAt,
    numericValue,
    textValue,
    unit: input.resolved.unit,
    externalSampleId,
    dedupeHash,
    metadataJson,
  };
}

/**
 * Normalisation flags a caller must surface when handing a sample to
 * the writer. Mirrors the anchor `qualityFlags` vocabulary.
 */
export type IngestQualityFlag =
  | "unknown_metric"
  | "non_finite_value"
  | "negative_value"
  | "unit_mismatch";

/**
 * Inspect a numeric value against the canonical metric and emit the
 * quality flags the anchor's `normalizeMetricSample` produces. Pure;
 * used by the writer to attach flags to `metadataJson`.
 */
export function inspectSampleQuality(input: {
  resolved: ResolvedCanonicalMetric;
  valueNumeric: number | null;
  declaredUnit?: string | null;
}): IngestQualityFlag[] {
  const flags: IngestQualityFlag[] = [];
  if (input.valueNumeric === null) {
    flags.push("non_finite_value");
    return flags;
  }
  if (!Number.isFinite(input.valueNumeric)) {
    flags.push("non_finite_value");
    return flags;
  }
  if (input.valueNumeric < 0) flags.push("negative_value");
  if (
    input.declaredUnit &&
    typeof input.declaredUnit === "string" &&
    input.declaredUnit.length > 0 &&
    input.resolved.unit !== "varies" &&
    input.declaredUnit !== input.resolved.unit
  ) {
    flags.push("unit_mismatch");
  }
  return flags;
}

/**
 * Validate that at least one of `valueNumeric` / `valueString` is
 * present. The DB column pair allows both to be `null` but the
 * contract requires one.
 */
export function ensureSampleHasValue(input: {
  valueNumeric: number | null | undefined;
  valueString: string | null | undefined;
}): void {
  const hasNumeric =
    input.valueNumeric !== null &&
    input.valueNumeric !== undefined &&
    Number.isFinite(input.valueNumeric);
  const hasString =
    input.valueString !== null &&
    input.valueString !== undefined &&
    typeof input.valueString === "string" &&
    input.valueString.length > 0;
  if (!hasNumeric && !hasString) {
    throw new Error("Sample must include valueNumeric or valueString.");
  }
}

/**
 * Strict error class the writer throws when the resolved metric is
 * not registered for the active org's catalog.
 */
export class CanonicalMetricNotFoundError extends Error {
  readonly code = "METRIC_NOT_FOUND";
  constructor(metricCode: string) {
    super(`Metric ${metricCode} not registered for the active tenant catalog.`);
  }
}

/**
 * Cross-tenant reference error — `data_source_id` belongs to a
 * different org. Mirrors the anchor's reference-validation pattern.
 */
export class CrossTenantReferenceError extends Error {
  readonly code = "CROSS_TENANT_REFERENCE";
  constructor(reference: "data_source" | "metric_definition" | "ingestion_job", id: number) {
    super(`Reference ${reference}#${id} not found in the active organization.`);
  }
}

/**
 * Validation failure for an ingest payload — caller-supplied fields
 * cannot be reconciled with the canonical taxonomy.
 */
export class IngestValidationError extends Error {
  readonly code = "INGEST_VALIDATION";
  readonly reason:
    | "invalid_metric_code"
    | "missing_value"
    | "invalid_date"
    | "unsupported_value_type";
  constructor(reason: IngestValidationError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

export function buildIngestDefinitionRow(input: {
  organizationId: string;
  resolved: ResolvedCanonicalMetric;
  displayNameOverride?: string | null;
}): {
  organizationId: string;
  code: string;
  displayName: string;
  category: string;
  unit: string;
  valueType: string;
  aggregationDefault: string;
  isActive: true;
} {
  const displayName = input.displayNameOverride && input.displayNameOverride.length > 0
    ? input.displayNameOverride
    : input.resolved.displayName;
  return {
    organizationId: input.organizationId,
    code: input.resolved.canonicalMetricCode,
    displayName,
    category: input.resolved.category,
    unit: input.resolved.unit,
    valueType: input.resolved.valueType,
    aggregationDefault: input.resolved.aggregationDefault,
    isActive: true,
  };
}

export const __testHelpers = {
  deriveBloodMarkerDisplayName,
  digestStable,
};