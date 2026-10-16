import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import type { InsightPreferences, InsightsResult } from "@openvalens/api/insight-contract";
import { defaultKindChannels, runInsightRules } from "@openvalens/api/insight-rules";
import { computeGoalProgress } from "@openvalens/api/score-goal-progress";
import { computeReadiness } from "@openvalens/api/score-readiness";
import { renderToStaticMarkup } from "react-dom/server";

import { InsightNotificationsForm } from "./insight-notifications-section";
import { InsightsCard, PushOfferCard, SummaryCards } from "./insights-panel";

const AS_OF = "2026-10-15";

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function result(): InsightsResult {
  const series = Array.from({ length: 40 }, (_, i) => ({
    date: addDays(AS_OF, -i),
    value: (i <= 8 ? 68 : 60) + (i % 2 === 0 ? 1 : -1),
    source: null,
  }));
  const output = runInsightRules({
    asOf: AS_OF,
    series: { resting_heart_rate: series },
    goals: null,
  });
  return {
    engineVersion: output.engineVersion,
    asOf: AS_OF,
    status: "available",
    withheldReason: null,
    insights: output.insights,
    readiness: output.readiness,
    hiddenCount: 0,
    budget: { changeCap: 2, suppressedChanges: 0 },
    offerPush: true,
  };
}

describe("insights panel (web)", () => {
  test("renders each insight with explanation, coverage and real buttons; not-ready rows say why", () => {
    const html = renderToStaticMarkup(
      <InsightsCard result={result()} pendingId={null} onFeedback={() => {}} />,
    );
    expect(html).toContain("Resting heart rate higher than your usual");
    expect(html).toContain("usual day-to-day variation");
    expect(html).toContain("Based on 7 of the last 7 days");
    expect(html).toContain("<button");
    expect(html).toContain("Not useful");
    expect(html).toContain("Still learning your usual");
    expect(html).not.toContain("Ask the coach");
  });

  test("the coach hand-off appears only with AI consent; withheld shows the adults-only note", () => {
    const withCoach = renderToStaticMarkup(
      <InsightsCard
        result={result()}
        pendingId={null}
        coachLink={<a href="/coach">Ask the coach about this</a>}
        onFeedback={() => {}}
      />,
    );
    expect(withCoach).toContain("Ask the coach about this");
    const withheld = renderToStaticMarkup(
      <InsightsCard
        result={{
          ...result(),
          status: "withheld",
          withheldReason: "adults_only",
          insights: [],
          readiness: [],
        }}
        pendingId={null}

        onFeedback={() => {}}
      />,
    );
    expect(withheld).toContain("adults 18 and over");
  });

  test("summaries lead with the readiness index and goal progress", () => {
    const html = renderToStaticMarkup(
      <SummaryCards
        readiness={computeReadiness({ sleepMinutes: [], restingHeartRate: [], steps: [] }, AS_OF)}
        goals={computeGoalProgress([])}
      />,
    );
    expect(html).toContain("How am I doing?");
    expect(html).toContain("Experimental");
    expect(html).toContain("Add a goal with a target");
  });

  test("push offer and settings: off by default, email needs the disclosure", () => {
    expect(renderToStaticMarkup(<PushOfferCard pending={false} onAnswer={() => {}} />)).toContain(
      "You have a new insight",
    );
    const preferences: InsightPreferences = {
      canConfigureDelivery: true,
      pushAvailable: true,
      emailAvailable: true,
      push: { enabled: false, showTopic: false, offerState: "not_offered", registeredDevices: 0 },
      email: { enabled: false, acknowledgedVersion: null },
      deliveryHour: 9,
      timeZone: "UTC",
      channels: defaultKindChannels(),
    };
    const html = renderToStaticMarkup(
      <InsightNotificationsForm preferences={preferences} pending={false} onUpdate={() => {}} />,
    );
    expect(html).toContain("not end-to-end private");
    expect(html).toContain("Turn on the weekly email");
    expect(html).toContain("Goal milestones — Push notification");
    const viewer = renderToStaticMarkup(
      <InsightNotificationsForm
        preferences={{ ...preferences, canConfigureDelivery: false }}
        pending={false}
        onUpdate={() => {}}
      />,
    );
    expect(viewer).toContain("only be turned on by the owner");
  });
});
