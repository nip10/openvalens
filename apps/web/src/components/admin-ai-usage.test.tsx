import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

import type { AdminAiUsageOutput } from "@/utils/admin-settings-keys";

import { AdminAiUsage } from "./admin-ai-usage";

function render(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

const usage: AdminAiUsageOutput = {
  month: "2026-10-01",
  resetsOn: "2026-11-01",
  currency: "EUR",
  monthlyLimitMicros: 1_500_000,
  pricesConfigured: true,
  totals: {
    accounts: 2,
    inputTokens: 120_000,
    outputTokens: 8_000,
    cachedInputTokens: 40_000,
    costMicros: 275_400,
    callCount: 14,
  },
  top: [
    {
      userId: "usr_synthetic_a",
      inputTokens: 90_000,
      outputTokens: 6_000,
      cachedInputTokens: 30_000,
      costMicros: 206_000,
      callCount: 10,
    },
  ],
};

describe("AdminAiUsage (Issue #299)", () => {
  test("shows the cap, this month's totals and the top accounts by opaque id", () => {
    const html = render(<AdminAiUsage status="ready" usage={usage} />);
    expect(html).toContain("AI usage");
    expect(html).toContain("Cap €1.50 per person per month");
    expect(html).toContain("resets on November 1, 2026");
    expect(html).toContain("€0.2754");
    expect(html).toContain("120,000 in (40,000 cached), 8,000 out");
    expect(html).toContain("usr_synthetic_a");
    expect(html).toContain("Highest usage this month");
  });

  test("without a cap or prices, says so", () => {
    const html = render(
      <AdminAiUsage
        status="ready"
        usage={{ ...usage, monthlyLimitMicros: null, pricesConfigured: false, top: [] }}
      />,
    );
    expect(html).toContain("No monthly cap");
    expect(html).toContain("No AI prices configured");
    expect(html).toContain("No AI calls yet this month.");
  });

  test("loading and error states", () => {
    expect(render(<AdminAiUsage status="loading" />)).toContain("AI usage");
    expect(render(<AdminAiUsage status="error" onRetry={() => {}} />)).toContain(
      "Could not load AI usage.",
    );
  });
});
