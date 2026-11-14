import { Trans, useLingui } from "@lingui/react/macro";
import {
  ONBOARDING_WINDOW_DAYS,
  type OnboardingFigureId,
  type OnboardingWindowDays,
} from "@openvalens/api/contracts/onboarding-measurement";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { CalendarCheck, Clock, Repeat, Sprout, Timer, type LucideIcon } from "lucide-react";

import { ErrorState, Section } from "@/components/page";
import type { AdminOnboardingTotalsOutput } from "@/utils/admin-settings-keys";

/**
 * Issue #444 — onboarding totals on /admin/settings: of the accounts created
 * in a recent window, the share with a first entry within 10 minutes, 1 day
 * and 7 days, and with any entry on days 2–7. Counts and shares only; a
 * figure for fewer accounts than the minimum group size is not shown.
 */
export type AdminOnboardingTotalsProps = {
  windowDays: OnboardingWindowDays;
  onWindowChange: (windowDays: OnboardingWindowDays) => void;
} & (
  | { status: "loading" }
  | { status: "error"; onRetry?: () => void }
  | { status: "ready"; totals: AdminOnboardingTotalsOutput }
);

const FIGURE_ICON: Record<OnboardingFigureId, LucideIcon> = {
  first_entry_10m: Timer,
  first_entry_1d: Clock,
  first_entry_7d: CalendarCheck,
  active_days_2_7: Repeat,
};

export function AdminOnboardingTotals(props: AdminOnboardingTotalsProps) {
  return (
    <Section
      icon={Sprout}
      tone="signal"
      title={<Trans>Onboarding</Trans>}
      actions={<WindowPicker value={props.windowDays} onChange={props.onWindowChange} />}
    >
      {props.status === "loading" ? (
        <div className="sheet grid gap-3 p-5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : props.status === "error" ? (
        <ErrorState
          title={<Trans>Could not load onboarding totals.</Trans>}
          action={
            props.onRetry ? (
              <Button variant="outline" onClick={props.onRetry}>
                <Trans>Retry</Trans>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TotalsDetails totals={props.totals} />
      )}
    </Section>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: OnboardingWindowDays;
  onChange: (windowDays: OnboardingWindowDays) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t`Sign-ups in the last`}>
      {ONBOARDING_WINDOW_DAYS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={`min-h-10 rounded-full border px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${value === days ? "border-signal bg-signal-soft font-semibold text-ink" : "border-rule bg-paper text-ink-2"}`}
        >
          <Trans>{days} days</Trans>
        </button>
      ))}
    </div>
  );
}

function TotalsDetails({ totals }: { totals: AdminOnboardingTotalsOutput }) {
  const { t, i18n } = useLingui();
  const count = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const percent = (share: number) =>
    new Intl.NumberFormat(i18n.locale, { style: "percent", maximumFractionDigits: 0 }).format(
      share,
    );
  const minimum = count(totals.minimumGroupSize);
  const signUps = count(totals.signUps);
  const windowDays = totals.windowDays;

  const label: Record<OnboardingFigureId, string> = {
    first_entry_10m: t`First entry within 10 minutes`,
    first_entry_1d: t`First entry within 1 day`,
    first_entry_7d: t`First entry within 7 days`,
    active_days_2_7: t`Any entry on days 2–7`,
  };

  return (
    <>
      <p className="text-sm text-ink-2">
        <Trans>
          {signUps} new accounts in the last {windowDays} days.
        </Trans>
      </p>
      <dl className="sheet m-0 grid divide-y divide-rule px-5 text-sm">
        {totals.figures.map((figure) => {
          const Icon = FIGURE_ICON[figure.id];
          const eligible = count(figure.eligible);
          const reached = figure.reached === null ? "" : count(figure.reached);
          const share = figure.share === null ? "" : percent(figure.share);
          return (
            <div
              key={figure.id}
              className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[17rem_minmax(0,1fr)]"
            >
              <dt className="flex items-center gap-2 text-ink-3">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {label[figure.id]}
              </dt>
              <dd className="m-0 text-ink">
                {figure.suppressed ? (
                  <span className="text-ink-3">
                    <Trans>Not shown: fewer than {minimum} accounts old enough</Trans>
                  </span>
                ) : (
                  <Trans>
                    <span className="font-semibold tabular-nums">{share}</span> ({reached} of{" "}
                    {eligible} accounts)
                  </Trans>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="max-w-[65ch] text-sm text-ink-3">
        <Trans>
          Counted from when accounts were created and when entries were saved, on this server only.
          An entry is something a person typed in, not device data. Each figure counts only the
          accounts old enough for it, and a figure for fewer than {minimum} accounts is not shown.
          See docs/self-hosting/privacy.md, section Onboarding totals.
        </Trans>
      </p>
    </>
  );
}
