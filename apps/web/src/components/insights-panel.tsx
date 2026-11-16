import { Trans, useLingui } from "@lingui/react/macro";
import type {
  InsightFeedbackAction,
  InsightTopic,
  InsightsResult,
} from "@openvalens/api/insight-contract";
import {
  INSIGHT_COPY,
  INSIGHT_DELIVERY_COPY,
  insightsListView,
  type InsightView,
} from "@openvalens/api/presenters/insights";
import type { ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";
import { readinessView } from "@openvalens/api/presenters/score";
import type { ReadinessResult } from "@openvalens/api/score-contract";
import { Button } from "@openvalens/ui/components/button";
import {
  Award,
  ChevronDown,
  Footprints,
  HeartPulse,
  ListChecks,
  type LucideIcon,
  Moon,
  Scale,
  Target,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import { Details, InfoTip, Ring, StatusPill, ToneIcon, type Tone } from "./page";

/**
 * Issue #92 — the dashboard's core loop: the readiness summary, then the
 * deterministic insights that explain it. Pure props → markup from the
 * shared view models (`@openvalens/api/presenters/insights` / `score`), so web
 * and native show the same text, coverage, "not enough data" states and
 * controls. Nothing relies on colour; every control is a real button.
 *
 * Less text on sight (#dashboard-0): each insight is one headline with its
 * subject's icon; the sentence, the explanation and the actions open on a
 * tap. Recording streaks share one "Milestones" row (#dashboard-8).
 */

/** The sidebar's module icon and tone for an insight's subject (#dashboard-1). */
export const TOPIC_ICONS: Record<InsightTopic, { icon: LucideIcon; tone: Tone }> = {
  sleep: { icon: Moon, tone: "sleep" },
  heart: { icon: HeartPulse, tone: "heart" },
  activity: { icon: Footprints, tone: "steps" },
  body: { icon: Scale, tone: "weight" },
  goals: { icon: Target, tone: "weight" },
  trackers: { icon: ListChecks, tone: "neutral" },
};

export function SummaryCards({
  readiness,
  scoresLink,
  goalsLink,
}: {
  readiness: ReadinessResult | null;
  /** Router link to the full breakdown (injected so this stays router-free). */
  scoresLink?: ReactNode;
  goalsLink?: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const ready = readiness ? readinessView(readiness, i18n) : null;
  const readyNote = ready?.withheldExplanation ?? ready?.coverageText ?? t`Could not load.`;
  const used = ready?.components.filter((component) => component.used) ?? [];
  return (
    <section aria-labelledby="summaries-title" className="grid min-w-0 content-start gap-3">
      <h2 id="summaries-title" className="sr-only">
        {i18n._(INSIGHT_COPY.summariesTitle)}
      </h2>
      <div className="sheet grid min-w-0 gap-x-8 gap-y-4 p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
        <dl className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
          <Ring
            className="row-span-2"
            tone="sleep"
            value={(Number.parseFloat(ready?.scoreText ?? "") || 0) / 100}
          />
          <dt className="flex flex-wrap items-center gap-2 font-semibold text-ink-2">
            {ready?.title ?? t`Readiness index`}
            {ready ? <StatusPill tone="neutral">{ready.badge}</StatusPill> : null}
            <InfoTip>{readyNote}</InfoTip>
          </dt>
          <dd className="m-0 flex items-baseline gap-1.5">
            <span
              className="num font-display text-[2.125rem] leading-none font-medium tracking-[-0.02em] text-ink"
              role="img"
              aria-label={ready?.accessibilityLabel ?? t`Readiness index not loaded.`}
            >
              {ready?.scoreText ?? "—"}
            </span>
          </dd>
        </dl>
        {used.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t`Inputs used`}>
            {used.map((component) => (
              <li
                key={component.key}
                className="inline-flex items-baseline gap-1.5 rounded-full bg-paper-2 px-3 py-1.5 text-sm"
                aria-label={component.accessibilityLabel}
              >
                <span className="text-ink-3">{component.label}</span>
                <span className="num font-semibold text-ink">{component.scoreText}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        {scoresLink || goalsLink ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {scoresLink ?? null}
            {goalsLink ?? null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** "Ask the coach about this": the same for every insight, or one per insight. */
type CoachLink = ReactNode | ((view: InsightView) => ReactNode);

function InsightActions({
  view,
  pending,
  coachLink,
  onFeedback,
}: {
  view: InsightView;
  pending: boolean;
  coachLink: CoachLink;
  onFeedback: (action: InsightFeedbackAction) => void;
}) {
  const { i18n } = useLingui();
  return (
    <div className="flex flex-wrap items-center gap-1">
      {typeof coachLink === "function" ? coachLink(view) : coachLink}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => onFeedback("dismiss")}
        aria-label={i18n._(INSIGHT_COPY.dismissLabel(view.title))}
        className="text-ink-3"
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
    </div>
  );
}

/** One line: the subject's icon and the headline; a tap opens the sentence and the actions. */
function InsightItem({
  view,
  pending,
  coachLink,
  onFeedback,
}: {
  view: InsightView;
  pending: boolean;
  coachLink: CoachLink;
  onFeedback: (action: InsightFeedbackAction) => void;
}) {
  const subject = TOPIC_ICONS[view.topic] ?? TOPIC_ICONS.body;
  return (
    <li>
      <details className="group rounded-2xl transition-colors duration-[var(--dur-short)] open:bg-paper-2/60">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-paper-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ToneIcon icon={subject.icon} tone={subject.tone} size="sm" />
          <h3 className="min-w-0 flex-1 font-body text-base leading-snug font-semibold text-ink">
            {view.title}
          </h3>
          <ChevronDown
            className="size-4 shrink-0 text-ink-3 transition-transform duration-[var(--dur-short)] group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <article
          aria-label={view.accessibilityLabel}
          className="grid min-w-0 gap-2 pr-3 pb-3 pl-14"
        >
          <div className="flex items-start gap-1">
            <p className="max-w-[65ch] text-ink-2">{view.body}</p>
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
          <InsightActions
            view={view}
            pending={pending}
            coachLink={coachLink}
            onFeedback={onFeedback}
          />
        </article>
      </details>
    </li>
  );
}

/** Recording streaks, grouped into one quiet row: they are habits, not changes in the data. */
function MilestonesItem({
  views,
  pendingId,
  onFeedback,
}: {
  views: readonly InsightView[];
  pendingId: string | null;
  onFeedback: (insightId: string, action: InsightFeedbackAction) => void;
}) {
  const { i18n } = useLingui();
  const count = views.length;
  return (
    <li>
      <details className="group rounded-2xl open:bg-paper-2/60">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-2 hover:bg-paper-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ToneIcon icon={Award} tone="neutral" size="sm" />
          <h3 className="min-w-0 flex-1 font-body text-sm leading-snug text-ink-2">
            <span className="font-semibold text-ink">
              <Trans>Milestones</Trans>
            </span>
            <span className="text-ink-3"> · </span>
            {count === 1 ? views[0]!.title : <Trans>{count} recording streaks</Trans>}
          </h3>
          <ChevronDown
            className="size-4 shrink-0 text-ink-3 transition-transform duration-[var(--dur-short)] group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <ul className="grid gap-2 pr-3 pb-3 pl-14">
          {views.map((view) => {
            const subject = TOPIC_ICONS[view.topic] ?? TOPIC_ICONS.body;
            return (
              <li key={view.key}>
                <article
                  aria-label={view.accessibilityLabel}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <subject.icon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm text-ink-2">{view.title}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingId === view.key}
                    onClick={() => onFeedback(view.key, "dismiss")}
                    aria-label={i18n._(INSIGHT_COPY.dismissLabel(view.title))}
                    className="text-ink-3"
                  >
                    <X aria-hidden="true" />
                    {i18n._(INSIGHT_COPY.dismiss)}
                  </Button>
                </article>
              </li>
            );
          })}
        </ul>
      </details>
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
      <div className="flex items-start gap-1">
        <h3 id="push-offer-title" className="text-base leading-snug text-ink">
          {i18n._(INSIGHT_DELIVERY_COPY.pushOfferTitle)}
        </h3>
        <InfoTip align="end" className="ml-auto">
          <p>{i18n._(INSIGHT_DELIVERY_COPY.pushOfferBody)}</p>
          <p>
            <Trans>Notifications arrive on phones where you allow them in the mobile app.</Trans>
          </p>
        </InfoTip>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAnswer("accepted")}>
          {i18n._(INSIGHT_DELIVERY_COPY.pushOfferAccept)}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onAnswer("declined")}>
          {i18n._(INSIGHT_DELIVERY_COPY.pushOfferDecline)}
        </Button>
      </div>
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
  /** "Ask the coach about this", only when AI consent is granted. */
  coachLink?: CoachLink;
  onFeedback: (insightId: string, action: InsightFeedbackAction) => void;
}) {
  const { i18n } = useLingui();
  const view = insightsListView(i18n, result, settings);
  const changes = view.insights.filter((insight) => insight.kind !== "streak");
  const streaks = view.insights.filter((insight) => insight.kind === "streak");
  return (
    <section aria-labelledby="insights-title" className="grid min-w-0 content-start gap-3">
      <div className="flex items-center gap-2">
        <h2 id="insights-title" className="text-xl leading-tight text-ink">
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
          <ul aria-label={i18n._(INSIGHT_COPY.sectionTitle)} className="grid gap-1 p-2">
            {changes.map((insight) => (
              <InsightItem
                key={insight.key}
                view={insight}
                pending={pendingId === insight.key}
                coachLink={coachLink}
                onFeedback={(action) => onFeedback(insight.key, action)}
              />
            ))}
            {streaks.length > 0 ? (
              <MilestonesItem views={streaks} pendingId={pendingId} onFeedback={onFeedback} />
            ) : null}
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
