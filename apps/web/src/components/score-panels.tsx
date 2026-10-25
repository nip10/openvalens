import { Trans, useLingui } from "@lingui/react/macro";
import { goalProgressView, readinessView, SCORE_COPY } from "@openvalens/api/presenters/score";
import type { GoalProgressResult, ReadinessResult } from "@openvalens/api/score-contract";
import { Flag, Gauge, type LucideIcon, Target } from "lucide-react";
import type { ReactNode } from "react";

import { InfoTip, Meter, Ring, StatusPill, type Tone, ToneIcon } from "@/components/page";

/**
 * Issue #95 — the readiness index and goal progress cards. Pure props →
 * markup from the shared view models (`@openvalens/api/presenters/score`),
 * so web and native show the same numbers, labels, breakdowns, coverage and
 * unavailable states. No colour carries meaning: every state is in text, and
 * each score has a screen-reader label.
 */

/** A figure like "72", "40%" or "100% (target reached)" as a 0 to 1 share; null when there is none. */
function share(text: string): number | null {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value / 100 : null;
}

/** A row of a breakdown as a soft card: name, state, its figure on the right and a bar under it. */
function ScoreRow({
  label,
  state,
  counted,
  lines,
  figure,
  tone,
  accessibilityLabel,
  extra,
}: {
  label: ReactNode;
  state: ReactNode;
  counted: boolean;
  lines: ReactNode[];
  figure: string;
  tone: Tone;
  accessibilityLabel: string;
  extra?: ReactNode;
}) {
  const value = share(figure);
  return (
    <li
      className="grid min-w-0 content-start gap-2.5 rounded-2xl bg-paper-2 px-4 py-3.5"
      aria-label={accessibilityLabel}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="flex items-center gap-1 font-semibold text-ink">
            {label}
            <InfoTip>
              {lines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </InfoTip>
          </span>
          <span>
            <StatusPill tone={counted ? "good" : "neutral"}>{state}</StatusPill>
          </span>
        </div>
        <span className="num shrink-0 font-display text-xl font-medium text-ink" aria-hidden="true">
          {figure}
        </span>
      </div>
      {value !== null ? <Meter value={value} tone={tone} /> : null}
      {extra}
    </li>
  );
}

/** Method, limits and version: behind an ⓘ next to the title. */
function MethodNote({
  intro,
  method,
  limits,
  version,
}: {
  intro: string;
  method: string;
  limits: string;
  version: string;
}) {
  return (
    <InfoTip>
      <p>{intro}</p>
      <p className="font-semibold text-ink">
        <Trans>How this is calculated</Trans>
      </p>
      <p>{method}</p>
      <p>{limits}</p>
      <p className="text-ink-3">{version}</p>
    </InfoTip>
  );
}

/** The hero of a score: a big ring with the figure beside it. */
function ScoreHero({
  icon,
  tone,
  value,
  scoreText,
  accessibilityLabel,
  unit,
}: {
  icon: LucideIcon;
  tone: Tone;
  value: number;
  scoreText: string;
  accessibilityLabel: string;
  unit?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-5">
      <Ring value={value} tone={tone} size={112}>
        <ToneIcon icon={icon} tone={tone} />
      </Ring>
      <div className="grid gap-1">
        <span
          className="num font-display text-[3.25rem] leading-none font-medium tracking-[-0.02em] text-ink"
          aria-label={accessibilityLabel}
          role="img"
        >
          {scoreText}
        </span>
        {unit}
      </div>
    </div>
  );
}

export function ReadinessCard({ result }: { result: ReadinessResult }) {
  const { i18n } = useLingui();
  const view = readinessView(result, i18n);
  return (
    <section
      aria-labelledby="readiness-title"
      className="sheet grid min-w-0 content-start gap-5 p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="readiness-title" className="text-xl leading-tight text-ink">
          {view.title}
        </h2>
        <StatusPill tone="neutral">{view.badge}</StatusPill>
        <MethodNote
          intro={i18n._(SCORE_COPY.readinessIntro)}
          method={i18n._(SCORE_COPY.readinessMethod)}
          limits={i18n._(SCORE_COPY.readinessLimits)}
          version={view.versionText}
        />
      </div>
      <ScoreHero
        icon={Gauge}
        tone="sleep"
        value={view.available ? (share(view.scoreText) ?? 0) : 0}
        scoreText={view.scoreText}
        accessibilityLabel={view.accessibilityLabel}
        unit={
          view.available ? (
            <span className="text-sm text-ink-3">{i18n._(SCORE_COPY.outOf100)}</span>
          ) : null
        }
      />
      {view.withheldExplanation ? <p className="text-ink-2">{view.withheldExplanation}</p> : null}
      {view.wouldHelpText ? <p className="text-sm text-ink-3">{view.wouldHelpText}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-sleep-soft px-2.5 py-1 font-semibold text-ink">
          {view.profileLabel}
        </span>
        <InfoTip>
          {view.profileDescription ? <p>{view.profileDescription}</p> : null}
          <p>{view.coverageText}</p>
        </InfoTip>
      </div>
      {view.components.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="text-base text-ink-2">
            <Trans>Breakdown</Trans>
          </h3>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {view.components.map((component) => (
              <ScoreRow
                key={component.key}
                label={component.label}
                state={component.stateLabel}
                counted={component.used}
                lines={[component.detail]}
                figure={component.scoreText}
                tone="sleep"
                accessibilityLabel={component.accessibilityLabel}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function GoalProgressCard({ result }: { result: GoalProgressResult }) {
  const { i18n } = useLingui();
  const view = goalProgressView(result, i18n);
  return (
    <section
      aria-labelledby="goal-progress-title"
      className="sheet grid min-w-0 content-start gap-5 p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="goal-progress-title" className="text-xl leading-tight text-ink">
          {view.title}
        </h2>
        <MethodNote
          intro={i18n._(SCORE_COPY.goalProgressIntro)}
          method={i18n._(SCORE_COPY.goalProgressMethod)}
          limits={i18n._(SCORE_COPY.goalProgressLimits)}
          version={view.versionText}
        />
      </div>
      <ScoreHero
        icon={Target}
        tone="weight"
        value={view.available ? (share(view.scoreText) ?? 0) : 0}
        scoreText={view.scoreText}
        accessibilityLabel={view.accessibilityLabel}
        unit={<span className="text-sm text-ink-3">{view.coverageText}</span>}
      />
      {view.withheldExplanation ? <p className="text-ink-2">{view.withheldExplanation}</p> : null}
      {view.flaggedText ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
          <Flag className="size-4 shrink-0" aria-hidden="true" />
          {view.flaggedText}
        </p>
      ) : null}
      {view.goals.length > 0 ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {view.goals.map((goal) => (
            <ScoreRow
              key={goal.key}
              label={goal.title}
              state={goal.stateLabel}
              counted={goal.counted}
              lines={[goal.detail, goal.priorityText]}
              figure={goal.progressText}
              tone="weight"
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
    </section>
  );
}
