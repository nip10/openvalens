import {
  COMPARISON_COPY,
  referenceComparisonsView,
} from "@openvalens/api/presenters/reference-comparison";
import type {
  ComparisonMetric,
  ReferenceComparisonsResult,
} from "@openvalens/api/reference-comparison-contract";

/**
 * Issue #96 — native layout model for reference comparisons. Dependency-free
 * (no RPC client / Varlock) so it is unit-tested directly. It flattens the
 * shared view model from `@openvalens/api/presenters/reference-comparison`
 * into text blocks, so the native screen shows exactly what the web card
 * shows: own trend first, the band or guideline range in words, the source
 * with its population, method and licence, comparability notes, unavailable
 * reasons and the per-metric opt-in with its disclosure.
 */

export type ComparisonBlock = {
  key: ComparisonMetric;
  title: string;
  trendLines: string[];
  statusText: string | null;
  comparisonLines: string[];
  notes: string[];
  sourceLabel: string;
  sourceCitation: string;
  sourceUrl: string;
  sourceDetails: string[];
  /** Shown before turning on; null once on. */
  disclosure: string | null;
  optedIn: boolean;
  toggleLabel: string;
  accessibilityLabel: string;
};

export type ComparisonScreenModel = {
  title: string;
  intro: string;
  noOtherPeople: string;
  withheldText: string | null;
  blocks: ComparisonBlock[];
  notComparedTitle: string;
  notCompared: string[];
  limits: string;
  versionText: string;
};

export function comparisonScreenModel(result: ReferenceComparisonsResult): ComparisonScreenModel {
  const view = referenceComparisonsView(result);
  return {
    title: COMPARISON_COPY.title,
    intro: COMPARISON_COPY.intro,
    noOtherPeople: COMPARISON_COPY.noOtherPeople,
    withheldText: view.withheldText,
    blocks: view.metrics.map((metric) => ({
      key: metric.key,
      title: metric.title,
      trendLines: metric.ownTrendLines,
      statusText: metric.statusText,
      comparisonLines: metric.comparisonLines,
      notes: metric.notes,
      sourceLabel: metric.source.label,
      sourceCitation: metric.source.citation,
      sourceUrl: metric.source.url,
      sourceDetails: metric.source.details.map((detail) => `${detail.label}: ${detail.text}`),
      disclosure: metric.optedIn ? null : metric.disclosure,
      optedIn: metric.optedIn,
      toggleLabel: metric.toggleLabel,
      accessibilityLabel: metric.accessibilityLabel,
    })),
    notComparedTitle: COMPARISON_COPY.notComparedTitle,
    notCompared: view.notCompared,
    limits: COMPARISON_COPY.limits,
    versionText: view.versionText,
  };
}
