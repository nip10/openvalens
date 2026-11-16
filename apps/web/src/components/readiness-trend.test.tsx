import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReadinessHistory } from "@openvalens/api/score-contract";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import { ReadinessTrend } from "./readiness-trend";

function render(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const parts = (sleep: number | null, rhr: number | null) => ({
  sleep,
  resting_heart_rate: rhr,
  activity_load: null,
});

function history(days: ReadinessHistory["days"]): ReadinessHistory {
  return {
    kind: "readiness_history",
    experimental: true,
    algorithmVersion: "readiness-0.1.0-experimental",
    status: "available",
    withheldReason: null,
    days,
  };
}

/** scores#8 — the 30-day line beside the gauge. Synthetic scores. */
describe("readiness trend (web)", () => {
  test("shows yesterday's figure and the part that moved most", () => {
    const html = render(
      <ReadinessTrend
        history={history([
          { date: "2026-10-13", score: null, profile: null, parts: parts(null, null) },
          { date: "2026-10-14", score: 50, profile: "physiology_enhanced", parts: parts(50, 50) },
          { date: "2026-10-15", score: 54, profile: "physiology_enhanced", parts: parts(58, 50) },
        ])}
      />,
    );
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Sleep +8 since yesterday");
    expect(html).toContain("Yesterday");
    expect(html).toContain(">50<");
    expect(html).toContain("2 of 3");
  });

  test("with fewer than two scored days it says the line comes later", () => {
    const html = render(
      <ReadinessTrend
        history={history([
          { date: "2026-10-15", score: 54, profile: "physiology_enhanced", parts: parts(58, 50) },
        ])}
      />,
    );
    expect(html).toContain("Your 30-day line appears after a few days with a score.");
    expect(html).not.toContain("Yesterday");
  });

  test("a withheld history shows nothing", () => {
    const html = render(
      <ReadinessTrend
        history={{ ...history([]), status: "withheld", withheldReason: "adults_only" }}
      />,
    );
    expect(html).toBe("");
  });
});
