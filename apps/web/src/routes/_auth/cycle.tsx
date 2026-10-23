import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CYCLE_COPY } from "@openvalens/api/presenters/cycle";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

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
      <main className="container mx-auto max-w-3xl px-4 py-6">
        <p role="status" className="text-sm text-muted-foreground">
          {isPending ? (
            <Trans>Checking your account…</Trans>
          ) : (
            <Trans>Choose a workspace to continue.</Trans>
          )}
        </p>
      </main>
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
    <main className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <header>
        <p className="text-sm text-muted-foreground">
          <Trans>Your records</Trans>
        </p>
        <h1 className="text-2xl font-semibold">
          <Trans>Cycle</Trans>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {i18n._(CYCLE_COPY.notForContraception)}
        </p>
      </header>
      {settings.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>Checking your cycle setting…</Trans>
        </p>
      ) : settings.isError ? (
        <div className="grid gap-2">
          <p role="alert">
            <Trans>Could not check this setting.</Trans>
          </p>
          <Button className="w-fit" variant="outline" onClick={() => void settings.refetch()}>
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : !settings.data.enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Cycle logging is off</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm">{i18n._(CYCLE_COPY.consentText)}</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <Trans comment="safety">
                I agree to store my cycle data on this server for my own reference.
              </Trans>
            </label>
            <Button
              className="w-fit"
              disabled={!agreed || enable.isPending}
              onClick={() => enable.mutate()}
            >
              {enable.isPending ? <Trans>Turning on…</Trans> : <Trans>Turn on cycle logging</Trans>}
            </Button>
            {enable.isError ? (
              <p role="alert" className="text-sm text-destructive">
                <Trans>Could not turn this on. Try again.</Trans>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <CycleEnabled
          noNaturalCycle={settings.data.noNaturalCycle}
          keyFor={key}
          refresh={refresh}
        />
      )}
    </main>
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
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Estimates</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {estimates.isPending ? (
            <p role="status">
              <Trans>Loading…</Trans>
            </p>
          ) : estimates.isError ? (
            <p role="alert">
              <Trans>Could not load estimates.</Trans>
            </p>
          ) : estimates.data.state === "off" ? (
            <p>{i18n._(CYCLE_COPY.noNaturalCycle)}</p>
          ) : estimates.data.state === "no_data" ? (
            <p className="text-muted-foreground">
              <Trans>Log a period to see your cycle history.</Trans>
            </p>
          ) : (
            <>
              {estimates.data.current ? (
                <p>
                  {t`Day ${estimates.data.current.dayOfCycle} of the current cycle (started ${estimates.data.current.startDate}).`}{" "}
                  {i18n._(CYCLE_COPY.currentLowConfidence)}
                </p>
              ) : null}
              <ul className="grid gap-2">
                {estimates.data.cycles
                  .filter((cycle) => cycle.nextStartDate)
                  .map((cycle) => {
                    const start = cycle.startDate;
                    const next = cycle.nextStartDate;
                    const luteal = i18n._(CYCLE_COPY.lutealLabel);
                    return (
                      <li key={start} className="rounded-md border p-3">
                        <p>
                          {t`${start} to ${next} · ${plural(cycle.lengthDays ?? 0, { one: "# day", other: "# days" })}`}
                        </p>
                        {cycle.lutealEstimate ? (
                          <p className="text-muted-foreground">
                            {t`${luteal}: ${cycle.lutealEstimate.from} to ${cycle.lutealEstimate.to}`}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={noNaturalCycle}
              disabled={updateSettings.isPending}
              onChange={(event) => updateSettings.mutate(event.target.checked)}
            />
            <Trans comment="safety">
              I use hormonal contraception or have no natural cycle (turns estimates off)
            </Trans>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Log a period</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
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
              className="h-10 rounded-md border bg-background px-3"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>History</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {periods.data?.length ? (
            <ul className="grid gap-2">
              {periods.data.map((period) => (
                <li
                  key={period.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span>
                    {period.endDate
                      ? t`${period.startDate} to ${period.endDate}`
                      : period.startDate}
                    {period.flow ? ` · ${i18n._(FLOW_LABELS[period.flow])}` : ""}
                    {period.source !== "manual" ? ` · ${t`imported`}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
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
            <p className="text-muted-foreground">
              <Trans>No periods logged yet.</Trans>
            </p>
          )}
          {imports.data?.length ? (
            <div className="grid gap-2">
              <h2 className="font-medium">
                <Trans>Imports</Trans>
              </h2>
              {imports.data.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span>
                    {run.source === "health_connect" ? "Health Connect" : "Apple Health"} ·{" "}
                    {t`${plural(run.periodCount, { one: "# period", other: "# periods" })}`} ·{" "}
                    {new Date(run.importedAt).toLocaleDateString()}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(run.id)}
                  >
                    <Trans>Undo import</Trans>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Turn off and erase</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>
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
            <Button className="w-fit" variant="outline" onClick={() => setConfirmErase(true)}>
              <Trans>Turn off and erase</Trans>
            </Button>
          )}
        </CardContent>
      </Card>
      {notice ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </>
  );
}
