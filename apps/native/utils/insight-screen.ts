import type { InsightsResult } from "@openvalens/api/insight-contract";
import { INSIGHT_COPY, insightsListView } from "@openvalens/api/presenters/insights";
import type { ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";

/**
 * Issue #92 — native layout model for the cockpit insights section.
 * Dependency-free (no RPC client / Varlock) so it is unit-tested directly. It
 * flattens the shared view model from `@openvalens/api/presenters/insights`,
 * so the native screen shows exactly what the web dashboard shows: each
 * insight's title, explanation, certainty, coverage and co-occurring factors,
 * the "not enough data yet" rows, footnotes, method and limits.
 */

export type InsightRowModel = {
  key: string;
  kindLabel: string;
  title: string;
  lines: string[];
  ruleText: string;
  accessibilityLabel: string;
};

export type InsightsSectionModel = {
  title: string;
  intro: string;
  notes: string[];
  rows: InsightRowModel[];
  notReadyTitle: string;
  notReady: { key: string; text: string }[];
  method: string;
  limits: string;
  versionText: string;
};

export function insightsSectionModel(
  result: InsightsResult,
  settings?: ProductDisplaySettings | null,
): InsightsSectionModel {
  const view = insightsListView(result, settings);
  return {
    title: INSIGHT_COPY.sectionTitle,
    intro: INSIGHT_COPY.sectionIntro,
    notes: [view.withheld, view.emptyText, ...view.footnotes].filter(
      (line): line is string => line !== null,
    ),
    rows: view.insights.map((insight) => ({
      key: insight.key,
      kindLabel: insight.kindLabel,
      title: insight.title,
      lines: [
        insight.body,
        insight.certaintyText,
        insight.coverageText,
        insight.factorsText,
      ].filter((line): line is string => line !== null),
      ruleText: insight.ruleText,
      accessibilityLabel: insight.accessibilityLabel,
    })),
    notReadyTitle: INSIGHT_COPY.notReadyTitle,
    notReady: view.notReady.map((row) => ({
      key: row.key,
      text: `${row.label}: ${row.stateLabel}. ${row.detail}`,
    })),
    method: INSIGHT_COPY.methodText,
    limits: INSIGHT_COPY.limits,
    versionText: view.versionText,
  };
}
