import { Trans, useLingui } from "@lingui/react/macro";
import type { LogKind } from "@openvalens/api/presenters/log-kinds";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  MODULES_KEEP_DATA_NOTE,
  PERSON_MODULES,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import {
  FIRST_LOG_CARD_COPY,
  FIRST_LOG_WATER_NOTE,
  PHONE_APP_STORES,
  turnsOnWater,
  type FirstLogKindId,
  type SetupItem,
} from "@openvalens/api/presenters/onboarding";
import { WELLNESS_CHOICE_LABELS } from "@openvalens/api/presenters/wellness-profile";
import {
  wearableStatusLabel,
  type WearableConnectionStatus,
  type WearableProviderId,
} from "@openvalens/api/presenters/wearables";
import {
  WELLNESS_ELIGIBILITY,
  WELLNESS_FIELD_COPY,
  WELLNESS_FOCUS_AREAS,
  type EligibilityAnswer,
  type FocusAnswer,
  type WellnessFocusArea,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { cn } from "@openvalens/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, Info, Smartphone, Target, Watch } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";
import { encode } from "uqr";

import { MODULE_ICON_COMPONENTS } from "@/components/module-icons";
import { InfoTip, Meter, ToneIcon } from "@/components/page";
import { LOG_KIND_ICONS, LOG_KIND_TONES } from "@/components/quick-log/log-kind-icons";
import { answerValue, RadioGroup } from "@/components/wellness-profile-editor";

/**
 * Onboarding (#444) — presentational pieces of the first run and the "Finish
 * setting up" screens. Free of data hooks so tests render them on their own;
 * `welcome-flow.tsx` and `setup-steps.tsx` wire them.
 */

const LINK =
  "font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The frame of one screen: "Step N of 3" in the first run (no counter on a
 * "Finish setting up" screen), the content and the buttons. Skip shows only
 * when `onSkip` is given, so a required screen simply leaves it out.
 */
export function StepFrame({
  titleId,
  progress,
  title,
  description,
  children,
  continueLabel,
  continueDisabled = false,
  busy = false,
  onContinue,
  onSkip,
  skipLabel,
  onBack,
  error,
}: {
  titleId: string;
  progress?: { index: number; total: number; label: string };
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  continueLabel?: ReactNode;
  continueDisabled?: boolean;
  busy?: boolean;
  onContinue?: () => void;
  onSkip?: () => void;
  skipLabel?: ReactNode;
  onBack?: () => void;
  error?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <section
      aria-labelledby={titleId}
      className="sheet grid min-w-0 content-start gap-6 p-6 md:p-8"
    >
      {progress ? (
        <div className="grid gap-2">
          <Meter
            value={progress.index / progress.total}
            tone="signal"
            label={t`Setup progress: step ${progress.index} of ${progress.total}`}
          />
          <p className="text-sm text-ink-3">
            <Trans>
              Step {progress.index} of {progress.total}: {progress.label}
            </Trans>
          </p>
        </div>
      ) : null}
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
      {onContinue || onSkip || onBack ? (
        <div className="flex flex-wrap items-center gap-2">
          {onContinue ? (
            <Button onClick={onContinue} disabled={continueDisabled || busy}>
              {busy ? t`Saving…` : (continueLabel ?? t`Continue`)}
            </Button>
          ) : null}
          {onSkip ? (
            <Button variant="ghost" onClick={onSkip} disabled={busy}>
              {skipLabel ?? <Trans>Skip</Trans>}
            </Button>
          ) : null}
          {onBack ? (
            <Button variant="ghost" onClick={onBack} disabled={busy}>
              <Trans>Back</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
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

/**
 * The health-data consent on the first screen: the same text, version and
 * checkbox as the consent banner, which stays hidden on the first run.
 */
export function ConsentBody({
  currentVersion,
  privacyUrl,
  checked,
  onCheckedChange,
}: {
  currentVersion: string;
  privacyUrl: string | null;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <section className="grid gap-3 rounded-3xl border border-signal/30 bg-signal-soft/40 p-4 sm:p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        <Trans>Health data consent</Trans>
      </h2>
      <p className="text-sm text-ink-2">
        <Trans>
          I consent to OpenValens processing my health data to provide the service. This includes
          any birth year and sex I add to my profile, used to place me in a broad age band and to
          choose age- and sex-specific guidance and reference ranges.
        </Trans>{" "}
        {privacyUrl ? (
          <a className={LINK} href={privacyUrl} target="_blank" rel="noreferrer">
            <Trans>Read the privacy policy</Trans>
          </a>
        ) : null}
      </p>
      <p className="text-xs text-ink-3">
        <Trans>Consent version: {currentVersion}</Trans>
      </p>
      <label htmlFor={id} className="flex items-start gap-2 text-sm text-ink-2">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <span>
          <Trans>I agree to this health data processing.</Trans>
        </span>
      </label>
    </section>
  );
}

/**
 * Screen 2: Weight, Water and Last night's sleep as three large cards. The
 * Water card says when choosing it turns water logging on.
 */
export function FirstLogCards({
  kinds,
  plainWaterEnabled,
  disabled = false,
  onPick,
}: {
  kinds: readonly LogKind<FirstLogKindId>[];
  plainWaterEnabled: boolean | null;
  disabled?: boolean;
  onPick: (kind: LogKind<FirstLogKindId>) => void;
}) {
  const { t, i18n } = useLingui();
  if (kinds.length === 0) {
    return (
      <Note>
        <Trans>
          Your role in this workspace can't add entries. You can still look around and connect your
          data.
        </Trans>
      </Note>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-3" aria-label={t`What to log`}>
      {kinds.map((kind) => (
        <li key={kind.id} className="min-w-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(kind)}
            className="grid min-h-36 w-full content-start gap-3 rounded-3xl border border-rule-2 bg-card p-5 text-left transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
          >
            <ToneIcon icon={LOG_KIND_ICONS[kind.icon]} tone={LOG_KIND_TONES[kind.icon]} size="lg" />
            <span className="font-display text-lg font-medium text-ink">
              {i18n._(FIRST_LOG_CARD_COPY[kind.id])}
            </span>
            {turnsOnWater(kind.id, plainWaterEnabled) ? (
              <span className="text-sm text-ink-3">{i18n._(FIRST_LOG_WATER_NOTE)}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A QR code drawn as SVG squares (dark on light in both themes, so phones read it). */
export function QrCode({ value, label }: { value: string; label: string }) {
  const matrix = useMemo(() => encode(value, { ecc: "M", border: 2 }), [value]);
  const path = useMemo(() => {
    let d = "";
    matrix.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return d;
  }, [matrix]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      shapeRendering="crispEdges"
      className="size-40 shrink-0 rounded-2xl bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

export type ConnectProvider = {
  provider: WearableProviderId;
  displayName: string;
  status: WearableConnectionStatus;
};

/**
 * Screen 3 on the web: get the phone app (a QR code with this server's
 * address), and the wearable accounts the operator has set up.
 */
export function ConnectBody({
  phoneLink,
  serverUrl,
  providers,
  busyProvider,
  onConnect,
}: {
  phoneLink: string;
  serverUrl: string;
  /** `null` while loading; empty when the operator set none up. */
  providers: readonly ConnectProvider[] | null;
  busyProvider: WearableProviderId | null;
  onConnect: (provider: WearableProviderId) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-3xl border border-rule bg-card p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-6">
        <QrCode value={phoneLink} label={t`QR code that opens the phone app on this server`} />
        <div className="grid min-w-0 gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-medium text-ink">
            <Smartphone className="size-5 text-ink-3" aria-hidden="true" />
            <Trans>Get the phone app</Trans>
          </h2>
          <p className="max-w-[55ch] text-sm text-ink-2">
            <Trans>
              The phone app brings in weight, steps, heart rate, sleep and workouts from Apple
              Health or Health Connect, and connects watches and rings. Install it, then scan this
              code with your phone's camera to open it on this server.
            </Trans>
          </p>
          <p className="text-sm text-ink-3">
            <Trans>
              Server address: <span className="font-medium break-all text-ink">{serverUrl}</span>
            </Trans>
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {PHONE_APP_STORES.map((store) => (
              <li key={store.id}>
                <a className={LINK} href={store.url} target="_blank" rel="noreferrer">
                  {store.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {providers === null || providers.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-medium text-ink">
            <Watch className="size-5 text-ink-3" aria-hidden="true" />
            <Trans>Wearable accounts</Trans>
          </h2>
          {providers === null ? (
            <p className="text-sm text-ink-3">
              <Trans>Loading…</Trans>
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label={t`Wearable accounts`}>
              {providers.map((row) => (
                <li
                  key={row.provider}
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-rule-2 bg-card px-4 py-3"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-medium text-ink">{row.displayName}</span>
                    <span className="text-sm text-ink-3">
                      {i18n._(wearableStatusLabel(row.status))}
                    </span>
                  </span>
                  {row.status === "active" ? (
                    <Check className="size-5 text-success" aria-hidden="true" />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyProvider !== null}
                      onClick={() => onConnect(row.provider)}
                    >
                      {busyProvider === row.provider ? t`Opening…` : t`Connect`}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** One "Finish setting up" item: done ones ticked; each opens its own screen. */
export function SetupItemLink({
  item,
  title,
  description,
  done,
}: {
  item: SetupItem;
  title: ReactNode;
  description: ReactNode;
  done: boolean;
}) {
  const { t } = useLingui();
  return (
    <Link
      to="/setup/$item"
      params={{ item }}
      className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 no-underline transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border",
          done ? "border-success/40 bg-success/12 text-success" : "border-rule-2",
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-4" /> : null}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn("font-medium", done ? "text-ink-3" : "text-ink")}>
          {title}
          {done ? <span className="sr-only"> {t`(done)`}</span> : null}
        </span>
        <span className="text-sm text-ink-3">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
    </Link>
  );
}
