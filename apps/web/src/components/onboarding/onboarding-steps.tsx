import { Trans, useLingui } from "@lingui/react/macro";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  MODULES_KEEP_DATA_NOTE,
  PERSON_MODULES,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import { WELLNESS_CHOICE_LABELS } from "@openvalens/api/presenters/wellness-profile";
import {
  WELLNESS_ELIGIBILITY,
  WELLNESS_FIELD_COPY,
  WELLNESS_FOCUS_AREAS,
  WELLNESS_INPUT_METHODS,
  type EligibilityAnswer,
  type FocusAnswer,
  type InputMethodAnswer,
  type WellnessFocusArea,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { cn } from "@openvalens/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, Info, Smartphone, Sprout, Target, Watch } from "lucide-react";
import type { ReactNode } from "react";

import { MODULE_ICON_COMPONENTS } from "@/components/module-icons";
import { InfoTip, Meter, ToneIcon } from "@/components/page";
import { answerValue, RadioGroup } from "@/components/wellness-profile-editor";
import {
  canOpenStep,
  isStepRequired,
  ONBOARDING_STEP_TITLES,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from "@/utils/onboarding";

/**
 * Onboarding stage 2 — presentational pieces of the web flow. Free of data
 * hooks so tests render them on their own; `welcome-flow.tsx` wires them.
 */

const LINK =
  "font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The step list on the left: done steps ticked, the current one marked. */
export function StepRail({
  current,
  done,
  eligibility,
  onJump,
}: {
  current: OnboardingStep;
  done: (step: OnboardingStep) => boolean;
  eligibility: EligibilityAnswer;
  onJump: (step: OnboardingStep) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <nav aria-label={t`Setup steps`}>
      <ol className="grid gap-1">
        {ONBOARDING_STEPS.map((step, index) => {
          const isCurrent = step === current;
          const isDone = !isCurrent && done(step);
          const allowed = canOpenStep(step, { eligibility });
          return (
            <li key={step}>
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={!allowed}
                onClick={() => onJump(step)}
                className="flex min-h-10 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-[0.9375rem] text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 aria-[current=step]:bg-sidebar-accent aria-[current=step]:font-semibold aria-[current=step]:text-ink"
              >
                <span
                  className={cn(
                    "num grid size-7 shrink-0 place-items-center rounded-full text-sm",
                    isDone ? "bg-success/12 text-success" : "bg-paper-2 text-ink-3",
                    isCurrent && "bg-primary text-primary-foreground",
                  )}
                  aria-hidden="true"
                >
                  {isDone ? <Check className="size-4" /> : index + 1}
                </span>
                {i18n._(ONBOARDING_STEP_TITLES[step])}
                {isDone ? <span className="sr-only">{t`(done)`}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The frame of one step: progress, "Step N of 8", the content and the buttons. */
export function StepFrame({
  step,
  titleId,
  title,
  description,
  children,
  continueLabel,
  continueDisabled = false,
  busy = false,
  onContinue,
  onSkip,
  onBack,
  error,
}: {
  step: OnboardingStep;
  titleId: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  continueLabel?: ReactNode;
  continueDisabled?: boolean;
  busy?: boolean;
  onContinue: () => void;
  onSkip?: () => void;
  onBack?: () => void;
  error?: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const index = ONBOARDING_STEPS.indexOf(step);
  const total = ONBOARDING_STEPS.length;
  return (
    <section
      aria-labelledby={titleId}
      className="sheet grid min-w-0 content-start gap-6 p-6 md:p-8"
    >
      <div className="grid gap-2">
        <Meter
          value={index / (total - 1)}
          tone="signal"
          label={t`Setup progress: step ${index + 1} of ${total}`}
        />
        <p className="text-sm text-ink-3">
          <Trans>
            Step {index + 1} of {total}: {i18n._(ONBOARDING_STEP_TITLES[step])}
          </Trans>
        </p>
      </div>
      <div className="grid gap-1.5">
        <h1 id={titleId} className="text-[1.75rem] leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {description ? <p className="max-w-[60ch] text-ink-2">{description}</p> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onContinue} disabled={continueDisabled || busy}>
          {busy ? t`Saving…` : (continueLabel ?? t`Continue`)}
        </Button>
        {onSkip && !isStepRequired(step) ? (
          <Button variant="ghost" onClick={onSkip} disabled={busy}>
            <Trans>Skip</Trans>
          </Button>
        ) : null}
        {onBack ? (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            <Trans>Back</Trans>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function WelcomeBody() {
  return (
    <div className="flex items-center gap-3">
      <ToneIcon icon={Sprout} tone="signal" size="lg" />
      <p className="max-w-[55ch] text-ink-2">
        <Trans>
          A few quick questions so the app shows what matters to you. It takes about 2 minutes, and
          you can change everything later.
        </Trans>
      </p>
    </div>
  );
}

/** The age check: the existing eligibility answer, with the existing copy and rule. */
export function AgeBody({
  value,
  onChange,
}: {
  value: EligibilityAnswer;
  onChange: (answer: EligibilityAnswer) => void;
}) {
  const { i18n } = useLingui();
  const copy = WELLNESS_FIELD_COPY.eligibility;
  const notAdult =
    value.state === "declined" || (value.state === "recorded" && value.value === "under_18");
  return (
    <div className="grid gap-4">
      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 flex items-center gap-1.5 font-display font-medium text-ink">
          {copy.question}
          <InfoTip>
            <p>{copy.purpose}</p>
          </InfoTip>
        </legend>
        <RadioGroup
          name="onboarding-eligibility"
          value={answerValue(value)}
          options={[
            ...WELLNESS_ELIGIBILITY.map((option) => ({
              value: option,
              label: i18n._(WELLNESS_CHOICE_LABELS.eligibility[option]),
            })),
            { value: "declined", label: i18n._(WELLNESS_CHOICE_LABELS.decline) },
          ]}
          onChange={(next) =>
            onChange(
              next === "declined"
                ? { state: "declined" }
                : { state: "recorded", value: next as "adult" | "under_18" },
            )
          }
        />
      </fieldset>
      {notAdult ? <Note>{copy.limits}</Note> : null}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
      <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** A pressable card: a focus area or a module. */
function ChoiceCard({
  pressed,
  onToggle,
  icon,
  label,
  sub,
  extra,
}: {
  pressed: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li className="relative min-w-0">
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onToggle}
        className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-rule-2 bg-card px-4 py-3 text-left transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-signal aria-pressed:bg-sidebar-accent"
      >
        {icon}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium text-ink">{label}</span>
          {sub ? <span className="text-sm text-ink-3">{sub}</span> : null}
        </span>
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full border",
            pressed ? "border-signal bg-primary text-primary-foreground" : "border-rule-2",
          )}
          aria-hidden="true"
        >
          {pressed ? <Check className="size-3.5" /> : null}
        </span>
      </button>
      {extra}
    </li>
  );
}

/** Focus areas (the existing profile question) and the module cards. */
export function ModulesBody({
  focus,
  onFocusChange,
  modules,
  onToggleModule,
}: {
  focus: FocusAnswer;
  onFocusChange: (answer: FocusAnswer) => void;
  modules: readonly PersonModule[];
  onToggleModule: (module: PersonModule) => void;
}) {
  const { t, i18n } = useLingui();
  const areas: readonly WellnessFocusArea[] = focus.state === "recorded" ? focus.value : [];
  const toggleArea = (area: WellnessFocusArea) => {
    const next = areas.includes(area) ? areas.filter((a) => a !== area) : [...areas, area];
    onFocusChange(next.length > 0 ? { state: "recorded", value: next } : { state: "unknown" });
  };
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <h2 className="font-display font-medium text-ink">{WELLNESS_FIELD_COPY.focus.question}</h2>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={WELLNESS_FIELD_COPY.focus.question}>
          {WELLNESS_FOCUS_AREAS.map((area) => (
            <ChoiceCard
              key={area}
              pressed={areas.includes(area)}
              onToggle={() => toggleArea(area)}
              icon={null}
              label={i18n._(WELLNESS_CHOICE_LABELS.focus[area])}
            />
          ))}
          <ChoiceCard
            pressed={focus.state === "just_exploring"}
            onToggle={() =>
              onFocusChange(
                focus.state === "just_exploring"
                  ? { state: "unknown" }
                  : { state: "just_exploring" },
              )
            }
            icon={null}
            label={i18n._(WELLNESS_CHOICE_LABELS.justExploring)}
          />
        </ul>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="font-display font-medium text-ink">
            <Trans>Your modules</Trans>
          </h2>
          <p className="text-sm text-ink-3">{i18n._(MODULES_KEEP_DATA_NOTE)}</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={t`Modules`}>
          {PERSON_MODULES.map((module) => (
            <ChoiceCard
              key={module}
              pressed={modules.includes(module)}
              onToggle={() => onToggleModule(module)}
              icon={
                <ToneIcon
                  icon={MODULE_ICON_COMPONENTS[MODULE_ICONS[module]]}
                  tone={MODULE_TONES[module]}
                  size="sm"
                />
              }
              label={i18n._(MODULE_LABELS[module])}
              sub={
                module === "coach" ? (
                  <Trans>
                    The coach also needs AI to be turned on for this server and your consent in
                    Settings.
                  </Trans>
                ) : (
                  i18n._(MODULE_DESCRIPTIONS[module])
                )
              }
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** How data arrives: the existing input-method answer, plus where syncing happens. */
export function DataBody({
  value,
  onChange,
}: {
  value: InputMethodAnswer;
  onChange: (answer: InputMethodAnswer) => void;
}) {
  const { i18n } = useLingui();
  const copy = WELLNESS_FIELD_COPY.inputMethod;
  return (
    <div className="grid gap-4">
      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 flex items-center gap-1.5 font-display font-medium text-ink">
          {copy.question}
          <InfoTip>
            <p>{copy.purpose}</p>
            <p>{copy.limits}</p>
          </InfoTip>
        </legend>
        <RadioGroup
          name="onboarding-input-method"
          value={answerValue(value)}
          options={[
            ...WELLNESS_INPUT_METHODS.map((option) => ({
              value: option,
              label: i18n._(WELLNESS_CHOICE_LABELS.inputMethod[option]),
            })),
            { value: "declined", label: i18n._(WELLNESS_CHOICE_LABELS.notSureYet) },
          ]}
          onChange={(next) =>
            onChange(
              next === "declined"
                ? { state: "declined" }
                : { state: "recorded", value: next as (typeof WELLNESS_INPUT_METHODS)[number] },
            )
          }
        />
      </fieldset>
      <ul className="grid gap-3 sm:grid-cols-2">
        <li className="flex items-start gap-3 rounded-2xl bg-paper-2 p-4 text-sm text-ink-2">
          <ToneIcon icon={Smartphone} tone="water" size="sm" />
          <span>
            <Trans>
              The phone app does the syncing from Apple Health or Health Connect, only for the
              modules you picked. Sign in there with this account.
            </Trans>
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-2xl bg-paper-2 p-4 text-sm text-ink-2">
          <ToneIcon icon={Watch} tone="sleep" size="sm" />
          <span className="grid gap-1">
            <span>
              <Trans>Wearable accounts such as Oura or WHOOP connect in Settings › Devices.</Trans>
            </span>
            <Link to="/settings/devices" className={LINK}>
              <Trans>Open Settings › Devices</Trans>
            </Link>
          </span>
        </li>
      </ul>
    </div>
  );
}

/** Examples from the approved proposal; the person can also write their own. */
export const GOAL_EXAMPLES = [
  "Sleep 7 to 9 hours most nights",
  "Walk 8,000 steps a day",
  "Reach a weight",
  "Log meals most days",
] as const;

export function GoalBody({
  title,
  onTitleChange,
  existingGoals,
}: {
  title: string;
  onTitleChange: (title: string) => void;
  existingGoals: number;
}) {
  const { t } = useLingui();
  const examples: Record<(typeof GOAL_EXAMPLES)[number], string> = {
    "Sleep 7 to 9 hours most nights": t`Sleep 7 to 9 hours most nights`,
    "Walk 8,000 steps a day": t`Walk 8,000 steps a day`,
    "Reach a weight": t`Reach a weight`,
    "Log meals most days": t`Log meals most days`,
  };
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2 sm:grid-cols-2" aria-label={t`Goal ideas`}>
        {GOAL_EXAMPLES.map((example) => (
          <ChoiceCard
            key={example}
            pressed={title === examples[example]}
            onToggle={() => onTitleChange(title === examples[example] ? "" : examples[example])}
            icon={<ToneIcon icon={Target} tone="weight" size="sm" />}
            label={examples[example]}
          />
        ))}
      </ul>
      <label className="grid max-w-md gap-1 text-sm text-ink-3">
        <Trans>Or in your own words</Trans>
        <input
          value={title}
          maxLength={200}
          placeholder={t`For example: walk most days`}
          onChange={(event) => onTitleChange(event.target.value)}
          className="h-10 rounded-xl border border-input bg-card px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </label>
      {existingGoals > 0 ? (
        <Note>
          <Trans>
            You already have goals. See them, and add a target and date, under{" "}
            <Link to="/workouts" className={LINK}>
              Workouts
            </Link>
            .
          </Trans>
        </Note>
      ) : (
        <p className="text-sm text-ink-3">
          <Trans>
            Saved to your Goals under Workouts, where you can add a target and date later.
          </Trans>
        </p>
      )}
    </div>
  );
}

/** Your Today: the tiles the dashboard will show for the chosen modules. */
export function TodayPreview({ modules }: { modules: readonly PersonModule[] }) {
  const { t, i18n } = useLingui();
  const chosen = PERSON_MODULES.filter((module) => modules.includes(module));
  const menu = [
    t`Dashboard`,
    ...chosen.map((module) => i18n._(MODULE_LABELS[module])),
    t`Timeline`,
    t`Sharing`,
    t`Settings`,
  ].join(", ");
  return (
    <div className="grid gap-4">
      {chosen.length === 0 ? (
        <Note>
          <Trans>
            No modules picked. Your dashboard shows your timeline, and you can add modules any time
            in Settings › Modules.
          </Trans>
        </Note>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t`Your Today`}>
          {chosen.map((module) => (
            <li key={module} className="grid gap-2 rounded-2xl border border-rule bg-card p-4">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink-2">{i18n._(MODULE_LABELS[module])}</span>
                <ToneIcon
                  icon={MODULE_ICON_COMPONENTS[MODULE_ICONS[module]]}
                  tone={MODULE_TONES[module]}
                  size="sm"
                />
              </span>
              <span className="text-sm text-ink-3">{i18n._(MODULE_DESCRIPTIONS[module])}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-3">
        <Trans>The menu will show: {menu}.</Trans>
      </p>
    </div>
  );
}
