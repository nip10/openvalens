import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { client } from "@/utils/orpc";
import {
  PRIVATE_MEASUREMENT_KINDS,
  PRIVATE_MEASUREMENT_LABELS,
  unitsForMeasurement,
  type PrivateMeasurementKind,
} from "@/utils/private-measurements";

export const Route = createFileRoute("/_auth/private-measurements")({
  component: PrivateMeasurements,
});

type Kind = PrivateMeasurementKind;
type Unit = "kg" | "lb" | "cm" | "in";
const kinds = PRIVATE_MEASUREMENT_KINDS;
const labels = PRIVATE_MEASUREMENT_LABELS;
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function PrivateMeasurements() {
  const qc = useQueryClient();
  const preference = useQuery({
    queryKey: ["privateBody", "preference"],
    queryFn: () => client.privateBody.preference({}),
    retry: false,
  });
  // Hide-numbers preference (#80) is not yet available. Fail closed: never
  // render stored values until that client-safe preference can be confirmed.
  const history = useQuery({
    queryKey: ["privateBody", "list"],
    queryFn: () => client.privateBody.list({}),
    enabled: preference.data?.enabled === true,
  });
  const [kind, setKind] = useState<Kind>("weight");
  const [unit, setUnit] = useState<Unit>("kg");
  const [value, setValue] = useState("");
  const [measuredAt, setMeasuredAt] = useState(nowLocal);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["privateBody"] });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => client.privateBody.setPreference({ enabled }),
    onSuccess: invalidate,
  });
  const save = useMutation({
    mutationFn: (id?: string) => {
      const input = {
        kind,
        unit,
        value: Number(value),
        measuredAt: new Date(measuredAt).toISOString(),
      };
      return id
        ? client.privateBody.update({ id, value: input })
        : client.privateBody.create(input);
    },
    onSuccess: () => {
      setValue("");
      setEditing(null);
      setMeasuredAt(nowLocal());
      setNotice("Entry saved.");
      invalidate();
    },
    onError: () => setNotice("Could not save. Check your connection and try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.privateBody.delete({ id }),
    onSuccess: () => {
      invalidate();
      setNotice("Entry deleted.");
    },
    onError: () => setNotice("Could not delete this entry. Check your connection and try again."),
  });
  const deleteEntry = (id: string) => {
    if (window.confirm("Delete this private measurement? This cannot be undone.")) {
      remove.mutate(id);
    }
  };
  return (
    <main className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <header>
        <p className="text-sm text-muted-foreground">Your records</p>
        <h1 className="text-2xl font-semibold">Private measurements</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          These manual entries are private to your account. Workspace owners and other members
          cannot view them. They are separate from shared workspace body records.
        </p>
      </header>
      {preference.isPending ? (
        <Card>
          <CardContent className="py-6" role="status">
            Checking your private measurement setting…
          </CardContent>
        </Card>
      ) : preference.isError ? (
        <Card>
          <CardContent className="py-6">
            <p role="alert">
              Could not check this setting. Measurements stay unavailable until it can be confirmed.
            </p>
            <Button className="mt-3" variant="outline" onClick={() => void preference.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !preference.data.enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Private measurements are off</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Turn this on to record weight or circumference measurements for your own reference. It
              is off by default.
            </p>
            <Button
              className="w-fit"
              onClick={() => toggle.mutate(true)}
              disabled={toggle.isPending}
            >
              {toggle.isPending ? "Saving…" : "Turn on private measurements"}
            </Button>
            {toggle.isError && (
              <p role="alert" className="text-sm text-destructive">
                Could not update this setting. Try again.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
            <span className="text-sm">Private measurements are on</span>
            <Button
              variant="outline"
              onClick={() => toggle.mutate(false)}
              disabled={toggle.isPending}
            >
              Turn off
            </Button>
          </div>
          {toggle.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not update this setting. Try again.
            </p>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{editing ? "Edit entry" : "Add an entry"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="measurement-kind">Measurement</Label>
                <select
                  id="measurement-kind"
                  className="h-10 rounded-md border bg-background px-3"
                  value={kind}
                  onChange={(e) => {
                    const next = e.target.value as Kind;
                    setKind(next);
                    setUnit(next === "weight" ? "kg" : "cm");
                  }}
                  aria-label="Measurement type"
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {labels[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="measurement-value">{labels[kind]} value</Label>
                <div className="flex gap-2">
                  <Input
                    id="measurement-value"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <select
                    aria-label="Unit"
                    className="h-10 rounded-md border bg-background px-3"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                  >
                    {unitsForMeasurement(kind).map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="measurement-time">Observed at</Label>
                <Input
                  id="measurement-time"
                  type="datetime-local"
                  value={measuredAt}
                  onChange={(e) => setMeasuredAt(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button
                  onClick={() => save.mutate(editing ?? undefined)}
                  disabled={
                    !Number.isFinite(Number(value)) ||
                    Number(value) <= 0 ||
                    !measuredAt ||
                    save.isPending
                  }
                >
                  {save.isPending ? "Saving…" : editing ? "Save changes" : "Save entry"}
                </Button>
                {editing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(null);
                      setValue("");
                    }}
                  >
                    Cancel
                  </Button>
                )}
                {save.isError && (
                  <span role="alert" className="text-sm text-destructive">
                    {notice}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <p className="text-sm text-muted-foreground">
                Values are hidden until your hide-numbers setting can be checked.
              </p>
            </CardHeader>
            <CardContent>
              {history.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading your entries…
                </p>
              ) : history.isError ? (
                <div>
                  <p role="alert" className="text-sm">
                    Could not load entries.
                  </p>
                  <Button variant="outline" className="mt-2" onClick={() => void history.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : history.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">No private entries yet.</p>
              ) : (
                <ul className="divide-y">
                  {history.data.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <p className="font-medium">{labels[row.kind as Kind]}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(row.measuredAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditing(row.id);
                            setKind(row.kind as Kind);
                            setUnit(row.unit as Unit);
                            setValue("");
                            setMeasuredAt(
                              new Date(
                                new Date(row.measuredAt).getTime() -
                                  new Date(row.measuredAt).getTimezoneOffset() * 60000,
                              )
                                .toISOString()
                                .slice(0, 16),
                            );
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => deleteEntry(row.id)}>
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {notice && !save.isError && !remove.isError && (
                <p role="status" className="sr-only">
                  {notice}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
