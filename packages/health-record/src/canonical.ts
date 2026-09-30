import type { TimelineEvent, CanonicalTimelineDomain } from "./types";
import { canonicalizeMetricCode, getMetricDefinition } from "./metric-taxonomy";

type Source = {
  id: number;
  displayName: string | null;
  originalSourceName: string | null;
  sourceAppId: string | null;
  sourceType: string;
} | null;
export type EventRow = {
  id: number;
  eventAt: Date;
  eventType: string;
  title: string | null;
  payloadJson: unknown;
  dataSource: Source;
};
export type MetricRow = {
  id: number;
  sampledAt: Date;
  numericValue: number | null;
  textValue: string | null;
  unit: string | null;
  metadataJson: unknown;
  metricCode: string | null;
  metricDisplayName: string | null;
  metricCategory: string | null;
  dataSource: Source;
};
function bag(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const TAXONOMY_CATEGORY_TO_DOMAIN: Record<string, CanonicalTimelineDomain> = {
  body: "body",
  vitals: "vitals",
  cardiac: "cardiac",
  sleep: "sleep",
  labs: "labs",
};

/**
 * Resolve the canonical domain for a metric row. When the tenant's
 * `metric_definition.category` is present we honour it; otherwise we
 * fall back to the canonical taxonomy's category for known codes.
 * This is the seam the bounded read-side adds — previously the
 * adapter fell through to a text-pattern match, which silently
 * fabricated values for tenant-registered metrics.
 */
function metricDomain(
  metricCode: string | null,
  category?: string | null,
): CanonicalTimelineDomain {
  const explicit = (category ?? "").trim().toLowerCase();
  if (explicit && Object.hasOwn(TAXONOMY_CATEGORY_TO_DOMAIN, explicit)) {
    return TAXONOMY_CATEGORY_TO_DOMAIN[explicit]!;
  }
  if (metricCode) {
    const definition = getMetricDefinition(canonicalizeMetricCode(metricCode));
    if (definition) return TAXONOMY_CATEGORY_TO_DOMAIN[definition.category] ?? "unknown";
  }
  return "unknown";
}

function domain(text: string, category?: string | null): CanonicalTimelineDomain {
  const v = (category ?? "").trim().toLowerCase();
  const domains: CanonicalTimelineDomain[] = [
    "sleep",
    "activity",
    "body",
    "vitals",
    "labs",
    "meds_supplements",
    "calendar",
    "sync",
    "imaging",
    "cardiac",
    "unknown",
  ];
  const exact = domains.find((d) => d === v);
  if (exact) return exact;
  if (["meds", "medications", "supplements", "medication", "supplement"].includes(v))
    return "meds_supplements";
  if (["lab", "blood", "bloodwork"].includes(v)) return "labs";
  if (["vital", "vital_signs"].includes(v)) return "vitals";
  const lower = text.toLowerCase();
  for (const [pattern, result] of [
    [/sleep/, "sleep"],
    [/workout|activity|exercise/, "activity"],
    [/medication|supplement/, "meds_supplements"],
    [/lab|blood/, "labs"],
    [/imaging|mri|ct/, "imaging"],
    [/cardiac|ecg|echo/, "cardiac"],
    [/weight|body|fat/, "body"],
    [/heart|bpm|blood_pressure|vital/, "vitals"],
    [/step/, "activity"],
  ] as const)
    if (pattern.test(lower)) return result;
  return "unknown";
}
function severityText(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (/critical|\bcrit\b|panic|fatal|severe/i.test(value)) return "critical" as const;
  if (
    /warn|flag|abnormal|\bhigh\b|\blow\b|elevated|depressed|out[-_\s]?of[-_\s]?range/i.test(value)
  )
    return "warning" as const;
  return undefined;
}
function common(
  source: Source,
  payload: unknown,
): Pick<
  TimelineEvent,
  "severity" | "confidence" | "reviewState" | "sourceRefs" | "provenanceRefs" | "relatedRefs"
> {
  const p = bag(payload);
  const explicit = p.severity;
  const severity =
    explicit === "critical" || explicit === "warning" || explicit === "info" || explicit === "none"
      ? explicit
      : (severityText(explicit) ?? severityText(p.status) ?? severityText(p.flag) ?? "none");
  const c = p.confidence;
  const confidence =
    c === "high" || c === "medium" || c === "low"
      ? c
      : typeof c === "number"
        ? c >= 0.8
          ? "high"
          : c >= 0.5
            ? "medium"
            : "low"
        : "high";
  const sourceRefs: TimelineEvent["sourceRefs"] = [];
  const label =
    source?.displayName || source?.originalSourceName || source?.sourceAppId || source?.sourceType;
  if (label) sourceRefs.push({ type: "data_source", label, ...(source ? { id: source.id } : {}) });
  const fallback =
    typeof p.source === "string"
      ? p.source
      : typeof p.sourceApp === "string"
        ? p.sourceApp
        : undefined;
  if (fallback && !sourceRefs.some((r) => r.label.toLowerCase() === fallback.toLowerCase()))
    sourceRefs.push({ type: "data_source", label: fallback });
  return {
    severity,
    confidence,
    reviewState: severity !== "none" || confidence === "low" ? "needs_review" : "unreviewed",
    sourceRefs,
    provenanceRefs: [],
    relatedRefs: [],
  };
}
// Anchor semantics: canonical samples remain separate; no weight resolution is applied.
export function canonicalEvent(row: EventRow): TimelineEvent {
  const canonical: Record<string, unknown> = { type: row.eventType, title: row.title };
  const p = bag(row.payloadJson);
  if (row.eventType === "sleep_session") {
    if (typeof p.endAt === "string") {
      canonical.endAt = p.endAt;
      const duration = Math.floor((Date.parse(p.endAt) - row.eventAt.getTime()) / 60000);
      if (Number.isFinite(duration) && duration > 0) canonical.durationMinutes = duration;
    }
    if (Array.isArray(p.sleepStageIntervals)) canonical.stageCount = p.sleepStageIntervals.length;
  }
  return {
    kind: "event",
    id: `health_event:${row.id}`,
    at: row.eventAt.toISOString(),
    domain: domain(`${row.eventType} ${row.title ?? ""}`),
    title: row.title ?? row.eventType,
    summary: row.eventType === "sleep_session" ? "Sleep session" : (row.title ?? row.eventType),
    canonical,
    ...common(row.dataSource, row.payloadJson),
  };
}
export function canonicalMetric(row: MetricRow): TimelineEvent {
  const value = row.numericValue ?? row.textValue;
  const title = row.metricDisplayName || row.metricCode || "Metric";
  // Taxonomy seam: prefer the tenant's declared category when it
  // matches the canonical set; otherwise look the metric up in the
  // taxonomy to honour its declared unit and category. This is the
  // bounded read-side's wiring point — no more guessing.
  const canonicalUnit = row.metricCode
    ? getMetricDefinition(canonicalizeMetricCode(row.metricCode))?.unit
    : undefined;
  const summaryUnit = row.unit && row.unit.length > 0 ? row.unit : (canonicalUnit ?? null);
  return {
    kind: "metric",
    id: `metric_sample:${row.id}`,
    at: row.sampledAt.toISOString(),
    domain: metricDomain(row.metricCode, row.metricCategory),
    title,
    summary: `${title} ${value ?? ""}${summaryUnit ? ` ${summaryUnit}` : ""}`.trim(),
    canonical: {
      metricCode: row.metricCode,
      metricDisplayName: row.metricDisplayName,
      metricCategory: row.metricCategory,
      value,
      unit: summaryUnit,
    },
    ...common(row.dataSource, row.metadataJson),
  };
}
