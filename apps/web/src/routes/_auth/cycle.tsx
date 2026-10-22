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
const FLOW_LABELS: Record<(typeof FLOWS)[number], string> = {
  spotting: "Spotting",
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
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
          {isPending ? "Checking your account…" : "Choose a workspace to continue."}
        </p>
      </main>
    );
  return <CycleForMember key={scope} scope={scope} />;
}

function CycleForMember({ scope }: { scope: string }) {
  const qc = useQueryClient();
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
        <p className="text-sm text-muted-foreground">Your records</p>
        <h1 className="text-2xl font-semibold">Cycle</h1>
        <p className="mt-2 text-sm text-muted-foreground">{CYCLE_COPY.notForContraception}</p>
      </header>
      {settings.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your cycle setting…
        </p>
      ) : settings.isError ? (
        <div className="grid gap-2">
          <p role="alert">Could not check this setting.</p>
          <Button className="w-fit" variant="outline" onClick={() => void settings.refetch()}>
            Try again
          </Button>
        </div>
      ) : !settings.data.enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Cycle logging is off</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm">{CYCLE_COPY.consentText}</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              I agree to store my cycle data on this server for my own reference.
            </label>
            <Button
              className="w-fit"
              disabled={!agreed || enable.isPending}
              onClick={() => enable.mutate()}
            >
              {enable.isPending ? "Turning on…" : "Turn on cycle logging"}
            </Button>
            {enable.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Could not turn this on. Try again.
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
      setNotice("Period saved.");
      refresh();
    },
    onError: () => setNotice("Could not save. Check the dates and try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.cycle.deletePeriod({ id }),
    onSuccess: () => {
      setNotice("Period deleted.");
      refresh();
    },
  });
  const undo = useMutation({
    mutationFn: (importId: string) => client.cycle.undoImport({ importId }),
    onSuccess: (result) => {
      setNotice(`Import undone. ${result.removed} imported periods removed.`);
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
          <CardTitle>Estimates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {estimates.isPending ? (
            <p role="status">Loading…</p>
          ) : estimates.isError ? (
            <p role="alert">Could not load estimates.</p>
          ) : estimates.data.state === "off" ? (
            <p>{CYCLE_COPY.noNaturalCycle}</p>
          ) : estimates.data.state === "no_data" ? (
            <p className="text-muted-foreground">Log a period to see your cycle history.</p>
          ) : (
            <>
              {estimates.data.current ? (
                <p>
                  Day {estimates.data.current.dayOfCycle} of the current cycle (started{" "}
                  {estimates.data.current.startDate}). {CYCLE_COPY.currentLowConfidence}
                </p>
              ) : null}
              <ul className="grid gap-2">
                {estimates.data.cycles
                  .filter((cycle) => cycle.nextStartDate)
                  .map((cycle) => (
                    <li key={cycle.startDate} className="rounded-md border p-3">
                      <p>
                        {cycle.startDate} to {cycle.nextStartDate} · {cycle.lengthDays} days
                      </p>
                      {cycle.lutealEstimate ? (
                        <p className="text-muted-foreground">
                          {CYCLE_COPY.lutealLabel}: {cycle.lutealEstimate.from} to{" "}
                          {cycle.lutealEstimate.to}
                        </p>
                      ) : null}
                    </li>
                  ))}
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
            I use hormonal contraception or have no natural cycle (turns estimates off)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log a period</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-start">Start date</Label>
            <Input
              id="cycle-start"
              type="date"
              max={today}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-end">End date (optional)</Label>
            <Input
              id="cycle-end"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-flow">Flow (optional)</Label>
            <select
              id="cycle-flow"
              className="h-10 rounded-md border bg-background px-3"
              value={flow}
              onChange={(event) => setFlow(event.target.value as typeof flow)}
            >
              <option value="">Not recorded</option>
              {FLOWS.map((value) => (
                <option key={value} value={value}>
                  {FLOW_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cycle-notes">Notes (optional)</Label>
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
            {log.isPending ? "Saving…" : "Save period"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
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
                    {period.startDate}
                    {period.endDate ? ` to ${period.endDate}` : ""}
                    {period.flow ? ` · ${FLOW_LABELS[period.flow]}` : ""}
                    {period.source !== "manual" ? " · imported" : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm("Delete this period?")) remove.mutate(period.id);
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No periods logged yet.</p>
          )}
          {imports.data?.length ? (
            <div className="grid gap-2">
              <h2 className="font-medium">Imports</h2>
              {imports.data.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span>
                    {run.source === "health_connect" ? "Health Connect" : "Apple Health"} ·{" "}
                    {run.periodCount} periods · {new Date(run.importedAt).toLocaleDateString()}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(run.id)}
                  >
                    Undo import
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Turn off and erase</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>
            Deletes every period and import you have logged, in every workspace, and withdraws your
            consent. This cannot be undone.
          </p>
          {confirmErase ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                disabled={erase.isPending}
                onClick={() => erase.mutate()}
              >
                {erase.isPending ? "Erasing…" : "Erase all cycle data"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmErase(false)}>
                Keep my data
              </Button>
            </div>
          ) : (
            <Button className="w-fit" variant="outline" onClick={() => setConfirmErase(true)}>
              Turn off and erase
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
