import { describe, expect, test } from "bun:test";
import type { InsightsResult } from "@openvalens/api/insight-contract";
import { runInsightRules } from "@openvalens/api/insight-rules";
import { insightsListView } from "@openvalens/api/presenters/insights";

import { insightsSectionModel } from "./insight-screen";

const AS_OF = "2026-10-15";

function result(): InsightsResult {
  const series = Array.from({ length: 40 }, (_, i) => {
    const date = new Date(`${AS_OF}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - i);
    return {
      date: date.toISOString().slice(0, 10),
      value: (i <= 8 ? 68 : 60) + (i % 2 === 0 ? 1 : -1),
      source: null,
    };
  });
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
    hiddenCount: 1,
    budget: { changeCap: 2, suppressedChanges: 0 },
    offerPush: false,
  };
}

describe("insights section model (native)", () => {
  test("shows the same text as the web view model (parity)", () => {
    const data = result();
    const model = insightsSectionModel(data);
    const web = insightsListView(data);
    expect(model.rows.map((row) => row.title)).toEqual(web.insights.map((view) => view.title));
    expect(model.rows[0]!.lines).toEqual(
      [web.insights[0]!.body, web.insights[0]!.certaintyText, web.insights[0]!.coverageText].filter(
        Boolean,
      ) as string[],
    );
    expect(model.notReady.length).toBe(web.notReady.length);
    expect(model.notes).toContain("1 insight is hidden by your dismissals or settings.");
  });

  test("withheld results show only the adults-only note", () => {
    const model = insightsSectionModel({
      ...result(),
      status: "withheld",
      withheldReason: "adults_only",
      insights: [],
      readiness: [],
      hiddenCount: 0,
    });
    expect(model.rows).toEqual([]);
    expect(model.notes).toEqual([
      "Insights are for adults 18 and over, based on your profile answer.",
    ]);
  });
});
