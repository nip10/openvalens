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
import { Button } from "@openvalens/ui/components/button";
import { Gauge, Lightbulb, Target, X } from "lucide-react";
import type { ReactNode } from "react";

import { Details, InfoTip, StatusPill } from "./page";

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
  const readyNote = ready?.withheldExplanation ?? ready?.coverageText ?? t`Could not load.`;
  const progressNote =
    progress?.withheldExplanation ?? progress?.coverageText ?? t`Could not load.`;
  return (
    <section aria-labelledby="summaries-title" className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="summaries-title" className="text-lg leading-tight text-ink">
          {i18n._(INSIGHT_COPY.summariesTitle)}
        </h2>
        {scoresLink ?? null}
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="sheet grid min-w-0 content-start gap-3 px-5 py-4">
          <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
            <Gauge className="size-4 shrink-0 text-signal" aria-hidden="true" />
            {ready?.title ?? t`Readiness index`}
            {ready ? <StatusPill tone="neutral">{ready.badge}</StatusPill> : null}
            <InfoTip>{readyNote}</InfoTip>
          </dt>
          <dd className="m-0 flex items-baseline gap-1.5">
            <span
              className="num text-[1.875rem] leading-none font-semibold tracking-[-0.03em] text-ink"
              role="img"
              aria-label={ready?.accessibilityLabel ?? t`Readiness index not loaded.`}
            >
              {ready?.scoreText ?? "—"}
            </span>
          </dd>
        </div>
        <div className="sheet grid min-w-0 content-start gap-3 px-5 py-4">
          <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
            <Target className="size-4 shrink-0 text-signal" aria-hidden="true" />
            {progress?.title ?? t`Goal progress`}
            <InfoTip>{progressNote}</InfoTip>
          </dt>
          <dd className="m-0">
            <span
              className="num text-[1.875rem] leading-none font-semibold tracking-[-0.03em] text-ink"
              role="img"
              aria-label={progress?.accessibilityLabel ?? t`Goal progress not loaded.`}
            >
              {progress?.scoreText ?? "—"}
            </span>
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
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-5 py-4">
      <Lightbulb className="mt-0.5 size-[18px] text-signal" aria-hidden="true" />
      <article aria-label={view.accessibilityLabel} className="grid min-w-0 gap-1">
        <div className="flex items-start gap-1">
          <h3 className="pt-0.5 text-base leading-snug text-ink">{view.title}</h3>
          <InfoTip align="end" className="ml-auto">
            {view.certaintyText ? <p>{view.certaintyText}</p> : null}
            {view.coverageText ? <p>{view.coverageText}</p> : null}
            {view.factorsText ? <p>{view.factorsText}</p> : null}
            <p className="text-ink-3">
              {view.kindLabel}
              <span className="block">{view.ruleText}</span>
            </p>
          </InfoTip>
        </div>
        <p className="max-w-[65ch] text-ink-2">{view.body}</p>
      </article>
      <div className="col-start-2 flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => onFeedback("dismiss")}
          aria-label={i18n._(INSIGHT_COPY.dismissLabel(view.title))}
          className="-ml-2 text-ink-3"
        >
          <X aria-hidden="true" />
          {i18n._(INSIGHT_COPY.dismiss)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => onFeedback("not_useful")}
          aria-label={i18n._(INSIGHT_COPY.notUsefulLabel(view.title))}
          title={i18n._(INSIGHT_COPY.notUsefulHint)}
          className="text-ink-3"
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
    <section aria-labelledby="insights-title" className="grid min-w-0 content-start gap-3">
      <div className="flex items-center gap-2">
        <h2 id="insights-title" className="text-lg leading-tight text-ink">
          {i18n._(INSIGHT_COPY.sectionTitle)}
        </h2>
        <InfoTip>
          <p>{i18n._(INSIGHT_COPY.sectionIntro)}</p>
          <p>{i18n._(INSIGHT_COPY.methodText)}</p>
          <p>{i18n._(INSIGHT_COPY.limits)}</p>
          {view.footnotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p className="text-ink-3">{view.versionText}</p>
        </InfoTip>
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
          <div className="border-t border-rule px-5 py-3">
            <Details summary={i18n._(INSIGHT_COPY.notReadyTitle)}>
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
            </Details>
          </div>
        ) : null}
      </div>
    </section>
  );
}
