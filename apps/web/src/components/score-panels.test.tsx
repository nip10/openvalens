import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { computeGoalProgress } from "@openvalens/api/score-goal-progress";
import { computeReadiness } from "@openvalens/api/score-readiness";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { GoalProgressCard, ReadinessCard } from "./score-panels";

/** Renders in English through Lingui (#67). */
function renderToStaticMarkup(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const AS_OF = "2026-10-15";
const day = (daysAgo: number) =>
  new Date(Date.parse(`${AS_OF}T00:00:00.000Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
const series = (daysAgo: number, count: number, value: number) =>
  Array.from({ length: count }, (_, index) => ({ date: day(daysAgo + index), value }));

describe("score panels (web)", () => {
  test("a withheld readiness index shows no number, the reason and the experimental label", () => {
    const html = renderToStaticMarkup(
      <ReadinessCard
        result={computeReadiness({ sleepMinutes: [], restingHeartRate: [], steps: [] }, AS_OF)}
      />,
    );
    expect(html).toContain("Experimental");
    expect(html).toContain("not enough recent data");
    expect(html).toContain("Experimental readiness index not available.");
    expect(html).toContain("Not recorded by OpenValens yet");
    for (const label of [
      "Sleep",
      "Resting heart rate",
      "Recent activity load",
      "Heart rate variability",
      "How you feel (check-in)",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("whitespace-normal break-words");
    expect(html).toContain("shrink-0 text-right");
    expect(html).toContain("—");
    expect(html).not.toContain("out of 100</span>");
  });

  test("goal progress lists each goal with its state", () => {
    const html = renderToStaticMarkup(<GoalProgressCard result={computeGoalProgress([])} />);
    expect(html).toContain("Goal progress");
    expect(html).toContain("Add a goal with a target to see goal progress.");
    expect(html).toContain("0 of 0 goals counted.");
  });

  test("available readiness keeps numeric component figures in the reserved value column", () => {
    const sleep = [...series(1, 28, 450), { date: AS_OF, value: 405 }];
    const restingHeartRate = [...series(1, 28, 60), { date: AS_OF, value: 63 }];
    const steps = [...series(4, 31, 8000), ...series(1, 3, 8000)];
    const html = renderToStaticMarkup(
      <ReadinessCard
        result={computeReadiness({ sleepMinutes: sleep, restingHeartRate, steps }, AS_OF)}
      />,
    );
    expect(html).toContain("42");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("shrink-0 text-right");
  });
});
