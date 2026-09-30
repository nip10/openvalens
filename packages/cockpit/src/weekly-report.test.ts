import { describe, expect, test } from "bun:test";

import {
  buildWeekWindow,
  buildWeeklyMessageDraft,
  generateWeeklyReport,
  summarizeAdherence,
  summarizeGoalsProgression,
  summarizeSleepRecovery,
  summarizeUpcomingEvents,
  summarizeWeightProgress,
  withFallback,
} from "./weekly-report";

describe("cockpit — weekly report helpers", () => {
  test("buildWeekWindow returns Mon..Sun UTC window", () => {
    const window = buildWeekWindow(new Date("2026-03-08T12:34:56.000Z")); // Sunday
    expect(window.start).toBe("2026-03-02");
    expect(window.end).toBe("2026-03-08");
  });

  test("buildWeekWindow accepts an explicit weekStart", () => {
    const window = buildWeekWindow(new Date("2026-03-08T12:00:00.000Z"), "2026-03-09");
    expect(window.start).toBe("2026-03-09");
    expect(window.end).toBe("2026-03-15");
  });

  test("summarizeWeightProgress formats first / last / delta", () => {
    expect(
      summarizeWeightProgress({
        startKg: 82,
        endKg: 81.4,
        deltaKg: -0.6,
        sampleCount: 4,
      }),
    ).toBe("82.0 kg -> 81.4 kg (delta -0.6 kg).");
    expect(
      summarizeWeightProgress({
        startKg: 80,
        endKg: 81,
        deltaKg: 1,
        sampleCount: 2,
      }),
    ).toBe("80.0 kg -> 81.0 kg (delta +1.0 kg).");
  });

  test("summarizeGoalsProgression reports active count + latest check-in", () => {
    expect(
      summarizeGoalsProgression({
        activeGoalsCount: 0,
        latestCheckinDate: null,
        latestCheckinSnippet: null,
      }),
    ).toBe("No active goals right now.");
    expect(
      summarizeGoalsProgression({
        activeGoalsCount: 2,
        latestCheckinDate: null,
        latestCheckinSnippet: null,
      }),
    ).toBe("2 active goals.");
    expect(
      summarizeGoalsProgression({
        activeGoalsCount: 1,
        latestCheckinDate: "2026-03-07",
        latestCheckinSnippet: "Bench 90kg x5",
      }),
    ).toBe("1 active goal. Latest check-in (2026-03-07): Bench 90kg x5.");
  });

  test("summarizeAdherence composes parts and clips notes", () => {
    expect(
      summarizeAdherence({
        adherence: 8,
        energy: 7,
        sleep: 6,
        notesSnippet: null,
      }),
    ).toBe("adherence 8/10, energy 7/10, sleep 6/10.");
    expect(
      summarizeAdherence({
        adherence: null,
        energy: null,
        sleep: null,
        notesSnippet:
          "a very very very very very very very very very very very very very long note",
      }),
    ).toMatch(/Notes: /);
  });

  test("summarizeSleepRecovery returns empty when both numbers are missing", () => {
    expect(
      summarizeSleepRecovery({
        sevenDayAverageMinutes: null,
        averageSleepDebtMinutes: null,
        status: "optimal",
        confidence: "high",
      }),
    ).toBe("");
    expect(
      summarizeSleepRecovery({
        sevenDayAverageMinutes: 420,
        averageSleepDebtMinutes: 30,
        status: "acceptable",
        confidence: "high",
      }),
    ).toBe("7.0h avg, 30 min/day debt, status acceptable, confidence high.");
  });

  test("summarizeUpcomingEvents joins the top three items", () => {
    expect(
      summarizeUpcomingEvents({
        items: [
          { title: "A", startDate: "2026-03-09", frequency: "daily" },
          { title: "B", startDate: "2026-03-10", frequency: "weekly" },
          { title: "C", startDate: "2026-03-11", frequency: "monthly" },
          { title: "D", startDate: "2026-03-12", frequency: "weekly" },
        ],
      }),
    ).toBe("A (2026-03-09, daily); B (2026-03-10, weekly); C (2026-03-11, monthly)");
    expect(summarizeUpcomingEvents({ items: [] })).toBe("");
  });

  test("withFallback fills empty sections with the no-data line", () => {
    const { sections, fallbackSections } = withFallback({
      weightProgress: null,
      goalsProgression: null,
      adherence: null,
      sleepRecovery: null,
      upcomingEvents: null,
      otherRelevant: null,
    });
    expect(fallbackSections).toEqual([
      "weightProgress",
      "goalsProgression",
      "adherence",
      "sleepRecovery",
      "upcomingEvents",
      "otherRelevant",
    ]);
    expect(sections.weightProgress).toMatch(/Weight progress for the week: No data logged/);
  });

  test("withFallback leaves populated sections intact", () => {
    const { sections, fallbackSections } = withFallback({
      weightProgress: {
        startKg: 80,
        endKg: 80.5,
        deltaKg: 0.5,
        sampleCount: 3,
      },
      goalsProgression: {
        activeGoalsCount: 1,
        latestCheckinDate: "2026-03-07",
        latestCheckinSnippet: "Bench 90kg x5",
      },
      adherence: null,
      sleepRecovery: null,
      upcomingEvents: null,
      otherRelevant: null,
    });
    expect(sections.weightProgress).toMatch(/80\.0 kg/);
    expect(sections.goalsProgression).toMatch(/1 active goal/);
    expect(fallbackSections).toEqual([
      "adherence",
      "sleepRecovery",
      "upcomingEvents",
      "otherRelevant",
    ]);
  });

  test("buildWeeklyMessageDraft emits the canonical structure", () => {
    const draft = buildWeeklyMessageDraft({
      weightProgress: "FALLBACK",
      goalsProgression: "FALLBACK",
      adherence: "FALLBACK",
      sleepRecovery: "FALLBACK",
      upcomingEvents: "FALLBACK",
      otherRelevant: "FALLBACK",
    });
    expect(draft).toMatch(/Hi,/);
    expect(draft).toMatch(/Here is the weekly update/);
    expect(draft).toMatch(/Weight progress for the week: FALLBACK/);
    expect(draft).toMatch(/Thanks\./);
  });
});

describe("cockpit — generateWeeklyReport", () => {
  test("produces deterministic weekly report payload", () => {
    const report = generateWeeklyReport({
      now: new Date("2026-03-08T12:34:56.000Z"),
      slices: {
        weightProgress: {
          startKg: 82,
          endKg: 81.4,
          deltaKg: -0.6,
          sampleCount: 4,
        },
        goalsProgression: {
          activeGoalsCount: 2,
          latestCheckinDate: "2026-03-07",
          latestCheckinSnippet: "Bench 90kg x5",
        },
        adherence: {
          adherence: 8,
          energy: 7,
          sleep: 6,
          notesSnippet: null,
        },
        sleepRecovery: {
          sevenDayAverageMinutes: 420,
          averageSleepDebtMinutes: 30,
          status: "acceptable",
          confidence: "high",
        },
        upcomingEvents: {
          items: [{ title: "Follow-up", startDate: "2026-03-09", frequency: "once" }],
        },
        otherRelevant: null,
      },
    });
    expect(report.weekRange).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(report.meta.hasPartialData).toBe(true);
    expect(report.meta.fallbackSections).toEqual(["otherRelevant"]);
    expect(report.sections.weightProgress).toMatch(/82\.0 kg/);
    expect(report.sections.goalsProgression).toMatch(/Latest check-in/);
    expect(report.sections.otherRelevant).toMatch(/No data logged/);
    expect(report.messageDraft).toMatch(/Hi,/);
  });

  test("flags fallback sections when slices are missing", () => {
    const report = generateWeeklyReport({
      now: new Date("2026-03-08T12:00:00.000Z"),
      slices: {
        weightProgress: null,
        goalsProgression: null,
        adherence: null,
        sleepRecovery: null,
        upcomingEvents: null,
        otherRelevant: null,
      },
    });
    expect(report.meta.hasPartialData).toBe(true);
    expect(report.meta.fallbackSections.length).toBe(6);
    for (const section of report.meta.fallbackSections) {
      expect(report.sections[section]).toMatch(/No data logged/);
    }
  });

  test("is deterministic across repeated calls", () => {
    const params = {
      now: new Date("2026-03-08T12:00:00.000Z"),
      slices: {
        weightProgress: {
          startKg: 80,
          endKg: 80.5,
          deltaKg: 0.5,
          sampleCount: 3,
        },
        goalsProgression: {
          activeGoalsCount: 1,
          latestCheckinDate: "2026-03-07",
          latestCheckinSnippet: "x",
        },
        adherence: {
          adherence: 8,
          energy: null,
          sleep: null,
          notesSnippet: null,
        },
        sleepRecovery: {
          sevenDayAverageMinutes: 420,
          averageSleepDebtMinutes: 30,
          status: "acceptable",
          confidence: "high",
        },
        upcomingEvents: {
          items: [{ title: "Follow-up", startDate: "2026-03-09", frequency: "once" }],
        },
        otherRelevant: null,
      },
    };
    expect(generateWeeklyReport(params)).toEqual(generateWeeklyReport(params));
  });
});
