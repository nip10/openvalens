import { formatDurationShort, roundForDisplay } from "@openvalens/trackers/model";

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
/** The connected AI app that wrote an entry (#439): its grant and the app's name. */
export type AiAppTag = { grantId: string; label: string };

/** A custom tracker entry (#441), already filtered to what the viewer may see. */
export type CustomTrackerEntryTimelineRow = {
  id: string;
  trackerId: string;
  loggedAt: string;
  localDate: string;
  value: number;
  note?: string | null;
  source: string;
  loggedByUserId?: string | null;
  trackerName: string;
  trackerType: string;
  trackerUnit?: string | null;
  trackerDecimals: number;
  trackerIcon: string;
  viewerOwnsTracker: boolean;
  /** Written by a connected AI app (#439, M2b). */
  aiApp?: AiAppTag | null;
};
/** A pain entry (#442), already limited to the viewer's own entries. */
export type PainEntryTimelineRow = {
  id: string;
  region: string;
  rating: number;
  type?: string | null;
  loggedAt: string;
  localDate: string;
  note?: string | null;
  /** Written by a connected AI app (#439, M2b). */
  aiApp?: AiAppTag | null;
};
/**
 * A plain-water entry (#493), already limited to the viewer's own entries
 * while the water card is on. `quantityMl` is null in hide-numbers mode: the
 * reader drops the amount before it reaches the item.
 */
export type WaterEntryTimelineRow = {
  id: number;
  observedAt: string;
  timeZone: string;
  quantityMl: number | null;
  /** Written by a connected AI app (#439, M2a). */
  aiApp?: AiAppTag | null;
};
/** A supplement the member took (#493), already limited to the viewer's own intakes. */
export type SupplementIntakeTimelineRow = {
  id: number;
  supplementId: number;
  supplementName: string;
  occurredAt: string;
  timeZone: string;
  dose: string;
  note?: string | null;
  /** Written by a connected AI app (#439, M2a). */
  aiApp?: AiAppTag | null;
};
/**
 * A logged workout session (#493): the viewer's own, plus workspace sessions
 * saved before workouts had an owner (as on the workouts screen). Device
 * workouts are health events and reach the timeline on their own.
 */
export type WorkoutTimelineRow = {
  id: number;
  /** The session's calendar day, `YYYY-MM-DD`; a session has no time of day. */
  date: string;
  type: string;
  duration?: number | null;
  intensity?: string | null;
  effortRating?: number | null;
  /** Exercises in the session; null for a session saved before workouts had an owner. */
  exerciseCount?: number | null;
  /** Written by a connected AI app (#439, M2b). */
  aiApp?: AiAppTag | null;
};
export type DomainTimelineRows = {
  trackerEntries?: CustomTrackerEntryTimelineRow[];
  painEntries?: PainEntryTimelineRow[];
  waterEntries?: WaterEntryTimelineRow[];
  supplementIntakes?: SupplementIntakeTimelineRow[];
  workouts?: WorkoutTimelineRow[];
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
/** The server's plain summary of a tracker value; the apps format it in the member's language. */
function customTrackerSummary(row: CustomTrackerEntryTimelineRow): string {
  switch (row.trackerType) {
    case "duration":
      return formatDurationShort(row.value);
    case "yes_no":
      return row.value > 0 ? "Yes" : "No";
    case "scale":
      return `${roundForDisplay(row.value, 1)} of 5`;
    default:
      return `${roundForDisplay(row.value, row.trackerDecimals)}${row.trackerUnit ? ` ${row.trackerUnit}` : ""}`;
  }
}

/**
 * #439 — an entry a connected AI app wrote leads with its "via <app>" source,
 * filterable with `source=ai_app:<grantId>` (the same ref metric samples carry).
 */
function aiAppRefs(tag: AiAppTag | null | undefined): TimelineEvent["sourceRefs"] {
  if (!tag || typeof tag.grantId !== "string" || typeof tag.label !== "string") return [];
  return [{ type: "ai_app", label: tag.label, id: `ai_app:${tag.grantId}`, provider: "ai_app" }];
}

function customTrackerItem(row: CustomTrackerEntryTimelineRow): TimelineEvent {
  return {
    kind: "event",
    id: `custom_tracker_entry:${row.id}`,
    at: toIso(row.loggedAt),
    domain: "custom",
    title: row.trackerName,
    summary: customTrackerSummary(row),
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: [
      ...aiAppRefs(row.aiApp),
      {
        type: "source_record",
        label: `custom_tracker_entry:${row.id}`,
        id: row.id,
        provider: row.source,
      },
    ],
    provenanceRefs: [],
    relatedRefs: [],
    canonical: {
      table: "custom_tracker_entry",
      trackerId: row.trackerId,
      trackerType: row.trackerType,
      trackerIcon: row.trackerIcon,
      unit: row.trackerUnit ?? null,
      decimals: row.trackerDecimals,
      value: row.value,
      localDate: row.localDate,
      note: row.note ?? null,
      loggedByUserId: row.loggedByUserId ?? null,
      viewerOwnsTracker: row.viewerOwnsTracker,
    },
  };
}

/** The apps show the region and rating in the member's language (`presenters/timeline`). */
function painItem(row: PainEntryTimelineRow): TimelineEvent {
  return {
    kind: "event",
    id: `pain_entry:${row.id}`,
    at: toIso(row.loggedAt),
    domain: "pain",
    title: "Pain",
    summary: `${row.rating} of 10`,
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: [
      ...aiAppRefs(row.aiApp),
      { type: "source_record", label: `pain_entry:${row.id}`, id: row.id, provider: "manual" },
    ],
    provenanceRefs: [],
    relatedRefs: [],
    canonical: {
      table: "pain_entry",
      region: row.region,
      rating: row.rating,
      type: row.type ?? null,
      localDate: row.localDate,
      note: row.note ?? null,
    },
  };
}

/** Typed in by the member (the quick log, the water card, the workouts screen). */
function memberRefs(
  table: string,
  id: number,
  tag: AiAppTag | null | undefined,
): TimelineEvent["sourceRefs"] {
  return [
    ...aiAppRefs(tag),
    { type: "source_record", label: `${table}:${id}`, id, provider: "manual" },
  ];
}

/**
 * Plain water (#493). One item per entry, like every other kind: the timeline
 * groups nothing. The apps show the amount in the member's language, or
 * "Hidden" in hide-numbers mode; a hidden amount never reaches the item.
 */
function waterItem(row: WaterEntryTimelineRow): TimelineEvent {
  const quantityMl =
    typeof row.quantityMl === "number" && Number.isFinite(row.quantityMl) ? row.quantityMl : null;
  return {
    kind: "event",
    id: `plain_water_entry:${row.id}`,
    at: toIso(row.observedAt),
    domain: "water",
    title: "Plain water",
    summary: quantityMl === null ? "Plain water" : `${roundForDisplay(quantityMl, 0)} ml`,
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: memberRefs("plain_water_entry", row.id, row.aiApp),
    provenanceRefs: [],
    relatedRefs: [],
    canonical: {
      table: "plain_water_entry",
      quantityMl,
      hidden: quantityMl === null,
      timeZone: row.timeZone,
    },
  };
}

/** A supplement intake (#493): the supplement's name and the dose taken. */
function supplementIntakeItem(row: SupplementIntakeTimelineRow): TimelineEvent {
  return {
    kind: "event",
    id: `supplement_intake:${row.id}`,
    at: toIso(row.occurredAt),
    domain: "meds_supplements",
    title: row.supplementName,
    summary: row.dose,
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: memberRefs("supplement_intake", row.id, row.aiApp),
    provenanceRefs: [],
    relatedRefs: [],
    canonical: {
      table: "supplement_intake",
      supplementId: row.supplementId,
      supplementName: row.supplementName,
      dose: row.dose,
      note: row.note ?? null,
      timeZone: row.timeZone,
    },
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A workout session (#493). It has a day but no time of day, so it sits at
 * midday UTC (the same calendar day in nearly every time zone) and carries
 * `localDate`, which the apps group by instead of the instant.
 */
function workoutItem(row: WorkoutTimelineRow): TimelineEvent {
  const dateOnly = DATE_ONLY.test(row.date);
  const duration = row.duration && row.duration > 0 ? row.duration : null;
  return {
    kind: "event",
    id: `workout:${row.id}`,
    at: toIso(dateOnly ? `${row.date}T12:00:00.000Z` : row.date),
    domain: "activity",
    title: "Workout",
    summary: duration ? `${row.type}, ${duration} min` : row.type,
    severity: "none",
    confidence: "high",
    reviewState: "unreviewed",
    sourceRefs: memberRefs("workout", row.id, row.aiApp),
    provenanceRefs: [],
    relatedRefs: [],
    canonical: {
      table: "workout",
      workoutType: row.type,
      durationMinutes: duration,
      intensity: row.intensity ?? null,
      effortRating: row.effortRating ?? null,
      exerciseCount: row.exerciseCount ?? null,
      ...(dateOnly ? { localDate: row.date, dateOnly: true } : {}),
    },
  };
}

export function buildDomainTimelineItems(rows: DomainTimelineRows): TimelineEvent[] {
  return [
    ...(rows.trackerEntries ?? []).map(customTrackerItem),
    ...(rows.painEntries ?? []).map(painItem),
    ...(rows.waterEntries ?? []).map(waterItem),
    ...(rows.supplementIntakes ?? []).map(supplementIntakeItem),
    ...(rows.workouts ?? []).map(workoutItem),
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
