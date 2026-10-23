import { Trans, useLingui } from "@lingui/react/macro";
import { goalProgressView, readinessView, SCORE_COPY } from "@openvalens/api/presenters/score";
import type { GoalProgressResult, ReadinessResult } from "@openvalens/api/score-contract";
import { Badge } from "@openvalens/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";

/**
 * Issue #95 — the readiness index and goal progress cards. Pure props →
 * markup from the shared view models (`@openvalens/api/presenters/score`),
 * so web and native show the same numbers, labels, breakdowns, coverage and
 * unavailable states. No colour carries meaning: every state is in text, and
 * each score has a screen-reader label.
 */

export function ReadinessCard({ result }: { result: ReadinessResult }) {
  const { i18n } = useLingui();
  const view = readinessView(result, i18n);
  return (
    <Card role="region" aria-labelledby="readiness-title">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id="readiness-title">{view.title}</CardTitle>
          <Badge variant="outline">{view.badge}</Badge>
        </div>
        <CardDescription>{i18n._(SCORE_COPY.readinessIntro)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-4xl" aria-label={view.accessibilityLabel} role="img">
            {view.scoreText}
          </span>
          {view.available ? (
            <span className="text-sm text-muted-foreground">{i18n._(SCORE_COPY.outOf100)}</span>
          ) : null}
        </div>
        {view.withheldExplanation ? <p className="text-sm">{view.withheldExplanation}</p> : null}
        {view.wouldHelpText ? (
          <p className="text-sm text-muted-foreground">{view.wouldHelpText}</p>
        ) : null}
        <div className="text-sm">
          <p className="font-medium">{view.profileLabel}</p>
          {view.profileDescription ? (
            <p className="text-muted-foreground">{view.profileDescription}</p>
          ) : null}
          <p className="text-muted-foreground">{view.coverageText}</p>
        </div>
        {view.components.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-medium">
              <Trans>Breakdown</Trans>
            </h3>
            <ul className="divide-y divide-border">
              {view.components.map((component) => (
                <li
                  key={component.key}
                  className="flex items-start justify-between gap-4 py-2"
                  aria-label={component.accessibilityLabel}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{component.label}</div>
                    <div className="text-sm text-muted-foreground">{component.stateLabel}</div>
                    <div className="text-sm text-muted-foreground">{component.detail}</div>
                  </div>
                  <div className="shrink-0 font-mono text-sm" aria-hidden="true">
                    {component.scoreText}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            <Trans>How this is calculated</Trans>
          </summary>
          <p className="mt-2 text-muted-foreground">{i18n._(SCORE_COPY.readinessMethod)}</p>
        </details>
        <p className="text-sm text-muted-foreground">{i18n._(SCORE_COPY.readinessLimits)}</p>
        <p className="text-xs text-muted-foreground">{view.versionText}</p>
      </CardContent>
    </Card>
  );
}

export function GoalProgressCard({ result }: { result: GoalProgressResult }) {
  const { i18n } = useLingui();
  const view = goalProgressView(result, i18n);
  return (
    <Card role="region" aria-labelledby="goal-progress-title">
      <CardHeader>
        <CardTitle id="goal-progress-title">{view.title}</CardTitle>
        <CardDescription>{i18n._(SCORE_COPY.goalProgressIntro)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <span className="font-mono text-4xl" aria-label={view.accessibilityLabel} role="img">
          {view.scoreText}
        </span>
        {view.withheldExplanation ? <p className="text-sm">{view.withheldExplanation}</p> : null}
        <p className="text-sm text-muted-foreground">{view.coverageText}</p>
        {view.flaggedText ? <p className="text-sm font-medium">{view.flaggedText}</p> : null}
        {view.goals.length > 0 ? (
          <ul className="divide-y divide-border">
            {view.goals.map((goal) => (
              <li
                key={goal.key}
                className="flex items-start justify-between gap-4 py-2"
                aria-label={goal.accessibilityLabel}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{goal.title}</div>
                  <div className="text-sm text-muted-foreground">{goal.stateLabel}</div>
                  <div className="text-sm text-muted-foreground">{goal.detail}</div>
                  <div className="text-sm text-muted-foreground">{goal.priorityText}</div>
                  {goal.flagText ? (
                    <div className="text-sm font-medium">⚑ {goal.flagText}</div>
                  ) : null}
                </div>
                <div className="shrink-0 font-mono text-sm" aria-hidden="true">
                  {goal.progressText}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            <Trans>How this is calculated</Trans>
          </summary>
          <p className="mt-2 text-muted-foreground">{i18n._(SCORE_COPY.goalProgressMethod)}</p>
        </details>
        <p className="text-sm text-muted-foreground">{i18n._(SCORE_COPY.goalProgressLimits)}</p>
        <p className="text-xs text-muted-foreground">{view.versionText}</p>
      </CardContent>
    </Card>
  );
}
