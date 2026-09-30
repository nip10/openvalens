import type { CanonicalTimelineDomain, TimelineEvent, CanonicalTimelineSeverity } from "./types";

// Source: anchovy/apps/web/src/lib/v2/health-record/timeline-adapters.ts.
// These projections intentionally do not invent domain mutations or resolve samples.
type BaseRow = { id: number };
export type ConsultationTimelineRow = BaseRow & {
  date: string;
  type: string;
  facility?: string | null;
  physician?: string | null;
  diagnosis?: string | null;
  sourceFile?: string | null;
};
export type ImagingStudyTimelineRow = BaseRow & {
  date: string;
  type: string;
  bodyPart: string;
  facility?: string | null;
  conclusion?: string | null;
  sourceFile?: string | null;
};
export type CardiacExamTimelineRow = BaseRow & {
  date: string;
  type: string;
  facility?: string | null;
  conclusion?: string | null;
  sourceFile?: string | null;
};
export type WeeklyReviewTimelineRow = BaseRow & {
  weekStart: string;
  adherence?: number | null;
  energy?: number | null;
  sleep?: number | null;
  notes?: string | null;
};
export type InsightTimelineRow = BaseRow & {
  createdAt: string;
  type: string;
  severity?: string | null;
  title: string;
  body?: string | null;
};
export type ScheduledEventTimelineRow = BaseRow & {
  startDate: string;
  title: string;
  type: string;
  frequency: string;
  notes?: string | null;
};
export type DailyReminderTimelineRow = BaseRow & {
  date: string;
  sourceType: "supplement" | "medication" | "activity";
  sourceId: number;
  label: string;
  status: string;
};
export type DomainTimelineRows = {
  consultations?: ConsultationTimelineRow[];
  imagingStudies?: ImagingStudyTimelineRow[];
  cardiacExams?: CardiacExamTimelineRow[];
  weeklyReviews?: WeeklyReviewTimelineRow[];
  insights?: InsightTimelineRow[];
  scheduledEvents?: ScheduledEventTimelineRow[];
  dailyReminders?: DailyReminderTimelineRow[];
};
function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function sourceRefs(
  table: string,
  id: number,
  sourceFile?: string | null,
): TimelineEvent["sourceRefs"] {
  return sourceFile
    ? [{ type: "source_file", label: sourceFile }]
    : [{ type: "source_record", label: `${table}:${id}`, id }];
}
function item(
  input: Omit<TimelineEvent, "kind" | "provenanceRefs" | "relatedRefs"> & {
    sourceTable: string;
    sourceId: number;
  },
): TimelineEvent {
  const { sourceTable, sourceId, ...fields } = input;
  return {
    ...fields,
    kind: "event",
    provenanceRefs: [{ sourceTable, sourceId, relation: "source_record" }],
    relatedRefs: [{ table: sourceTable, id: sourceId, relation: "source_record" }],
  };
}
function parseInsightSeverity(value: string | null | undefined): CanonicalTimelineSeverity {
  return value === "critical" || value === "warning" || value === "info" ? value : "none";
}
function scheduledEventDomain(type: string): CanonicalTimelineDomain {
  return type === "medication" || type === "supplement" ? "meds_supplements" : "calendar";
}
export function buildDomainTimelineItems(rows: DomainTimelineRows): TimelineEvent[] {
  return [
    ...(rows.consultations ?? []).map((row) =>
      item({
        id: `consultation:${row.id}`,
        at: toIso(row.date),
        domain: "unknown",
        title: `Consultation: ${row.type}`,
        summary: row.diagnosis ?? row.facility ?? row.physician ?? row.type,
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
        sourceRefs: sourceRefs("consultation", row.id, row.sourceFile),
        canonical: {
          table: "consultation",
          type: row.type,
          facility: row.facility ?? null,
          physician: row.physician ?? null,
          diagnosis: row.diagnosis ?? null,
        },
        sourceTable: "consultation",
        sourceId: row.id,
      }),
    ),
    ...(rows.imagingStudies ?? []).map((row) =>
      item({
        id: `imaging_study:${row.id}`,
        at: toIso(row.date),
        domain: "imaging",
        title: `${row.type}: ${row.bodyPart}`,
        summary: row.conclusion ?? row.facility ?? row.bodyPart,
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
        sourceRefs: sourceRefs("imaging_study", row.id, row.sourceFile),
        canonical: {
          table: "imaging_study",
          type: row.type,
          bodyPart: row.bodyPart,
          facility: row.facility ?? null,
          conclusion: row.conclusion ?? null,
        },
        sourceTable: "imaging_study",
        sourceId: row.id,
      }),
    ),
    ...(rows.cardiacExams ?? []).map((row) =>
      item({
        id: `cardiac_exam:${row.id}`,
        at: toIso(row.date),
        domain: "cardiac",
        title: row.type,
        summary: row.conclusion ?? row.facility ?? row.type,
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
        sourceRefs: sourceRefs("cardiac_exam", row.id, row.sourceFile),
        canonical: {
          table: "cardiac_exam",
          type: row.type,
          facility: row.facility ?? null,
          conclusion: row.conclusion ?? null,
        },
        sourceTable: "cardiac_exam",
        sourceId: row.id,
      }),
    ),
    ...(rows.weeklyReviews ?? []).map((row) =>
      item({
        id: `weekly_review:${row.id}`,
        at: toIso(row.weekStart),
        domain: "calendar",
        title: "Weekly review",
        summary:
          row.notes ??
          `Adherence ${row.adherence ?? "?"}, energy ${row.energy ?? "?"}, sleep ${row.sleep ?? "?"}`,
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
        sourceRefs: sourceRefs("weekly_review", row.id),
        canonical: {
          table: "weekly_review",
          adherence: row.adherence ?? null,
          energy: row.energy ?? null,
          sleep: row.sleep ?? null,
          notes: row.notes ?? null,
        },
        sourceTable: "weekly_review",
        sourceId: row.id,
      }),
    ),
    ...(rows.insights ?? []).map((row) => {
      const severity = parseInsightSeverity(row.severity);
      return item({
        id: `insight:${row.id}`,
        at: toIso(row.createdAt),
        domain: "unknown",
        title: row.title,
        summary: row.body ?? row.type,
        severity,
        confidence: "medium",
        reviewState:
          severity === "critical" || severity === "warning" ? "needs_review" : "unreviewed",
        sourceRefs: sourceRefs("insight", row.id),
        canonical: { table: "insight", type: row.type, severity, body: row.body ?? null },
        sourceTable: "insight",
        sourceId: row.id,
      });
    }),
    ...(rows.scheduledEvents ?? []).map((row) =>
      item({
        id: `scheduled_event:${row.id}`,
        at: toIso(row.startDate),
        domain: scheduledEventDomain(row.type),
        title: row.title,
        summary: row.notes ?? `${row.type} · ${row.frequency}`,
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
        sourceRefs: sourceRefs("scheduled_event", row.id),
        canonical: {
          table: "scheduled_event",
          type: row.type,
          frequency: row.frequency,
          notes: row.notes ?? null,
        },
        sourceTable: "scheduled_event",
        sourceId: row.id,
      }),
    ),
    ...(rows.dailyReminders ?? []).map((row) =>
      item({
        id: `daily_reminder:${row.id}`,
        at: toIso(row.date),
        domain: row.sourceType === "activity" ? "activity" : "meds_supplements",
        title: row.label,
        summary: `${row.status} ${row.sourceType} reminder`,
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
        sourceRefs: sourceRefs("daily_reminder", row.id),
        canonical: {
          table: "daily_reminder",
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          status: row.status,
        },
        sourceTable: "daily_reminder",
        sourceId: row.id,
      }),
    ),
  ];
}
