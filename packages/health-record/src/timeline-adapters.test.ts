import { describe, expect, test } from "bun:test";
import { buildDomainTimelineItems } from "./timeline-adapters";
import { canonicalEvent, canonicalMetric } from "./canonical";
import { buildTimelinePage } from "./timeline";

describe("anchor domain timeline adapters", () => {
  test("maps all seven source domains with original refs and canonical fields", () => {
    const items = buildDomainTimelineItems({
      consultations: [
        {
          id: 1,
          date: "2026-03-01",
          type: "follow-up",
          facility: "Clinic",
          physician: "Dr A",
          diagnosis: "EIMD",
          sourceFile: "consult.pdf",
        },
      ],
      imagingStudies: [
        {
          id: 2,
          date: "2026-03-02",
          type: "MRI",
          bodyPart: "Knee",
          facility: "Imaging Center",
          conclusion: "No tear",
          sourceFile: "mri.pdf",
        },
      ],
      cardiacExams: [
        {
          id: 3,
          date: "2026-03-03",
          type: "ECG",
          facility: "Cardio",
          conclusion: "Normal sinus rhythm",
          sourceFile: "ecg.pdf",
        },
      ],
      weeklyReviews: [
        { id: 4, weekStart: "2026-03-04", adherence: 8, energy: 7, sleep: 6, notes: "Good week" },
      ],
      insights: [
        {
          id: 5,
          createdAt: "2026-03-05T12:00:00.000Z",
          type: "flag",
          severity: "warning",
          title: "Triglycerides rising",
          body: "Review omega-3 adherence",
        },
      ],
      scheduledEvents: [
        {
          id: 6,
          startDate: "2026-03-06",
          title: "Injection",
          type: "medication",
          frequency: "weekly",
          notes: "GLP-1",
        },
      ],
      dailyReminders: [
        {
          id: 7,
          date: "2026-03-07",
          sourceType: "activity",
          sourceId: 99,
          label: "Walk",
          status: "pending",
        },
      ],
    });
    expect(
      items.map(({ id, domain, title, severity, confidence, reviewState }) => ({
        id,
        domain,
        title,
        severity,
        confidence,
        reviewState,
      })),
    ).toEqual([
      {
        id: "consultation:1",
        domain: "unknown",
        title: "Consultation: follow-up",
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
      },
      {
        id: "imaging_study:2",
        domain: "imaging",
        title: "MRI: Knee",
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
      },
      {
        id: "cardiac_exam:3",
        domain: "cardiac",
        title: "ECG",
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
      },
      {
        id: "weekly_review:4",
        domain: "calendar",
        title: "Weekly review",
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
      },
      {
        id: "insight:5",
        domain: "unknown",
        title: "Triglycerides rising",
        severity: "warning",
        confidence: "medium",
        reviewState: "needs_review",
      },
      {
        id: "scheduled_event:6",
        domain: "meds_supplements",
        title: "Injection",
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
      },
      {
        id: "daily_reminder:7",
        domain: "activity",
        title: "Walk",
        severity: "none",
        confidence: "high",
        reviewState: "unreviewed",
      },
    ]);
    expect(items[0]?.sourceRefs).toEqual([{ type: "source_file", label: "consult.pdf" }]);
    expect(items[0]?.canonical).toEqual({
      table: "consultation",
      type: "follow-up",
      facility: "Clinic",
      physician: "Dr A",
      diagnosis: "EIMD",
    });
    for (const item of items) {
      const [table, id] = item.id.split(":");
      if (!table || !id) throw new Error("Missing adapter reference identity.");
      expect(item.provenanceRefs).toEqual([
        { sourceTable: table, sourceId: Number(id), relation: "source_record" },
      ]);
      expect(item.relatedRefs).toEqual([{ table, id: Number(id), relation: "source_record" }]);
      expect(item.canonical.table).toBe(table);
    }
  });
  test("preserves null fallback, insight review semantics and calendar domains", () => {
    const items = buildDomainTimelineItems({
      consultations: [
        { id: 1, date: "bad", type: "follow-up", facility: null, physician: "Doctor" },
      ],
      weeklyReviews: [{ id: 2, weekStart: "2026-03-01" }],
      insights: ["critical", "warning", "info", "HIGH"].map((severity, index) => ({
        id: index + 3,
        createdAt: "2026-03-01",
        type: "flag",
        title: "Insight",
        severity,
      })),
      scheduledEvents: ["medication", "supplement", "appointment"].map((type, index) => ({
        id: index + 7,
        startDate: "2026-03-01",
        title: "Event",
        type,
        frequency: "once",
      })),
      dailyReminders: [
        {
          id: 10,
          date: "2026-03-01",
          sourceType: "medication",
          sourceId: 1,
          label: "Reminder",
          status: "done",
        },
      ],
    });
    expect(items[0]?.at).toBe("1970-01-01T00:00:00.000Z");
    expect(items[0]?.summary).toBe("Doctor");
    expect(items[0]?.sourceRefs).toEqual([
      { type: "source_record", label: "consultation:1", id: 1 },
    ]);
    expect(items[1]?.summary).toBe("Adherence ?, energy ?, sleep ?");
    expect(
      items.slice(2, 6).map(({ severity, reviewState }) => ({ severity, reviewState })),
    ).toEqual([
      { severity: "critical", reviewState: "needs_review" },
      { severity: "warning", reviewState: "needs_review" },
      { severity: "info", reviewState: "unreviewed" },
      { severity: "none", reviewState: "unreviewed" },
    ]);
    expect(items.slice(6).map((item) => item.domain)).toEqual([
      "meds_supplements",
      "meds_supplements",
      "calendar",
      "meds_supplements",
    ]);
  });
  test("canonical and domain rows merge with equal-time cursor boundaries and derived filters", () => {
    const at = new Date("2026-09-29T00:00:00Z");
    const domains = buildDomainTimelineItems({
      imagingStudies: [
        { id: 1, date: "2026-09-29", type: "MRI", bodyPart: "Knee", sourceFile: "report.pdf" },
      ],
      insights: [
        { id: 2, createdAt: at.toISOString(), type: "flag", title: "Flag", severity: "critical" },
      ],
      scheduledEvents: [
        {
          id: 3,
          startDate: "2026-09-29",
          title: "Appointment",
          type: "appointment",
          frequency: "once",
        },
      ],
    });
    const events = [
      ...domains,
      canonicalEvent({
        id: 1,
        eventAt: at,
        eventType: "sleep_session",
        title: null,
        payloadJson: null,
        dataSource: null,
      }),
      canonicalMetric({
        id: 1,
        sampledAt: at,
        numericValue: 1,
        textValue: null,
        unit: null,
        metadataJson: null,
        metricCode: "steps",
        metricDisplayName: "Steps",
        metricCategory: "activity",
        dataSource: null,
      }),
    ];
    let cursor: string | undefined;
    const ids: string[] = [];
    for (let index = 0; index < events.length; index++) {
      const page = buildTimelinePage(events, { limit: 1, cursor });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    }
    expect(ids).toEqual([
      "health_event:1",
      "imaging_study:1",
      "insight:2",
      "metric_sample:1",
      "scheduled_event:3",
    ]);
    expect(cursor).toBeUndefined();
    expect(
      buildTimelinePage(events, { domain: "imaging", source: "REPORT.PDF", limit: 1 }).items,
    ).toEqual([domains[0]!]);
    expect(buildTimelinePage(events, { source: "report", limit: 1 }).items).toEqual([]);
    expect(
      buildTimelinePage(events, {
        severity: "critical",
        confidence: "medium",
        reviewState: "needs_review",
      }).items,
    ).toEqual([domains[1]!]);
    expect(buildTimelinePage(events, { from: "2026-09-29T00:00:00.001Z" }).items).toEqual([]);
  });
  test("equal timestamps and multi-digit IDs remain lexical boundaries independent of read order", () => {
    const events = buildDomainTimelineItems({
      consultations: [2, 10, 1].map((id) => ({ id, date: "2026-09-29", type: "follow-up" })),
      insights: [10, 2].map((id) => ({
        id,
        createdAt: "2026-09-29T03:00:00+03:00",
        type: "flag",
        title: "Flag",
      })),
    });
    let cursor: string | undefined;
    const ids: string[] = [];
    for (let pageIndex = 0; pageIndex < events.length; pageIndex++) {
      const page = buildTimelinePage([...events].reverse(), { limit: 2, cursor });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(ids).toEqual([
      "consultation:1",
      "consultation:10",
      "consultation:2",
      "insight:10",
      "insight:2",
    ]);
    expect(buildTimelinePage(events, { source: "2" }).items.map((item) => item.id)).toEqual([
      "consultation:2",
      "insight:2",
    ]);
  });
});
