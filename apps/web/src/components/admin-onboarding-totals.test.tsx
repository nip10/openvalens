import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import type { AdminOnboardingTotalsOutput } from "@/utils/admin-settings-keys";

import { AdminOnboardingTotals } from "./admin-onboarding-totals";

function render(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const totals: AdminOnboardingTotalsOutput = {
  windowDays: 30,
  from: "2026-10-15T12:00:00.000Z",
  to: "2026-11-14T12:00:00.000Z",
  minimumGroupSize: 5,
  signUps: 9,
  figures: [
    { id: "first_entry_10m", eligible: 8, reached: 4, share: 0.5, suppressed: false },
    { id: "first_entry_1d", eligible: 7, reached: 4, share: 0.571, suppressed: false },
    { id: "first_entry_7d", eligible: 4, reached: null, share: null, suppressed: true },
    { id: "active_days_2_7", eligible: 4, reached: null, share: null, suppressed: true },
  ],
};

const picker = { windowDays: 30, onWindowChange: () => {} } as const;

describe("AdminOnboardingTotals (#444)", () => {
  test("shows each figure as a share with its count, and the cohort size", () => {
    const html = render(<AdminOnboardingTotals {...picker} status="ready" totals={totals} />);
    expect(html).toContain("Onboarding");
    expect(html).toContain("9 new accounts in the last 30 days.");
    expect(html).toContain("First entry within 10 minutes");
    expect(html).toContain("50%");
    expect(html).toContain("(4 of 8 accounts)");
    expect(html).toContain("57%");
    expect(html).toContain("Any entry on days 2–7");
  });

  test("a suppressed figure shows no count or share", () => {
    const html = render(<AdminOnboardingTotals {...picker} status="ready" totals={totals} />);
    expect(html.match(/Not shown: fewer than 5 accounts old enough/g)).toHaveLength(2);
    expect(html).not.toContain("of 4 accounts");
  });

  test("the window picker marks the chosen window", () => {
    const html = render(<AdminOnboardingTotals {...picker} windowDays={90} status="loading" />);
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toContain("90 days");
    expect(html).toContain("365 days");
  });

  test("an error offers a retry", () => {
    const html = render(<AdminOnboardingTotals {...picker} status="error" onRetry={() => {}} />);
    expect(html).toContain("Could not load onboarding totals.");
    expect(html).toContain("Retry");
  });
});
