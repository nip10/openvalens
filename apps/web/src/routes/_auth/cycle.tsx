import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CYCLE_COPY } from "@openvalens/api/presenters/cycle";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/cycle")({ component: CyclePage });

/**
 * Optional cycle logging (#91). Off until the member accepts its own consent.
 * Phases are estimates counted back from the next logged period; nothing here
 * predicts ovulation or fertility, and nothing changes nutrition targets.
 */

const FLOWS = ["spotting", "light", "medium", "heavy"] as const;
const FLOW_LABELS: Record<(typeof FLOWS)[number], MessageDescriptor> = {
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
      <Page width="narrow">
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
    <Page width="narrow">
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
        <Section title={<Trans>Cycle logging is off</Trans>} sheet>
          <div className="grid justify-items-start gap-4">
            <p className="max-w-[65ch] text-ink-2">{i18n._(CYCLE_COPY.consentText)}</p>
            <label className="flex items-start gap-2 text-ink-2">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
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

function CycleEnabled({
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
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [flow, setFlow] = useState<"" | (typeof FLOWS)[number]>("");
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmErase, setConfirmErase] = useState(false);

  const log = useMutation({
    mutationFn: () =>
      client.cycle.logPeriod({
        startDate,
        endDate: endDate || null,
        flow: flow || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      setEndDate("");
      setFlow("");
      setNotes("");
      setNotice(t`Period saved.`);
      refresh();
    },
    onError: () => setNotice(t`Could not save. Check the dates and try again.`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.cycle.deletePeriod({ id }),
    onSuccess: () => {
      setNotice(t`Period deleted.`);
      refresh();
    },
  });
  const undo = useMutation({
    mutationFn: (importId: string) => client.cycle.undoImport({ importId }),
    onSuccess: (result) => {
      setNotice(
        t`Import undone. ${plural(result.removed, { one: "# imported period removed.", other: "# imported periods removed." })}`,
      );
      refresh();
    },
  });
  const updateSettings = useMutation({
    mutationFn: (value: boolean) => client.cycle.updateSettings({ noNaturalCycle: value }),
    onSuccess: refresh,
  });
  const erase = useMutation({
    mutationFn: () => client.cycle.turnOffAndErase({ confirm: true }),
    onSuccess: refresh,
  });

  return (
    <>
      <Section title={<Trans>Estimates</Trans>}>
        <div className="sheet grid gap-4 px-5 py-4">
          {estimates.isPending ? (
            <div className="grid gap-2">
              <p role="status" className="text-sm text-ink-3">
                <Trans>Loading…</Trans>
              </p>
              <Skeleton className="h-16 w-full" />
            </div>
          ) : estimates.isError ? (
            <p role="alert" className="text-destructive">
              <Trans>Could not load estimates.</Trans>
            </p>
          ) : estimates.data.state === "off" ? (
            <p className="text-ink-2">{i18n._(CYCLE_COPY.noNaturalCycle)}</p>
          ) : estimates.data.state === "no_data" ? (
            <p className="text-ink-3">
              <Trans>Log a period to see your cycle history.</Trans>
            </p>
          ) : (
            <>
              {estimates.data.current ? (
                <p className="text-ink-2">
                  {t`Day ${estimates.data.current.dayOfCycle} of the current cycle (started ${estimates.data.current.startDate}).`}{" "}
                  {i18n._(CYCLE_COPY.currentLowConfidence)}
                </p>
              ) : null}
              <ul className="divide-y divide-rule border-t border-rule">
                {estimates.data.cycles
                  .filter((cycle) => cycle.nextStartDate)
                  .map((cycle) => {
                    const luteal = i18n._(CYCLE_COPY.lutealLabel);
                    return (
                      <li
                        key={cycle.startDate}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-2.5"
                      >
                        <span className="num text-sm text-ink">
                          {t`${cycle.startDate} to ${cycle.nextStartDate}`}
                        </span>
                        <span className="num text-right text-sm text-ink">
                          {t`${plural(cycle.lengthDays ?? 0, { one: "# day", other: "# days" })}`}
                        </span>
                        {cycle.lutealEstimate ? (
                          <span className="col-span-2 text-sm text-ink-3">
                            {t`${luteal}: ${cycle.lutealEstimate.from} to ${cycle.lutealEstimate.to}`}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </>
          )}
          <label className="flex items-start gap-2 border-t border-rule pt-4 text-sm text-ink-2">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
              checked={noNaturalCycle}
              disabled={updateSettings.isPending}
              onChange={(event) => updateSettings.mutate(event.target.checked)}
            />
            <Trans comment="safety">
              I use hormonal contraception or have no natural cycle (turns estimates off)
            </Trans>
          </label>
        </div>
      </Section>

      <Section title={<Trans>History</Trans>}>
        {periods.data?.length ? (
          <ul className="sheet divide-y divide-rule">
            {periods.data.map((period) => (
              <li
                key={period.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]"
              >
                <span className="num text-sm text-ink">
                  {period.endDate ? t`${period.startDate} to ${period.endDate}` : period.startDate}
                </span>
                <span className="text-sm text-ink-2 max-sm:col-start-1">
                  {period.flow ? i18n._(FLOW_LABELS[period.flow]) : ""}
                </span>
                <span className="text-sm text-ink-3 max-sm:col-start-1">
                  {period.source !== "manual" ? t`imported` : ""}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
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
          <EmptyState title={<Trans>No periods logged yet.</Trans>} />
        )}
        {imports.data?.length ? (
          <div className="grid gap-2 pt-4">
            <h3 className="text-base text-ink">
              <Trans>Imports</Trans>
            </h3>
            <ul className="divide-y divide-rule border-t border-rule">
              {imports.data.map((run) => (
                <li
                  key={run.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]"
                >
                  <span className="text-sm text-ink">
                    {run.source === "health_connect" ? "Health Connect" : "Apple Health"}
                  </span>
                  <span className="num text-sm text-ink-2 max-sm:col-start-1">
                    {t`${plural(run.periodCount, { one: "# period", other: "# periods" })}`}
                  </span>
                  <span className="num text-sm text-ink-3 max-sm:col-start-1">
                    {new Date(run.importedAt).toLocaleDateString()}
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
      </Section>

      <Section title={<Trans>Log a period</Trans>} className="well px-5 pt-4 pb-5">
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
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-flow">
              <Trans>Flow (optional)</Trans>
            </Label>
            <select
              id="cycle-flow"
              className="h-9 rounded-sm border border-input bg-sheet px-3 text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
              value={flow}
              onChange={(event) => setFlow(event.target.value as typeof flow)}
            >
              <option value="">{t`Not recorded`}</option>
              {FLOWS.map((value) => (
                <option key={value} value={value}>
                  {i18n._(FLOW_LABELS[value])}
                </option>
              ))}
            </select>
          </div>
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
          <Button
            className="w-fit"
            disabled={!startDate || log.isPending}
            onClick={() => log.mutate()}
          >
            {log.isPending ? <Trans>Saving…</Trans> : <Trans>Save period</Trans>}
          </Button>
        </div>
      </Section>

      <Section title={<Trans>Turn off and erase</Trans>} className="border-t border-rule pt-6">
        <div className="grid justify-items-start gap-3">
          <p className="max-w-[65ch] text-ink-2">
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
      </Section>
      {notice ? (
        <p role="status" aria-live="polite" className="text-sm text-ink-3">
          {notice}
        </p>
      ) : null}
    </>
  );
}
