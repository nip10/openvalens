import {
  medicationDoseLabel,
  sentenceCase,
  SUPPLEMENT_FREQUENCIES,
  supplementDoseLabel,
  supplementFrequencyLabel,
} from "@openvalens/api/presenters/supplements";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/supplements")({
  component: SupplementsPage,
});

const UNITS = ["mg", "mcg", "IU", "g", "ml"] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

function SaveStatus({
  pending,
  isError,
  isSuccess,
}: {
  pending: boolean;
  isError: boolean;
  isSuccess: boolean;
}) {
  if (isError) return <span className="text-sm text-destructive">Could not save.</span>;
  if (pending) return <span className="text-sm text-muted-foreground">Saving…</span>;
  if (isSuccess) return <span className="text-sm text-success">Saved</span>;
  return null;
}

function AddSupplementForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);

  const addSupplement = useMutation(orpc.plans.upsertSupplement.mutationOptions());
  const addSchedule = useMutation(orpc.plans.upsertSchedule.mutationOptions());

  const numeric = Number(dose);
  const valid = name.trim().length > 0 && dose.trim().length > 0 && Number.isFinite(numeric);
  const pending = addSupplement.isPending || addSchedule.isPending;

  const submit = async () => {
    if (!valid || pending) return;
    const created = await addSupplement.mutateAsync({
      name: name.trim(),
      dose: supplementDoseLabel(numeric, unit),
    });
    // The supplement row has no frequency column; the reminder lives on the
    // schedule. Persist the chosen cadence so the card reflects it.
    await addSchedule.mutateAsync({
      supplementId: created.id,
      timeOfDay: "morning",
      frequency,
    });
    setName("");
    setDose("");
    setFrequency(SUPPLEMENT_FREQUENCIES[0]);
    onSaved();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add supplement</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Vitamin D"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Dose">
            <Input
              inputMode="decimal"
              value={dose}
              onChange={(event) => setDose(event.target.value)}
              placeholder="500"
            />
          </Field>
          <Field label="Unit">
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue>{unit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue>{supplementFrequencyLabel(frequency)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SUPPLEMENT_FREQUENCIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {supplementFrequencyLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void submit()} disabled={!valid || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <SaveStatus
            pending={pending}
            isError={addSupplement.isError || addSchedule.isError}
            isSuccess={addSupplement.isSuccess && addSchedule.isSuccess}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AddMedicationForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);

  const addMedication = useMutation(orpc.plans.upsertMedication.mutationOptions());

  const numeric = Number(dose);
  const valid = name.trim().length > 0 && dose.trim().length > 0 && Number.isFinite(numeric);

  const submit = () => {
    if (!valid || addMedication.isPending) return;
    addMedication.mutate(
      {
        name: name.trim(),
        dose: medicationDoseLabel(numeric, unit),
        frequency,
      },
      {
        onSuccess: () => {
          setName("");
          setDose("");
          setFrequency(SUPPLEMENT_FREQUENCIES[0]);
          onSaved();
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add medication</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Metformin"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Dose">
            <Input
              inputMode="decimal"
              value={dose}
              onChange={(event) => setDose(event.target.value)}
              placeholder="500"
            />
          </Field>
          <Field label="Unit">
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue>{unit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue>{supplementFrequencyLabel(frequency)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SUPPLEMENT_FREQUENCIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {supplementFrequencyLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={!valid || addMedication.isPending}>
            {addMedication.isPending ? "Saving…" : "Save"}
          </Button>
          <SaveStatus
            pending={addMedication.isPending}
            isError={addMedication.isError}
            isSuccess={addMedication.isSuccess}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SupplementsPage() {
  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const medications = useQuery(orpc.plans.listMedications.queryOptions({ input: {} }));

  if (supplements.isPending || medications.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Supplements</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (supplements.isError || medications.isError || !supplements.data || !medications.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Supplements</h1>
        <p className="text-sm text-muted-foreground">
          Could not load supplements.{" "}
          <button
            className="underline"
            onClick={() => {
              void supplements.refetch();
              void medications.refetch();
            }}
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  const supplementList = supplements.data;
  const medicationList = medications.data;

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Supplements</h1>

      <AddSupplementForm onSaved={() => void supplements.refetch()} />

      {supplementList.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No supplements logged. Add one to get reminders.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {supplementList.map((supplement) => (
              <li key={supplement.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{supplement.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {supplementDoseLabel(supplement.dose, null)}
                    {supplement.category ? ` · ${supplement.category}` : ""}
                  </div>
                </div>
                {supplement.activeScheduleCount > 0 ? (
                  <Badge variant="secondary">{supplement.activeScheduleCount} scheduled</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddMedicationForm onSaved={() => void medications.refetch()} />

      {medicationList.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No medications logged. Add one to track your protocol.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {medicationList.map((medication) => (
              <li key={medication.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{medication.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {medicationDoseLabel(medication.dose, null)}
                    {medication.frequency
                      ? ` · ${supplementFrequencyLabel(medication.frequency)}`
                      : ""}
                  </div>
                </div>
                <Badge variant="outline">{sentenceCase(medication.status)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
