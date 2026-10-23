import { describe, expect, test } from "bun:test";
import { computeWeeklyActivityLoad, type ActivitySession } from "@openvalens/activity/load";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";

import type { ActivityLoadResult } from "../activity-load-contract";
import {
  ACTIVITY_LOAD_COPY,
  ACTIVITY_LOAD_WITHHELD_EXPLANATIONS,
  activityLoadView,
  canRateEffortToday,
  EFFORT_QUESTION,
  EFFORT_RATING_OPTIONS,
  effortRatingLabel,
  formatDay,
  INTENSITY_DESCRIPTIONS,
  INTENSITY_LABELS,
  sessionEffortText,
} from "./activity-load";

/** Issue #99 — shared web/native copy and view models. All data is synthetic. */

const AS_OF = "2026-10-16";

function daysBefore(offset: number): string {
  return new Date(Date.parse(`${AS_OF}T00:00:00.000Z`) - offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function s(daysAgo: number, overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    ref: `workout:${daysAgo}-${Math.random()}`,
    date: daysBefore(daysAgo),
    source: "manual",
    durationMinutes: 30,
    intensity: "moderate",
    intensityMethod: "self_reported_talk_test",
    effortRating: 5,
    strengthVolumeKg: null,
    ...overrides,
  };
}

function result(sessions: ActivitySession[]): ActivityLoadResult {
  return {
    kind: "activity_load",
    status: "available",
    withheldReason: null,
    load: computeWeeklyActivityLoad({
      asOf: AS_OF,
      sessions,
      steps: [{ date: daysBefore(1), steps: 7400 }],
    }),
  };
}

const full = result([
  s(0, { intensity: "vigorous", durationMinutes: 40, effortRating: 8 }),
  s(1, { durationMinutes: 60, effortRating: null }),
  s(2, { intensity: null, intensityMethod: "none", effortRating: 4, strengthVolumeKg: 3200 }),
  s(8),
  s(15),
  s(22),
]);

describe("activityLoadView", () => {
  test("shows both numbers with formulas, units, WHO range and citation", () => {
    const view = activityLoadView(full, englishI18n);
    expect(view.available).toBe(true);
    expect(view.windowText).toBe("Last 7 days: Sat 10 Oct – Fri 16 Oct");
    expect(view.activeMinutes).toMatchObject({
      valueText: "140",
      unitText: "min",
      statusText: "Below the WHO range of 150–300 minutes a week.",
    });
    expect(view.activeMinutes!.breakdown).toEqual([
      "Moderate: 60 min",
      "Vigorous: 40 min (counts double)",
      "Light: 0 min (not counted)",
    ]);
    expect(view.activeMinutes!.coverage).toEqual([
      "2 of 3 sessions have an intensity.",
      "30 min without an intensity are not counted.",
    ]);
    expect(view.activeMinutes!.sources.join(" ")).toContain("doi:10.1136/bjsports-2020-102955");
    expect(view.activeMinutes!.formula).toContain("2 × vigorous");
    expect(view.effort).toMatchObject({ valueText: "440", unitText: "points" });
    expect(view.effort!.coverage).toContain(inEnglish(ACTIVITY_LOAD_COPY.effortMissing));
    expect(view.effortDays.find((d) => d.date === daysBefore(1))!.valueText).toBe("not rated");
    expect(view.effortDays.find((d) => d.date === daysBefore(3))!.valueText).toBe("—");
    expect(view.comparison).toMatchObject({ available: true });
    expect(view.comparison!.text).toContain("well above");
    expect(view.comparison!.detail).toContain("this week not included");
    expect(view.context[0]).toBe("Steps: 7,400 over 1 day with step data.");
    expect(view.context[1]).toContain("3,200 kg");
    expect(view.versionText).toContain("activity-load-0.1.0");
  });

  test("unavailable states say why and never show zero", () => {
    const view = activityLoadView(result([]), englishI18n);
    expect(view.activeMinutes!.valueText).toBe("—");
    expect(view.activeMinutes!.statusText).toContain("not zero");
    expect(view.effort!.valueText).toBe("—");
    expect(view.comparison!.available).toBe(false);
    const sparse = activityLoadView(result([s(0), s(8)]), englishI18n);
    expect(sparse.comparison!.text).toBe(
      "Shown once at least 3 of the previous 4 weeks have rated sessions (found 1).",
    );
  });

  test("withheld for a declared under-18", () => {
    const view = activityLoadView(
      {
        kind: "activity_load",
        status: "withheld",
        withheldReason: "adults_only",
        load: null,
      },
      englishI18n,
    );
    expect(view).toMatchObject({
      available: false,
      activeMinutes: null,
      effort: null,
      withheldExplanation: inEnglish(ACTIVITY_LOAD_WITHHELD_EXPLANATIONS.adults_only),
    });
  });

  test("screen-reader labels carry the number and its meaning without colour", () => {
    const view = activityLoadView(full, englishI18n);
    expect(view.activeMinutes!.accessibilityLabel).toBe(
      "Active minutes, last 7 days: 140 minutes. Below the WHO range of 150–300 minutes a week.",
    );
    expect(view.effort!.accessibilityLabel).toContain("440 points");
    for (const day of view.effortDays) expect(day.accessibilityLabel).toMatch(/^\w{3} \d+ \w{3}: /);
  });
});

describe("session capture helpers", () => {
  test("effort labels use CR-10 anchors", () => {
    expect(EFFORT_RATING_OPTIONS).toHaveLength(11);
    expect(effortRatingLabel(0)).toBe("0 · Rest");
    expect(effortRatingLabel(7)).toBe("7 · Very hard");
    expect(effortRatingLabel(6)).toBe("6");
  });

  test("session text shows missing values as missing", () => {
    expect(
      sessionEffortText({ date: AS_OF, duration: 45, intensity: "moderate", effortRating: 7 }),
    ).toBe("Moderate · effort 7/10 · 315 points");
    expect(
      sessionEffortText({ date: AS_OF, duration: 45, intensity: null, effortRating: null }),
    ).toBe("No intensity · effort not rated");
    expect(
      sessionEffortText({ date: AS_OF, duration: null, intensity: "light", effortRating: 3 }),
    ).toBe("Light · effort 3/10 · no duration, no points");
  });

  test("rating is offered on the session's own day", () => {
    expect(canRateEffortToday(AS_OF, AS_OF)).toBe(true);
    expect(canRateEffortToday(daysBefore(1), AS_OF)).toBe(false);
  });

  test("formatDay is time-zone independent", () => {
    expect(formatDay("2026-10-12")).toBe("Mon 12 Oct");
  });
});

describe("copy review (#99 wording rules)", () => {
  const BANNED =
    /\b(diagnos\w*|detects?|screens? for|prevent\w*|treat\w*|cure\w*|at risk|risk|injur\w*|danger\w*|sweet spot|overtrain\w*|recover\w*|strain|PAI|WHOOP|adds? \d+ years|years gained|predict\w*|optimal|healthy|unhealthy|clinically|you need|you should)\b/i;

  function allTexts(): string[] {
    const views = [
      activityLoadView(full, englishI18n),
      activityLoadView(result([]), englishI18n),
      activityLoadView(result([s(0), s(8)]), englishI18n),
      activityLoadView(
        result([
          ...[0, 1].map((w) => s(w * 7 + 1, { source: "device:2" })),
          ...[2, 3, 4].map((w) => s(w * 7 + 1, { source: "device:1" })),
        ]),
        englishI18n,
      ),
      activityLoadView(result([s(1, { effortRating: null })]), englishI18n),
    ];
    const texts: string[] = [
      ...Object.values(ACTIVITY_LOAD_COPY).map((text) =>
        typeof text === "string" ? text : inEnglish(text),
      ),
      ...Object.values(ACTIVITY_LOAD_WITHHELD_EXPLANATIONS).map(inEnglish),
      ...Object.values(INTENSITY_LABELS),
      ...Object.values(INTENSITY_DESCRIPTIONS),
      EFFORT_QUESTION,
      ...EFFORT_RATING_OPTIONS.map(effortRatingLabel),
    ];
    for (const view of views) {
      texts.push(
        view.title,
        view.intro,
        view.windowText,
        view.versionText,
        ...view.context,
        ...view.notes,
      );
      if (view.withheldExplanation) texts.push(view.withheldExplanation);
      for (const part of [view.activeMinutes, view.effort]) {
        if (!part) continue;
        texts.push(
          part.statusText,
          part.formula,
          part.accessibilityLabel,
          ...part.breakdown,
          ...part.coverage,
          ...part.sources,
        );
      }
      if (view.comparison)
        texts.push(
          view.comparison.text,
          view.comparison.limits,
          view.comparison.accessibilityLabel,
          view.comparison.detail ?? "",
        );
      for (const day of view.effortDays) texts.push(day.valueText, day.accessibilityLabel);
    }
    return texts;
  }

  test("pluralises counts as whole sentences", () => {
    const view = activityLoadView(result([s(1, { effortRating: null })]), englishI18n);
    expect(view.activeMinutes!.coverage[0]).toBe("1 of 1 session has an intensity.");
    expect(view.effort!.coverage[0]).toBe("0 of 1 session rated.");
  });

  test("no banned phrases, outcome claims or proprietary scales anywhere", () => {
    for (const text of allTexts()) expect(text).not.toMatch(BANNED);
  });
});
