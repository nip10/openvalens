import { Trans, useLingui } from "@lingui/react/macro";
import type { InsightFeedbackAction, InsightsResult } from "@openvalens/api/insight-contract";
import {
  INSIGHT_COPY,
  INSIGHT_DELIVERY_COPY,
  insightsListView,
  type InsightView,
} from "@openvalens/api/presenters/insights";
import type { ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";
import { goalProgressView, readinessView } from "@openvalens/api/presenters/score";
import type { GoalProgressResult, ReadinessResult } from "@openvalens/api/score-contract";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import type { ReactNode } from "react";

/**
 * Issue #92 — the dashboard's core loop: the two #95 summaries, then the
 * deterministic insights that explain them. Pure props → markup from the
 * shared view models (`@openvalens/api/presenters/insights` / `score`), so web
 * and native show the same text, coverage, "not enough data" states and
 * controls. Nothing relies on colour; every control is a real button.
 */

export function SummaryCards({
  readiness,
  goals,
  scoresLink,
}: {
  readiness: ReadinessResult | null;
  goals: GoalProgressResult | null;
  /** Router link to the full breakdown (injected so this stays router-free). */
  scoresLink?: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const ready = readiness ? readinessView(readiness, i18n) : null;
  const progress = goals ? goalProgressView(goals, i18n) : null;
  return (
    <section aria-labelledby="summaries-title" className="grid min-w-0 content-start gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id="summaries-title" className="text-xl leading-tight text-ink">
          {i18n._(INSIGHT_COPY.summariesTitle)}
        </h2>
        {scoresLink ?? null}
      </div>
      <dl className="sheet grid divide-y divide-rule sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="grid min-w-0 content-start gap-1 px-5 py-4">
          <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-3">
            {ready?.title ?? t`Readiness index`}
            {ready ? <Badge variant="outline">{ready.badge}</Badge> : null}
          </dt>
          <dd className="m-0">
            <span
              className="num text-3xl font-medium tracking-[-0.03em] text-ink"
              role="img"
              aria-label={ready?.accessibilityLabel ?? t`Readiness index not loaded.`}
            >
              {ready?.scoreText ?? "—"}
            </span>
          </dd>
          <dd className="m-0 text-sm text-ink-3">
            {ready?.withheldExplanation ?? ready?.coverageText ?? t`Could not load.`}
          </dd>
        </div>
        <div className="grid min-w-0 content-start gap-1 px-5 py-4">
          <dt className="text-sm font-medium text-ink-3">{progress?.title ?? t`Goal progress`}</dt>
          <dd className="m-0">
            <span
              className="num text-3xl font-medium tracking-[-0.03em] text-ink"
              role="img"
              aria-label={progress?.accessibilityLabel ?? t`Goal progress not loaded.`}
            >
              {progress?.scoreText ?? "—"}
            </span>
          </dd>
          <dd className="m-0 text-sm text-ink-3">
            {progress?.withheldExplanation ?? progress?.coverageText ?? t`Could not load.`}
          </dd>
          {progress?.flaggedText ? (
            <dd className="m-0 text-sm text-ink-2">{progress.flaggedText}</dd>
          ) : null}
        </div>
      </dl>
    </section>
  );
}

function InsightItem({
  view,
  pending,
  coachLink,
  onFeedback,
}: {
  view: InsightView;
  pending: boolean;
  coachLink: ReactNode;
  onFeedback: (action: InsightFeedbackAction) => void;
}) {
  const { i18n } = useLingui();
  return (
    <li className="grid gap-3 px-5 py-4">
      <article aria-label={view.accessibilityLabel} className="grid gap-1">
        <h3 className="text-base leading-snug text-ink">{view.title}</h3>
        <p className="max-w-[65ch] text-ink-2">{view.body}</p>
        {view.certaintyText ? <p className="text-sm text-ink-3">{view.certaintyText}</p> : null}
        {view.coverageText ? <p className="text-sm text-ink-3">{view.coverageText}</p> : null}
        {view.factorsText ? <p className="text-sm text-ink-3">{view.factorsText}</p> : null}
        <p className="text-sm text-ink-3">
          {view.kindLabel}
          <span className="block">{view.ruleText}</span>
        </p>
      </article>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onFeedback("dismiss")}
          aria-label={i18n._(INSIGHT_COPY.dismissLabel(view.title))}
        >
          {i18n._(INSIGHT_COPY.dismiss)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => onFeedback("not_useful")}
          aria-label={i18n._(INSIGHT_COPY.notUsefulLabel(view.title))}
          title={i18n._(INSIGHT_COPY.notUsefulHint)}
        >
          {i18n._(INSIGHT_COPY.notUseful)}
        </Button>
        {coachLink}
      </div>
    </li>
  );
}

export function PushOfferCard({
  pending,
  onAnswer,
}: {
  pending: boolean;
  onAnswer: (answer: "accepted" | "declined") => void;
}) {
  const { i18n } = useLingui();
  return (
    <div role="region" aria-labelledby="push-offer-title" className="well grid gap-3 px-5 py-4">
      <div className="grid gap-1">
        <h3 id="push-offer-title" className="text-base leading-snug text-ink">
          {i18n._(INSIGHT_DELIVERY_COPY.pushOfferTitle)}
        </h3>
        <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.pushOfferBody)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAnswer("accepted")}>
          {i18n._(INSIGHT_DELIVERY_COPY.pushOfferAccept)}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onAnswer("declined")}>
          {i18n._(INSIGHT_DELIVERY_COPY.pushOfferDecline)}
        </Button>
      </div>
      <p className="text-sm text-ink-3">
        <Trans>Notifications arrive on phones where you allow them in the mobile app.</Trans>
      </p>
    </div>
  );
}

export function InsightsCard({
  result,
  settings,
  pendingId,
  coachLink = null,
  onFeedback,
}: {
  result: InsightsResult;
  settings?: ProductDisplaySettings | null;
  pendingId: string | null;
  /** "Ask the coach about this" link, only when AI consent is granted. */
  coachLink?: ReactNode;
  onFeedback: (insightId: string, action: InsightFeedbackAction) => void;
}) {
  const { i18n } = useLingui();
  const view = insightsListView(i18n, result, settings);
  return (
    <section aria-labelledby="insights-title" className="grid min-w-0 content-start gap-4">
      <div className="grid min-w-0 gap-1">
        <h2 id="insights-title" className="text-xl leading-tight text-ink">
          {i18n._(INSIGHT_COPY.sectionTitle)}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(INSIGHT_COPY.sectionIntro)}</p>
      </div>
      <div className="sheet grid min-w-0">
        {view.withheld || view.emptyText ? (
          <div className="grid gap-1 px-5 py-4">
            {view.withheld ? <p className="text-ink-2">{view.withheld}</p> : null}
            {view.emptyText ? <p className="text-ink-2">{view.emptyText}</p> : null}
          </div>
        ) : null}
        {view.insights.length > 0 ? (
          <ul aria-label={i18n._(INSIGHT_COPY.sectionTitle)} className="divide-y divide-rule">
            {view.insights.map((insight) => (
              <InsightItem
                key={insight.key}
                view={insight}
                pending={pendingId === insight.key}
                coachLink={coachLink}
                onFeedback={(action) => onFeedback(insight.key, action)}
              />
            ))}
          </ul>
        ) : null}
        {view.notReady.length > 0 ? (
          <div className="grid gap-2 border-t border-rule px-5 py-4">
            <h3 className="text-sm font-medium text-ink">{i18n._(INSIGHT_COPY.notReadyTitle)}</h3>
            <ul className="divide-y divide-rule text-sm">
              {view.notReady.map((row) => (
                <li
                  key={row.key}
                  className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
                >
                  <span className="font-medium text-ink">{row.label}:</span>
                  <span className="text-ink-2">
                    {row.stateLabel}. <span className="text-ink-3">{row.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="grid gap-2 border-t border-rule px-5 py-4 text-sm text-ink-3">
          {view.footnotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <details>
            <summary className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer font-medium text-ink">
              {i18n._(INSIGHT_COPY.method)}
            </summary>
            <p className="mt-2 max-w-[65ch]">{i18n._(INSIGHT_COPY.methodText)}</p>
          </details>
          <p className="max-w-[65ch]">{i18n._(INSIGHT_COPY.limits)}</p>
          <p>{view.versionText}</p>
        </div>
      </div>
    </section>
  );
}
