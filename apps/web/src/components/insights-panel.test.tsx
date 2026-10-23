import "@/testing/varlock-test-setup";
import { describe, expect, test } from "bun:test";
import type { InsightPreferences, InsightsResult } from "@openvalens/api/insight-contract";
import { defaultKindChannels, runInsightRules } from "@openvalens/api/insight-rules";
import { computeGoalProgress } from "@openvalens/api/score-goal-progress";
import { computeReadiness } from "@openvalens/api/score-readiness";
import { I18nProvider } from "@lingui/react";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import {
  INSIGHT_CHANNEL_LABELS,
  INSIGHT_KIND_LABELS,
  nutritionObservationView,
  observationPreferencePatch,
  shouldShowObservations,
  privateInsightsQueryKey,
  privateInsightsSubject,
} from "@openvalens/api/presenters/insights";

import { InsightNotificationsForm } from "./insight-notifications-section";
import { InsightsCard, PushOfferCard, SummaryCards } from "./insights-panel";

/** Renders inside an English I18nProvider: the component is translated (#67). */
function renderToStaticMarkup(node: ReactElement): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}

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
    observations: [],
    readiness: output.readiness,
    hiddenCount: 0,
    budget: { changeCap: 2, suppressedChanges: 0 },
    offerPush: true,
  };
}

describe("insights panel (web)", () => {
  test("observation presentation preserves null/hidden counts and descriptive period/completeness", () => {
    const hidden = {
      ruleId: "observation.meals_near_sleep" as const,
      window: { from: "2026-10-01", to: "2026-10-07", days: 7 },
      matchingEvents: null,
      minimumMatchingEvents: null,
      completeness: "Completeness information is not available.",
      title: "Meals and recorded sleep timing",
      body: "Recorded meals and sleep timing overlapped in this period.",
    };
    const view = nutritionObservationView(englishI18n, hidden);
    const markup = renderToStaticMarkup(
      <article aria-label={view.accessibilityLabel}>
        <h3>{view.title}</h3>
        <p>{view.body}</p>
        <p>{view.completeness}</p>
        <p>{view.period}</p>
      </article>,
    );
    expect(markup).toContain("2026-10-01 to 2026-10-07 (7 days)");
    expect(markup).toContain("Completeness information is not available.");
    expect(markup).not.toMatch(/\b(?:matching events|events matched|0 events)\b/i);
    expect(view.accessibilityLabel).toContain(view.body);
  });
  test("observation opt-in patch changes only in-app observation preference", () => {
    expect(observationPreferencePatch(true)).toEqual({
      channels: { observation: { in_app: true } },
    });
    expect(observationPreferencePatch(false)).toEqual({
      channels: { observation: { in_app: false } },
    });
    expect(JSON.stringify(observationPreferencePatch(true))).not.toMatch(/push|email/);
  });
  test("observation visibility is off by default and revocation hides immediately and stays hidden on failure", () => {
    expect(shouldShowObservations(undefined, false)).toBe(false);
    expect(shouldShowObservations(false, false)).toBe(false);
    expect(shouldShowObservations(true, false)).toBe(true);
    // This is the state set synchronously by the revoke click; an error does not
    // change it or the saved preference, so observations remain private.
    const savedPreference = true;
    const hideWhileRevoking = true;
    expect(shouldShowObservations(savedPreference, hideWhileRevoking)).toBe(false);
    expect(savedPreference).toBe(true);
    expect(shouldShowObservations(savedPreference, hideWhileRevoking)).toBe(false);
    expect(shouldShowObservations(true, false, false)).toBe(false); // stale true while loading/error
    expect(shouldShowObservations(true, false, true, true)).toBe(false); // failed revoke
    expect(shouldShowObservations(true, false, true, false)).toBe(true); // confirmed enabled / retry success
  });
  test("private query keys isolate member and workspace without sending identity as input", () => {
    const baseKey = ["insights", "list"];
    const memberAWorkspace1 = privateInsightsQueryKey(baseKey, "member-a", "workspace-1");
    expect(privateInsightsQueryKey(baseKey, "member-b", "workspace-1")).not.toEqual(
      memberAWorkspace1,
    );
    expect(privateInsightsQueryKey(baseKey, "member-a", "workspace-2")).not.toEqual(
      memberAWorkspace1,
    );
    expect(privateInsightsQueryKey(baseKey, "member-a", null)).not.toEqual(memberAWorkspace1);
    expect(baseKey).toEqual(["insights", "list"]);
    expect(privateInsightsSubject(true, "member-a", "workspace-1")).toBeNull();
    expect(privateInsightsSubject(false, undefined, "workspace-1")).toBeNull();
    expect(privateInsightsSubject(false, "member-a", "workspace-1")).toEqual({
      userId: "member-a",
      organizationId: "workspace-1",
    });
  });
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
    // Nutrition observations are opted in only through their dedicated card:
    // insight delivery never sends them, so no delivery/email/push switch may
    // be offered here. This removes a misleading no-op surface (#84).
    expect(html).not.toContain(inEnglish(INSIGHT_KIND_LABELS.observation));
    expect(html).not.toMatch(
      /(?:observation|Nutrition observations)\s*—\s*(?:In the app|Push|Weekly)/,
    );
    for (const [kind, message] of Object.entries(INSIGHT_KIND_LABELS)) {
      if (kind === "observation") continue;
      const label = inEnglish(message);
      expect(html).toContain(label);
      for (const channelLabel of Object.values(INSIGHT_CHANNEL_LABELS).map(inEnglish)) {
        expect(html).toContain(`${label} — ${channelLabel}`);
      }
    }
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
