import { describe, expect, test } from "bun:test";

import { createAppI18n } from "@openvalens/i18n";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";

import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
  timelineSummary,
  timelineTitle,
  type TimelineItemLike,
} from "./timeline";

const portugueseI18n = createAppI18n("pt-PT");

const item = (id: string, at: string, extra: Partial<TimelineItemLike> = {}): TimelineItemLike => ({
  id,
  at,
  domain: "body",
  title: "Weight",
  summary: "72.4 kg",
  severity: "none",
  sourceRefs: [],
  ...extra,
});

describe("timeline presenter", () => {
  test("groups by local day, newest day first, keeping item order, with local times", () => {
    const groups = groupTimelineByDay(
      [
        item("a", "2026-10-01T22:30:00.000Z"), // 23:30 in Lisbon (UTC+1)
        item("b", "2026-10-01T07:00:00.000Z"),
        item("c", "2026-09-30T23:30:00.000Z"), // 00:30 on 1 Oct in Lisbon
        item("d", "2026-09-30T12:00:00.000Z"),
      ],
      "Europe/Lisbon",
    );
    expect(groups.map((g) => [g.day, g.items.map((i) => [i.id, i.time])])).toEqual([
      [
        "2026-10-01",
        [
          ["a", "23:30"],
          ["b", "08:00"],
          ["c", "00:30"],
        ],
      ],
      ["2026-09-30", [["d", "13:00"]]],
    ]);
  });

  test("domains get sentence-case labels; unknown domains fall back", () => {
    expect(inEnglish(domainLabel("meds_supplements"))).toBe("Meds and supplements");
    expect(inEnglish(domainLabel("vitals"))).toBe("Vitals");
    expect(inEnglish(domainLabel("something_new"))).toBe("Other");
  });

  test("technical day/time keys stay ISO and follow the explicit timezone only", () => {
    const groups = groupTimelineByDay([item("a", "2026-10-01T22:30:00.000Z")], "UTC");
    expect(groups[0]?.day).toBe("2026-10-01");
    expect(groups[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(groups[0]?.items[0]?.time).toBe("22:30");
    // Same instant, different explicit zone: the day key shifts, locale does not.
    const lisbon = groupTimelineByDay([item("a", "2026-09-30T23:30:00.000Z")], "Europe/Lisbon");
    expect(lisbon[0]?.day).toBe("2026-10-01");
  });

  test("severity maps to a semantic tone; none and info stay neutral", () => {
    expect(severityTone("critical")).toBe("destructive");
    expect(severityTone("warning")).toBe("warning");
    expect(severityTone("info")).toBeNull();
    expect(severityTone("none")).toBeNull();
  });

  test("source label falls back to the first labelled source", () => {
    expect(sourceLabel(item("a", "2026-10-01T00:00:00.000Z"), englishI18n)).toBeNull();
    expect(
      sourceLabel(
        item("a", "2026-10-01T00:00:00.000Z", {
          sourceRefs: [{ type: "data_source", label: "Withings" }],
        }),
        englishI18n,
      ),
    ).toBe("Withings");
  });

  test("source label names the platform, the vendor or a manual entry, never the raw id", () => {
    const from = (provider: string, label = "app.openvalens.demo.tracker") =>
      item("a", "2026-10-01T00:00:00.000Z", {
        sourceRefs: [{ type: "data_source", label, provider }],
      });
    expect(sourceLabel(from("apple_health"), englishI18n)).toBe("Apple Health");
    expect(sourceLabel(from("health_connect"), portugueseI18n)).toBe("Health Connect");
    expect(sourceLabel(from("oura", "Oura (cloud)"), englishI18n)).toBe("Oura");
    expect(sourceLabel(from("whoop", "WHOOP (cloud)"), englishI18n)).toBe("WHOOP");
    // An unknown channel keeps the stored label rather than guessing.
    expect(sourceLabel(from("future_vendor", "Future"), englishI18n)).toBe("Future");
    const manual = item("a", "2026-10-01T00:00:00.000Z", {
      sourceRefs: [{ type: "manual", label: "manual", provider: "manual" }],
    });
    expect(sourceLabel(manual, englishI18n)).toBe("Manual");
    expect(sourceLabel(manual, portugueseI18n)).toBe("Manual");
  });

  test("metric record types are translated and keep the value and unit as the detail", () => {
    const heartRate = item("metric_sample:1", "2026-10-01T00:00:00.000Z", {
      kind: "metric",
      domain: "vitals",
      title: "Heart Rate",
      summary: "Heart Rate 72 bpm",
      canonical: { metricCode: "heart_rate", value: 72, unit: "bpm" },
    });
    expect(timelineTitle(heartRate, englishI18n)).toBe("Heart rate");
    expect(timelineTitle(heartRate, portugueseI18n)).toBe("Frequência cardíaca");
    expect(timelineSummary(heartRate, englishI18n)).toBe("72 bpm");

    const weight = item("metric_sample:2", "2026-10-01T00:00:00.000Z", {
      kind: "metric",
      canonical: { metricCode: "weight", value: 72.44, unit: "kg" },
    });
    expect(timelineSummary(weight, englishI18n)).toBe("72.4 kg");
    expect(timelineSummary(weight, portugueseI18n)).toBe("72,4 kg");

    const steps = item("metric_sample:3", "2026-10-01T00:00:00.000Z", {
      kind: "metric",
      canonical: { metricCode: "steps", value: 8000, unit: "count" },
    });
    expect(timelineTitle(steps, portugueseI18n)).toBe("Passos");
    expect(timelineSummary(steps, englishI18n)).toBe("8,000 steps");
  });

  test("unknown metrics keep the stored name and unit; lab markers stay as stored", () => {
    const glucose = item("metric_sample:4", "2026-10-01T00:00:00.000Z", {
      kind: "metric",
      domain: "labs",
      title: "Glucose",
      summary: "Glucose 95 mg/dL",
      canonical: { metricCode: "blood_marker_glucose", value: 95, unit: "mg/dL" },
    });
    expect(timelineTitle(glucose, portugueseI18n)).toBe("Glucose");
    expect(timelineSummary(glucose, englishI18n)).toBe("95 mg/dL");
    const scored = item("metric_sample:5", "2026-10-01T00:00:00.000Z", {
      kind: "metric",
      title: "Custom",
      canonical: { metricCode: "custom_score", value: 81, unit: "score" },
    });
    expect(timelineSummary(scored, englishI18n)).toBe("81");
  });

  test("sleep and workout events get translated titles; other events keep the server copy", () => {
    const sleep = item("health_event:1", "2026-10-01T00:00:00.000Z", {
      kind: "event",
      domain: "sleep",
      title: "sleep_session",
      summary: "Sleep session",
      canonical: { type: "sleep_session", title: null, durationMinutes: 452 },
    });
    expect(timelineTitle(sleep, portugueseI18n)).toBe("Sono");
    expect(timelineSummary(sleep, englishI18n)).toBe("7h 32m");
    const shortSleep = { ...sleep, canonical: { type: "sleep_session", title: null } };
    expect(timelineSummary(shortSleep, englishI18n)).toBe("Sleep session");

    const workout = item("health_event:2", "2026-10-01T00:00:00.000Z", {
      kind: "event",
      title: "workout",
      canonical: { type: "workout", title: null },
    });
    expect(timelineTitle(workout, englishI18n)).toBe("Workout");
    const namedWorkout = { ...workout, canonical: { type: "workout", title: "Morning run" } };
    expect(timelineTitle(namedWorkout, englishI18n)).toBe("Morning run");

    const review = item("weekly_review:1", "2026-10-01T00:00:00.000Z", {
      kind: "event",
      title: "Weekly review",
      summary: "Felt good",
      canonical: { table: "weekly_review" },
    });
    expect(timelineTitle(review, englishI18n)).toBe("Weekly review");
    expect(timelineSummary(review, englishI18n)).toBe("Felt good");
  });
});
