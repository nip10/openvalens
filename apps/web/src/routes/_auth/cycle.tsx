import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CYCLE_COPY,
  cycleStrips,
  recentCycleLengths,
  type CycleStrip,
  type StripDay,
} from "@openvalens/api/presenters/cycle";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type CSSProperties, useState } from "react";
import { CalendarHeart, Droplet, History, Lock, Rows3, Settings2 } from "lucide-react";

import { FormDialog } from "@/components/form-dialog";
import {
  Details,
  EmptyState,
  ErrorState,
  InfoTip,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { useLogDialog } from "@/components/quick-log/log-launcher";
import { authClient } from "@/lib/auth-client";
import { friendlyDate } from "@/utils/friendly";
import { client } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/cycle")({ component: CyclePage });

/**
 * Optional cycle logging (#91). Off until the member accepts its own consent.
 * Phases are estimates counted back from the next logged period; nothing here
 * predicts ovulation or fertility, and nothing changes nutrition targets. The
 * day strips colour only what was logged and the existing luteal estimate.
 */

const FLOWS = ["spotting", "light", "medium", "heavy"] as const;
type Flow = (typeof FLOWS)[number];
const FLOW_LABELS: Record<Flow, MessageDescriptor> = {
  spotting: msg`Spotting`,
  light: msg({ message: "Light", context: "period flow" }),
  medium: msg`Medium`,
  heavy: msg`Heavy`,
};

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function CyclePage() {
  const { data: auth, isPending } = authClient.useSession();
  const scope =
    auth?.user?.id && auth.session.activeOrganizationId
      ? `${auth.session.activeOrganizationId}:${auth.user.id}`
      : null;
  if (isPending || !scope)
    return (
      <Page>
        <ModuleHiddenNote module="cycle" />
        <PageHeader title={<Trans>Cycle</Trans>} />
        <p role="status" className="text-sm text-ink-3">
          {isPending ? (
            <Trans>Checking your account…</Trans>
          ) : (
            <Trans>Choose a workspace to continue.</Trans>
          )}
        </p>
      </Page>
    );
  return <CycleForMember key={scope} scope={scope} />;
}

function CycleForMember({ scope }: { scope: string }) {
  const qc = useQueryClient();
  const { i18n } = useLingui();
  const key = (name: string, ...rest: unknown[]) => ["cycle", name, scope, ...rest] as const;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["cycle"] });
  const settings = useQuery({
    queryKey: key("settings"),
    queryFn: () => client.cycle.settings({}),
  });
  const [agreed, setAgreed] = useState(false);
  const enable = useMutation({
    mutationFn: () =>
      client.cycle.enable({ consent: true, consentVersion: CYCLE_COPY.consentVersion }),
    onSuccess: refresh,
  });

  return (
    <Page>
      <ModuleHiddenNote module="cycle" />
      <PageHeader
        title={<Trans>Cycle</Trans>}
        description={i18n._(CYCLE_COPY.notForContraception)}
      />
      {settings.isPending ? (
        <div className="grid gap-3">
          <p role="status" className="text-sm text-ink-3">
            <Trans>Checking your cycle setting…</Trans>
          </p>
          <Skeleton className="h-40 w-full" />
        </div>
      ) : settings.isError ? (
        <ErrorState
          title={<Trans>Could not check this setting.</Trans>}
          action={
            <Button variant="outline" onClick={() => void settings.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          }
        />
      ) : !settings.data.enabled ? (
        <Section
          icon={Lock}
          tone="heart"
          title={<Trans>Cycle logging is off</Trans>}
          sheet
          className="max-w-3xl"
        >
          <div className="grid justify-items-start gap-4">
            <p className="max-w-[65ch] text-ink-2">{i18n._(CYCLE_COPY.consentText)}</p>
            <label className="flex items-start gap-2 text-ink-2">
              <input
                type="checkbox"
                className="mt-1 size-4 rounded-xs accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <Trans comment="safety">
                I agree to store my cycle data on this server for my own reference.
              </Trans>
            </label>
            <Button disabled={!agreed || enable.isPending} onClick={() => enable.mutate()}>
              {enable.isPending ? <Trans>Turning on…</Trans> : <Trans>Turn on cycle logging</Trans>}
            </Button>
            {enable.isError ? (
              <p role="alert" className="text-sm text-destructive">
                <Trans>Could not turn this on. Try again.</Trans>
              </p>
            ) : null}
          </div>
        </Section>
      ) : (
        <CycleEnabled
          noNaturalCycle={settings.data.noNaturalCycle}
          keyFor={key}
          refresh={refresh}
        />
      )}
    </Page>
  );
}

// Flow shades: the heavier the flow, the stronger the cycle tone.
const FLOW_FILL: Record<Flow, string> = {
  heavy: "var(--tone-heart)",
  medium: "color-mix(in oklab, var(--tone-heart) 70%, var(--sheet))",
  light: "color-mix(in oklab, var(--tone-heart) 45%, var(--sheet))",
  spotting: "color-mix(in oklab, var(--tone-heart) 22%, var(--sheet))",
};
const HATCH =
  "repeating-linear-gradient(135deg, color-mix(in oklab, var(--tone-heart) 35%, var(--sheet)) 0 2px, var(--paper-2) 2px 6px)";

function cellStyle(day: Pick<StripDay, "period" | "estimated">): CSSProperties {
  if (day.period === "unrecorded")
    return {
      background: "var(--paper-2)",
      boxShadow: "inset 0 0 0 2px var(--tone-heart)",
    };
  if (day.period) return { background: FLOW_FILL[day.period] };
  if (day.estimated) return { background: HATCH };
  return { background: "var(--paper-2)" };
}

/** What one cell shows, for its tooltip and the strip's description. */
function useDayText() {
  const { t, i18n } = useLingui();
  return (day: StripDay) => {
    const date = friendlyDate(i18n, day.date);
    const what =
      day.period === "unrecorded"
        ? t`Period, flow not recorded`
        : day.period
          ? t`Period, ${i18n._(FLOW_LABELS[day.period])}`
          : day.estimated
            ? i18n._(CYCLE_COPY.estimateLabel)
            : null;
    return what ? t`Day ${day.day}, ${date}: ${what}` : t`Day ${day.day}, ${date}`;
  };
}

/** One cycle as a row of day cells, aligned by day number across rows. */
function DayStrip({
  strip,
  columns,
  label,
}: {
  strip: CycleStrip;
  columns: number;
  label: string;
}) {
  const dayText = useDayText();
  const periodDays = strip.days.filter((day) => day.period).length;
  const { t } = useLingui();
  const summary = `${label}. ${t`${plural(periodDays, { one: "# period day logged", other: "# period days logged" })}`}`;
  return (
    <div
      role="img"
      aria-label={summary}
      className="grid gap-0.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {strip.days.map((day) => (
        <span
          key={day.date}
          title={dayText(day)}
          className={
            day.today
              ? "h-5 rounded-[4px] outline-2 outline-offset-1 outline-ink sm:h-6"
              : "h-5 rounded-[4px] sm:h-6"
          }
          style={cellStyle(day)}
        />
      ))}
    </div>
  );
}

/** Day numbers above the strips: 1, 7, 14, 21, 28, … */
function DayAxis({ columns }: { columns: number }) {
  const marks = [1, ...Array.from({ length: Math.floor(columns / 7) }, (_, i) => (i + 1) * 7)];
  return (
    <div
      aria-hidden="true"
      className="grid gap-0.5 text-xs text-ink-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {marks.map((mark) => (
        <span key={mark} className="num" style={{ gridColumn: `${mark} / span 1` }}>
          {mark}
        </span>
      ))}
    </div>
  );
}

function StripLegend() {
  const { t, i18n } = useLingui();
  const items: { label: string; style: CSSProperties }[] = [
    ...(["light", "medium", "heavy"] as const).map((flow) => ({
      label: i18n._(FLOW_LABELS[flow]),
      style: cellStyle({ period: flow, estimated: false }),
    })),
    {
      label: t`Flow not recorded`,
      style: cellStyle({ period: "unrecorded", estimated: false }),
    },
    {
      label: t`Estimated luteal phase`,
      style: cellStyle({ period: null, estimated: true }),
    },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-2" aria-label={t`Legend`}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-3.5 rounded-[4px]"
            style={item.style}
          />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block size-3.5 rounded-[4px] bg-paper-2 outline-2 outline-offset-1 outline-ink"
        />
        <Trans>Today</Trans>
      </li>
    </ul>
  );
}

/**
 * The page's own "Log a period" form, opened from the "+" (`useLogDialog`):
 * start, an optional end, flow and notes.
 */
function PeriodDialog({
  open,
  onOpenChange,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onSaved: (message: string) => void;
}) {
  const { t, i18n } = useLingui();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [notes, setNotes] = useState("");
  const log = useMutation({
    mutationFn: () =>
      client.cycle.logPeriod({
        startDate,
        endDate: endDate || null,
        flow,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      setEndDate("");
      setFlow(null);
      setNotes("");
      onSaved(t`Period saved.`);
      onOpenChange(false);
    },
  });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={<Trans>Log a period</Trans>}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (startDate) log.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-start">
              <Trans>Start date</Trans>
            </Label>
            <Input
              id="cycle-start"
              type="date"
              max={today}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-end">
              <Trans>End date (optional)</Trans>
            </Label>
            <Input
              id="cycle-end"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            <Trans>Flow (optional)</Trans>
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t`Flow`}>
            {FLOWS.map((value) => {
              const selected = flow === value;
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="aria-checked:border-heart aria-checked:bg-heart-soft"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setFlow(selected ? null : value)}
                >
                  {i18n._(FLOW_LABELS[value])}
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="cycle-notes">
            <Trans>Notes (optional)</Trans>
          </Label>
          <Input
            id="cycle-notes"
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!startDate || log.isPending}>
            {log.isPending ? <Trans>Saving…</Trans> : <Trans>Save period</Trans>}
          </Button>
          {log.isError ? (
            <span role="alert" className="text-sm text-destructive">
              <Trans>Could not save. Check the dates and try again.</Trans>
            </span>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}

export function CycleEnabled({
  noNaturalCycle,
  keyFor,
  refresh,
}: {
  noNaturalCycle: boolean;
  keyFor: (name: string, ...rest: unknown[]) => readonly unknown[];
  refresh: () => void;
}) {
  const today = localToday();
  const { t, i18n } = useLingui();
  const periods = useQuery({
    queryKey: keyFor("periods"),
    queryFn: () => client.cycle.periods({}),
  });
  const imports = useQuery({
    queryKey: keyFor("imports"),
    queryFn: () => client.cycle.imports({}),
  });
  const estimates = useQuery({
    queryKey: keyFor("estimates", today),
    queryFn: () => client.cycle.estimates({ today }),
  });
  const [notice, setNotice] = useState("");
  const [confirmErase, setConfirmErase] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // The "+" on this screen opens the period form.
  useLogDialog("period", () => setLogOpen(true));

  const remove = useMutation({
    mutationFn: (id: string) => client.cycle.deletePeriod({ id }),
    onSuccess: () => {
      setNotice(t`Period deleted.`);
      refresh();
    },
    onError: () => setNotice(t`Could not delete this period. Try again.`),
  });
  const undo = useMutation({
    mutationFn: (importId: string) => client.cycle.undoImport({ importId }),
    onSuccess: (result) => {
      setNotice(
        t`Import undone. ${plural(result.removed, { one: "# imported period removed.", other: "# imported periods removed." })}`,
      );
      refresh();
    },
    onError: () => setNotice(t`Could not undo this import. Try again.`),
  });
  const updateSettings = useMutation({
    mutationFn: (value: boolean) => client.cycle.updateSettings({ noNaturalCycle: value }),
    onSuccess: refresh,
  });
  const erase = useMutation({
    mutationFn: () => client.cycle.turnOffAndErase({ confirm: true }),
    onSuccess: refresh,
  });

  const estimated = estimates.data?.state === "estimated" ? estimates.data : null;
  const current = estimated?.current ?? null;
  const strips = estimated ? cycleStrips(estimated.cycles, periods.data ?? [], today) : [];
  const currentStrip = strips.find((strip) => strip.current) ?? null;
  const pastStrips = strips.filter((strip) => !strip.current).slice(0, 12);
  const columns = Math.max(28, ...strips.map((strip) => strip.days.length));
  const lengths = estimated ? recentCycleLengths(estimated.cycles) : null;
  const lengthsText = lengths
    ? lengths.shortest === lengths.longest
      ? t`Your recent cycles: ${lengths.shortest} days`
      : t`Your recent cycles: ${lengths.shortest}–${lengths.longest} days`
    : null;

  return (
    <>
      <section aria-labelledby="cycle-now" className="sheet grid gap-5 p-6 md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="grid content-start gap-3">
            <h2
              id="cycle-now"
              className="flex items-center gap-2.5 font-body text-base font-semibold tracking-normal text-ink-2"
            >
              <ToneIcon icon={CalendarHeart} tone="heart" />
              <Trans>Current cycle</Trans>
            </h2>
            {estimates.isPending ? (
              <div className="grid gap-2">
                <p role="status" className="text-sm text-ink-3">
                  <Trans>Loading…</Trans>
                </p>
                <Skeleton className="h-14 w-40 rounded-xl" />
              </div>
            ) : estimates.isError ? (
              <p role="alert" className="text-destructive">
                <Trans>Could not load estimates.</Trans>
              </p>
            ) : estimates.data.state === "off" ? (
              <p className="max-w-[48ch] text-ink-2">{i18n._(CYCLE_COPY.noNaturalCycle)}</p>
            ) : current ? (
              <>
                <p className="num font-display text-[3.25rem] leading-none font-medium tracking-[-0.02em] text-ink">
                  <Trans>Day {current.dayOfCycle}</Trans>
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                  <StatusPill tone="neutral">{i18n._(CYCLE_COPY.estimateLabel)}</StatusPill>
                  <span>
                    <Trans>Started {friendlyDate(i18n, current.startDate)}</Trans>
                  </span>
                  <InfoTip>
                    <p>
                      {t`Day ${current.dayOfCycle} of the current cycle (started ${current.startDate}).`}
                    </p>
                    <p>{i18n._(CYCLE_COPY.currentLowConfidence)}</p>
                    <p>{i18n._(CYCLE_COPY.lutealLabel)}</p>
                  </InfoTip>
                </div>
              </>
            ) : (
              <p className="text-ink-3">
                <Trans>Log a period with + to see your cycle here.</Trans>
              </p>
            )}
          </div>
          {lengthsText ? <p className="num text-sm text-ink-2">{lengthsText}</p> : null}
        </div>
        {currentStrip ? (
          <div className="grid gap-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-center sm:gap-x-4">
            <span className="max-sm:hidden" />
            <DayAxis columns={columns} />
            <span className="num text-sm font-semibold text-ink-2">
              {t`Now · day ${currentStrip.days.length}`}
            </span>
            <DayStrip
              strip={currentStrip}
              columns={columns}
              label={t`Current cycle, started ${friendlyDate(i18n, currentStrip.startDate)}`}
            />
          </div>
        ) : null}
        {pastStrips.length > 0 ? (
          <div className="grid gap-3 border-t border-rule pt-5">
            <h3 className="flex items-center gap-2 font-body text-sm font-semibold tracking-normal text-ink-2">
              <Rows3 className="size-4 text-ink-3" aria-hidden="true" />
              <Trans>Past cycles</Trans>
            </h3>
            <ul className="grid gap-3">
              {pastStrips.map((strip) => {
                const start = friendlyDate(i18n, strip.startDate);
                const length = strip.lengthDays ?? strip.days.length;
                const heading = t`${start} · ${plural(length, { one: "# day", other: "# days" })}`;
                return (
                  <li
                    key={strip.startDate}
                    className="grid gap-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-center sm:gap-x-4"
                  >
                    <span className="num text-sm text-ink-2">{heading}</span>
                    <DayStrip strip={strip} columns={columns} label={heading} />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {strips.length > 0 ? <StripLegend /> : null}
      </section>

      <Details summary={<Trans>Logged periods</Trans>}>
        <div className="grid gap-6">
          {periods.isError ? (
            <ErrorState
              title={<Trans>Could not load your periods.</Trans>}
              action={
                <Button variant="outline" onClick={() => void periods.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : periods.data?.length ? (
            <ul className="sheet grid divide-y divide-rule px-5 py-1">
              {periods.data.map((period) => (
                <li
                  key={period.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]"
                >
                  <span className="flex items-center gap-3 text-ink">
                    <ToneIcon icon={Droplet} tone="heart" size="sm" />
                    <span className="num">
                      {period.endDate
                        ? t`${friendlyDate(i18n, period.startDate)} to ${friendlyDate(i18n, period.endDate)}`
                        : friendlyDate(i18n, period.startDate)}
                    </span>
                  </span>
                  <span className="text-sm text-ink-2 max-sm:col-start-1">
                    {period.flow ? i18n._(FLOW_LABELS[period.flow]) : ""}
                  </span>
                  <span className="text-sm text-ink-3 max-sm:col-start-1">
                    {period.source !== "manual" ? t`imported` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(t`Delete this period?`)) remove.mutate(period.id);
                    }}
                  >
                    <Trans>Delete</Trans>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={History} title={<Trans>No periods logged yet.</Trans>} />
          )}
          {imports.isError ? (
            <ErrorState
              title={<Trans>Could not load your imports.</Trans>}
              action={
                <Button variant="outline" onClick={() => void imports.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : imports.data?.length ? (
            <div className="grid gap-2">
              <h3 className="text-base text-ink">
                <Trans>Imports</Trans>
              </h3>
              <ul className="sheet grid divide-y divide-rule px-5 py-1">
                {imports.data.map((run) => (
                  <li
                    key={run.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]"
                  >
                    <span className="text-sm text-ink">
                      {run.source === "health_connect" ? "Health Connect" : "Apple Health"}
                    </span>
                    <span className="num text-sm text-ink-2 max-sm:col-start-1">
                      {t`${plural(run.periodCount, { one: "# period", other: "# periods" })}`}
                    </span>
                    <span className="num text-sm text-ink-3 max-sm:col-start-1">
                      {friendlyDate(i18n, run.importedAt)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1"
                      disabled={undo.isPending}
                      onClick={() => undo.mutate(run.id)}
                    >
                      <Trans>Undo import</Trans>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Details>

      <Details
        summary={
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-4" aria-hidden="true" />
            <Trans>Settings</Trans>
          </span>
        }
      >
        <div className="sheet grid justify-items-start gap-5 p-5">
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="mt-1 size-4 rounded-xs accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
              checked={noNaturalCycle}
              disabled={updateSettings.isPending}
              onChange={(event) => updateSettings.mutate(event.target.checked)}
            />
            <Trans comment="safety">
              I use hormonal contraception or have no natural cycle (turns estimates off)
            </Trans>
          </label>
          <div className="grid justify-items-start gap-3 border-t border-rule pt-5">
            <h3 className="text-base text-ink">
              <Trans>Turn off and erase</Trans>
            </h3>
            <p className="max-w-[65ch] text-sm text-ink-2">
              <Trans comment="safety">
                Deletes every period and import you have logged, in every workspace, and withdraws
                your consent. This cannot be undone.
              </Trans>
            </p>
            {confirmErase ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={erase.isPending}
                  onClick={() => erase.mutate()}
                >
                  {erase.isPending ? <Trans>Erasing…</Trans> : <Trans>Erase all cycle data</Trans>}
                </Button>
                <Button variant="outline" onClick={() => setConfirmErase(false)}>
                  <Trans>Keep my data</Trans>
                </Button>
              </div>
            ) : (
              <Button variant="destructive" onClick={() => setConfirmErase(true)}>
                <Trans>Turn off and erase</Trans>
              </Button>
            )}
          </div>
        </div>
      </Details>
      {notice ? (
        <p role="status" aria-live="polite" className="text-sm text-ink-3">
          {notice}
        </p>
      ) : null}

      <PeriodDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        today={today}
        onSaved={(message) => {
          setNotice(message);
          refresh();
        }}
      />
    </>
  );
}
