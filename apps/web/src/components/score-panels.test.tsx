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
    expect(html).not.toContain("out of 100</span>");
  });

  test("goal progress lists each goal with its state", () => {
    const html = renderToStaticMarkup(<GoalProgressCard result={computeGoalProgress([])} />);
    expect(html).toContain("Goal progress");
    expect(html).toContain("Add a goal with a target to see goal progress.");
    expect(html).toContain("0 of 0 goals counted.");
  });
});
