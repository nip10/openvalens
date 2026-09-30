/** Canonical timeline contracts ported from anchovy. Payloads may contain PHI; never log them. */
export const CANONICAL_TIMELINE_DOMAINS = [
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
] as const;
export type CanonicalTimelineDomain = (typeof CANONICAL_TIMELINE_DOMAINS)[number];
export const CANONICAL_TIMELINE_SEVERITIES = ["critical", "warning", "info", "none"] as const;
export type CanonicalTimelineSeverity = (typeof CANONICAL_TIMELINE_SEVERITIES)[number];
export const CANONICAL_TIMELINE_CONFIDENCES = ["high", "medium", "low"] as const;
export type CanonicalTimelineConfidence = (typeof CANONICAL_TIMELINE_CONFIDENCES)[number];
export const CANONICAL_TIMELINE_REVIEW_STATES = ["unreviewed", "needs_review", "reviewed"] as const;
export type CanonicalTimelineReviewState = (typeof CANONICAL_TIMELINE_REVIEW_STATES)[number];
export type TimelineEvent = {
  kind: "event" | "metric";
  id: string;
  at: string;
  domain: CanonicalTimelineDomain;
  title: string;
  summary: string;
  severity: CanonicalTimelineSeverity;
  confidence: CanonicalTimelineConfidence;
  reviewState: CanonicalTimelineReviewState;
  sourceRefs: { type: string; label: string; id?: number | string }[];
  provenanceRefs: { sourceTable: string; sourceId: number; relation: string }[];
  relatedRefs: { table: string; id: number; relation: string }[];
  canonical: Record<string, unknown>;
};
export type TimelineFilters = {
  from?: string;
  to?: string;
  domain?: CanonicalTimelineDomain;
  source?: string;
  severity?: CanonicalTimelineSeverity;
  confidence?: CanonicalTimelineConfidence;
  reviewState?: CanonicalTimelineReviewState;
  limit?: number;
  cursor?: string;
};
/** Internal contract only. API organization identity is derived exclusively from authz. */
export type ProvenanceLinkInsert = {
  organizationId: string;
  targetTable: string;
  targetId: number;
  sourceTable: string;
  sourceId: number;
  relation: string;
  metadataJson?: Record<string, unknown> | null;
};
export type ProvenanceLinkRow = Omit<ProvenanceLinkInsert, "metadataJson"> & {
  id: number;
  createdAt: string;
};
export type SourceIdentityTuple = {
  provider?: string | null;
  existingSourceKey?: string | null;
  importChannel?: string | null;
  deviceType?: string | null;
  deviceModel?: string | null;
  softwareVersion?: string | null;
  originalSourceName?: string | null;
  sourceAppId?: string | null;
};
export type SourceIdentityInput = string | SourceIdentityTuple;
export type DataSourceIdentity = SourceIdentityTuple & {
  sourceKey: string;
  canonicalSourceKey?: string;
};
