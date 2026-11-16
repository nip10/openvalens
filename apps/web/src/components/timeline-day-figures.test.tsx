import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { dayFigureParts, dayTotalsRanges, TimelineDayFigures } from "./timeline-day-figures";

/** timeline#6 — the day header's line of figures. Synthetic values. */
describe("timeline day figures", () => {
  const full = {
    date: "2026-10-01",
    asleepMinutes: 530,
    steps: 11_240,
    meals: 3,
    weightKg: 66.6,
  };

  test("leads with the day's figures in a fixed order", () => {
    expect(dayFigureParts(full, englishI18n).map((part) => part.text)).toEqual([
      "8h 50m sleep",
      "11k steps",
      "3 meals",
      "66.6 kg",
    ]);
    expect(
      dayFigureParts({ ...full, meals: 1, steps: 800, weightKg: null }, englishI18n).map(
        (part) => part.text,
      ),
    ).toEqual(["8h 50m sleep", "800 steps", "1 meal"]);
  });

  test("a day with no figures shows no line", () => {
    const empty = {
      date: "2026-10-01",
      asleepMinutes: null,
      steps: null,
      meals: null,
      weightKg: null,
    };
    expect(dayFigureParts(empty, englishI18n)).toEqual([]);
    const html = renderToStaticMarkup(
      <I18nProvider i18n={englishI18n}>
        <TimelineDayFigures figures={empty} />
        <TimelineDayFigures figures={undefined} />
      </I18nProvider>,
    );
    expect(html).toBe("");
    const shown = renderToStaticMarkup(
      <I18nProvider i18n={englishI18n}>
        <TimelineDayFigures figures={full} />
      </I18nProvider>,
    );
    expect(shown).toContain('data-day-figure="steps"');
    expect(shown).toContain("11k steps");
  });

  test("loaded days are covered by as few 62-day calls as the gaps allow", () => {
    expect(dayTotalsRanges([])).toEqual([]);
    expect(dayTotalsRanges(["2026-10-01", "2026-09-30", "2026-10-01", "2026-09-01"])).toEqual([
      { from: "2026-09-01", to: "2026-10-01" },
    ]);
    // 2026-08-01 still fits the 62 days ending 2026-10-01; 2026-07-31 starts a new call.
    expect(dayTotalsRanges(["2026-10-01", "2026-08-01", "2026-07-31", "2026-07-30"])).toEqual([
      { from: "2026-08-01", to: "2026-10-01" },
      { from: "2026-07-30", to: "2026-07-31" },
    ]);
  });
});
