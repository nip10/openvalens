import { describe, expect, test } from "bun:test";

import { inEnglish } from "@openvalens/i18n/testing";

import { presentLoggingStreak, STREAK_COPY } from "./logging-streak";

function english(streak: Parameters<typeof presentLoggingStreak>[0]) {
  const view = presentLoggingStreak(streak);
  return view && { headline: inEnglish(view.headline), lines: view.lines.map(inEnglish) };
}

const on = {
  state: "on" as const,
  current: 0,
  freezesAvailable: 2,
  repairAvailableUntil: null,
  daysLoggedThisMonth: 0,
  lastLoggedDate: null,
  milestone: null,
};

const NEGATIVE = /\b(lost|lose|broke|broken|fail|failed|missed out|risk|shame|behind|only)\b/i;

describe("logging streak presenter", () => {
  test("hidden, off and missing render nothing", () => {
    expect(english({ state: "hidden" })).toBeNull();
    expect(english({ state: "off" })).toBeNull();
    expect(presentLoggingStreak(undefined)).toBeNull();
  });

  test("an active streak leads with the run, then the month", () => {
    const view = english({ ...on, current: 7, daysLoggedThisMonth: 9, milestone: 7 });
    expect(view).toEqual({
      headline: "7 days in a row",
      lines: [
        "9 days logged this month",
        "7 days of logging. Nicely done.",
        "2 rest days available: a day without logging won't reset the count.",
      ],
    });
  });

  test("after a break the non-resetting month count leads", () => {
    const view = english({
      ...on,
      current: 1,
      daysLoggedThisMonth: 12,
      repairAvailableUntil: "2026-03-09",
      freezesAvailable: 0,
    });
    expect(view?.headline).toBe("12 days logged this month");
    expect(view?.lines).toContain(
      "If you missed a day, you can still add it until the end of 2026-03-09.",
    );
  });

  test("copy stays neutral", () => {
    const views = [
      english({ ...on }),
      english({ ...on, current: 1, daysLoggedThisMonth: 1, freezesAvailable: 1 }),
      english({ ...on, current: 3, repairAvailableUntil: "2026-03-09" }),
    ];
    const text = [
      ...views.flatMap((view) => [view!.headline, ...view!.lines]),
      ...Object.values(STREAK_COPY).map(inEnglish),
    ].join("\n");
    expect(text).not.toMatch(NEGATIVE);
  });
});
