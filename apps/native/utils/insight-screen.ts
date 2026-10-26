import type { I18n } from "@lingui/core";
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
  /** Everything the row says: body, then certainty, coverage and factors. */
  lines: string[];
  /** The one line shown on sight. */
  body: string;
  /** Certainty, coverage and factors: behind the row's InfoTip. */
  details: string[];
  ruleText: string;
  accessibilityLabel: string;
};

export type InsightsSectionModel = {
  title: string;
  intro: string;
  /** Notices first, then footnotes. */
  notes: string[];
  /** Withheld / empty text: shown on sight. */
  notices: string[];
  /** Hidden-count and budget footnotes: behind the section InfoTip. */
  footnotes: string[];
  rows: InsightRowModel[];
  notReadyTitle: string;
  notReady: { key: string; text: string }[];
  method: string;
  limits: string;
  versionText: string;
};

export function insightsSectionModel(
  i18n: I18n,
  result: InsightsResult,
  settings?: ProductDisplaySettings | null,
): InsightsSectionModel {
  const view = insightsListView(i18n, result, settings);
  const notices = [view.withheld, view.emptyText].filter((line): line is string => line !== null);
  return {
    title: i18n._(INSIGHT_COPY.sectionTitle),
    intro: i18n._(INSIGHT_COPY.sectionIntro),
    notes: [...notices, ...view.footnotes],
    notices,
    footnotes: view.footnotes,
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
      body: insight.body,
      details: [insight.certaintyText, insight.coverageText, insight.factorsText].filter(
        (line): line is string => line !== null,
      ),
      ruleText: insight.ruleText,
      accessibilityLabel: insight.accessibilityLabel,
    })),
    notReadyTitle: i18n._(INSIGHT_COPY.notReadyTitle),
    notReady: view.notReady.map((row) => ({
      key: row.key,
      text: `${row.label}: ${row.stateLabel}. ${row.detail}`,
    })),
    method: i18n._(INSIGHT_COPY.methodText),
    limits: i18n._(INSIGHT_COPY.limits),
    versionText: view.versionText,
  };
}
