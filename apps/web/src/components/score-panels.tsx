import { Trans, useLingui } from "@lingui/react/macro";
import { goalProgressView, readinessView, SCORE_COPY } from "@openvalens/api/presenters/score";
import type { GoalProgressResult, ReadinessResult } from "@openvalens/api/score-contract";
import { Badge } from "@openvalens/ui/components/badge";
import { Flag } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Issue #95 — the readiness index and goal progress cards. Pure props →
 * markup from the shared view models (`@openvalens/api/presenters/score`),
 * so web and native show the same numbers, labels, breakdowns, coverage and
 * unavailable states. No colour carries meaning: every state is in text, and
 * each score has a screen-reader label.
 */

/** A row of a breakdown: its name and state in the body face, its figure in mono, right. */
function ScoreRow({
  label,
  lines,
  figure,
  accessibilityLabel,
  extra,
}: {
  label: ReactNode;
  lines: ReactNode[];
  figure: ReactNode;
  accessibilityLabel: string;
  extra?: ReactNode;
}) {
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-3"
      aria-label={accessibilityLabel}
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="font-display text-base font-medium text-ink">{label}</span>
        {lines.map((line, index) => (
          <span key={index} className="text-sm text-ink-3">
            {line}
          </span>
        ))}
        {extra}
      </div>
      <span className="num text-right text-base font-medium text-ink" aria-hidden="true">
        {figure}
      </span>
    </li>
  );
}

/** Method, limits and version: the small print at the foot of a sheet. */
function SmallPrint({
  method,
  limits,
  version,
}: {
  method: string;
  limits: string;
  version: string;
}) {
  return (
    <div className="grid gap-2 border-t border-rule px-5 py-4 text-sm text-ink-3">
      <details>
        <summary className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer font-medium text-ink">
          <Trans>How this is calculated</Trans>
        </summary>
        <p className="mt-2 max-w-[65ch]">{method}</p>
      </details>
      <p className="max-w-[65ch]">{limits}</p>
      <p>{version}</p>
    </div>
  );
}

export function ReadinessCard({ result }: { result: ReadinessResult }) {
  const { i18n } = useLingui();
  const view = readinessView(result, i18n);
  return (
    <section aria-labelledby="readiness-title" className="grid min-w-0 content-start gap-4">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="readiness-title" className="text-xl leading-tight text-ink">
            {view.title}
          </h2>
          <Badge variant="outline">{view.badge}</Badge>
        </div>
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(SCORE_COPY.readinessIntro)}</p>
      </div>
      <div className="sheet grid min-w-0">
        <div className="grid gap-2 px-5 py-4">
          <div className="flex items-baseline gap-2">
            <span
              className="num text-5xl font-medium tracking-[-0.03em] text-ink"
              aria-label={view.accessibilityLabel}
              role="img"
            >
              {view.scoreText}
            </span>
            {view.available ? (
              <span className="text-sm text-ink-3">{i18n._(SCORE_COPY.outOf100)}</span>
            ) : null}
          </div>
          {view.withheldExplanation ? (
            <p className="max-w-[65ch] text-ink-2">{view.withheldExplanation}</p>
          ) : null}
          {view.wouldHelpText ? (
            <p className="max-w-[65ch] text-sm text-ink-3">{view.wouldHelpText}</p>
          ) : null}
          <div className="text-sm">
            <p className="font-medium text-ink">{view.profileLabel}</p>
            {view.profileDescription ? (
              <p className="text-ink-3">{view.profileDescription}</p>
            ) : null}
            <p className="text-ink-3">{view.coverageText}</p>
          </div>
        </div>
        {view.components.length > 0 ? (
          <div className="border-t-2 border-rule-2">
            <h3 className="px-5 pt-3 text-sm font-medium text-ink-3">
              <Trans>Breakdown</Trans>
            </h3>
            <ul className="divide-y divide-rule">
              {view.components.map((component) => (
                <ScoreRow
                  key={component.key}
                  label={component.label}
                  lines={[component.stateLabel, component.detail]}
                  figure={component.scoreText}
                  accessibilityLabel={component.accessibilityLabel}
                />
              ))}
            </ul>
          </div>
        ) : null}
        <SmallPrint
          method={i18n._(SCORE_COPY.readinessMethod)}
          limits={i18n._(SCORE_COPY.readinessLimits)}
          version={view.versionText}
        />
      </div>
    </section>
  );
}

export function GoalProgressCard({ result }: { result: GoalProgressResult }) {
  const { i18n } = useLingui();
  const view = goalProgressView(result, i18n);
  return (
    <section aria-labelledby="goal-progress-title" className="grid min-w-0 content-start gap-4">
      <div className="grid gap-1">
        <h2 id="goal-progress-title" className="text-xl leading-tight text-ink">
          {view.title}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(SCORE_COPY.goalProgressIntro)}</p>
      </div>
      <div className="sheet grid min-w-0">
        <div className="grid gap-2 px-5 py-4">
          <span
            className="num text-5xl font-medium tracking-[-0.03em] text-ink"
            aria-label={view.accessibilityLabel}
            role="img"
          >
            {view.scoreText}
          </span>
          {view.withheldExplanation ? (
            <p className="max-w-[65ch] text-ink-2">{view.withheldExplanation}</p>
          ) : null}
          <p className="text-sm text-ink-3">{view.coverageText}</p>
          {view.flaggedText ? (
            <p className="text-sm font-medium text-ink">{view.flaggedText}</p>
          ) : null}
        </div>
        {view.goals.length > 0 ? (
          <ul className="divide-y divide-rule border-t-2 border-rule-2">
            {view.goals.map((goal) => (
              <ScoreRow
                key={goal.key}
                label={goal.title}
                lines={[goal.stateLabel, goal.detail, goal.priorityText]}
                figure={goal.progressText}
                accessibilityLabel={goal.accessibilityLabel}
                extra={
                  goal.flagText ? (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-warning">
                      <Flag className="size-3.5 shrink-0" aria-hidden="true" />
                      {goal.flagText}
                    </span>
                  ) : null
                }
              />
            ))}
          </ul>
        ) : null}
        <SmallPrint
          method={i18n._(SCORE_COPY.goalProgressMethod)}
          limits={i18n._(SCORE_COPY.goalProgressLimits)}
          version={view.versionText}
        />
      </div>
    </section>
  );
}
