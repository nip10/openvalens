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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
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
  const ready = readiness ? readinessView(readiness) : null;
  const progress = goals ? goalProgressView(goals) : null;
  return (
    <section aria-labelledby="summaries-title" className="grid gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="summaries-title" className="text-lg font-semibold">
          {INSIGHT_COPY.summariesTitle}
        </h2>
        {scoresLink ?? null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm font-medium">
                {ready?.title ?? "Readiness index"}
              </CardTitle>
              {ready ? <Badge variant="outline">{ready.badge}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-1">
            <span
              className="font-mono text-3xl"
              role="img"
              aria-label={ready?.accessibilityLabel ?? "Readiness index not loaded."}
            >
              {ready?.scoreText ?? "—"}
            </span>
            <p className="text-sm text-muted-foreground">
              {ready?.withheldExplanation ?? ready?.coverageText ?? "Could not load."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              {progress?.title ?? "Goal progress"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            <span
              className="font-mono text-3xl"
              role="img"
              aria-label={progress?.accessibilityLabel ?? "Goal progress not loaded."}
            >
              {progress?.scoreText ?? "—"}
            </span>
            <p className="text-sm text-muted-foreground">
              {progress?.withheldExplanation ?? progress?.coverageText ?? "Could not load."}
            </p>
            {progress?.flaggedText ? <p className="text-sm">{progress.flaggedText}</p> : null}
          </CardContent>
        </Card>
      </div>
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
  return (
    <li className="grid gap-2 border-t border-border py-3 first:border-t-0">
      <article aria-label={view.accessibilityLabel} className="grid gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{view.kindLabel}</p>
        <h3 className="font-medium">{view.title}</h3>
        <p className="text-sm">{view.body}</p>
        {view.certaintyText ? (
          <p className="text-sm text-muted-foreground">{view.certaintyText}</p>
        ) : null}
        {view.coverageText ? (
          <p className="text-sm text-muted-foreground">{view.coverageText}</p>
        ) : null}
        {view.factorsText ? (
          <p className="text-sm text-muted-foreground">{view.factorsText}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{view.ruleText}</p>
      </article>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onFeedback("dismiss")}
          aria-label={`${INSIGHT_COPY.dismiss}: ${view.title}`}
        >
          {INSIGHT_COPY.dismiss}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => onFeedback("not_useful")}
          aria-label={`${INSIGHT_COPY.notUseful}: ${view.title}. ${INSIGHT_COPY.notUsefulHint}`}
          title={INSIGHT_COPY.notUsefulHint}
        >
          {INSIGHT_COPY.notUseful}
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
  return (
    <Card role="region" aria-labelledby="push-offer-title">
      <CardHeader>
        <CardTitle id="push-offer-title" className="text-base">
          {INSIGHT_DELIVERY_COPY.pushOfferTitle}
        </CardTitle>
        <CardDescription>{INSIGHT_DELIVERY_COPY.pushOfferBody}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => onAnswer("accepted")}>
          {INSIGHT_DELIVERY_COPY.pushOfferAccept}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAnswer("declined")}>
          {INSIGHT_DELIVERY_COPY.pushOfferDecline}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Notifications arrive on phones where you allow them in the mobile app.
        </p>
      </CardContent>
    </Card>
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
  const view = insightsListView(result, settings);
  return (
    <Card role="region" aria-labelledby="insights-title">
      <CardHeader>
        <CardTitle id="insights-title">{INSIGHT_COPY.sectionTitle}</CardTitle>
        <CardDescription>{INSIGHT_COPY.sectionIntro}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.withheld ? <p className="text-sm">{view.withheld}</p> : null}
        {view.emptyText ? <p className="text-sm">{view.emptyText}</p> : null}
        {view.insights.length > 0 ? (
          <ul aria-label={INSIGHT_COPY.sectionTitle}>
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
        {view.footnotes.map((note) => (
          <p key={note} className="text-sm text-muted-foreground">
            {note}
          </p>
        ))}
        {view.notReady.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-medium">{INSIGHT_COPY.notReadyTitle}</h3>
            <ul className="grid gap-1 text-sm">
              {view.notReady.map((row) => (
                <li key={row.key}>
                  <span className="font-medium">{row.label}:</span> {row.stateLabel}.{" "}
                  <span className="text-muted-foreground">{row.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{INSIGHT_COPY.method}</summary>
          <p className="mt-2 text-muted-foreground">{INSIGHT_COPY.methodText}</p>
        </details>
        <p className="text-sm text-muted-foreground">{INSIGHT_COPY.limits}</p>
        <p className="text-xs text-muted-foreground">{view.versionText}</p>
      </CardContent>
    </Card>
  );
}
