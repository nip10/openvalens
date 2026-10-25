import { useLingui as useLinguiRuntime } from "@lingui/react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  frequencyNeedsDays,
  medicationDoseLabel,
  medicationStatusLabel,
  SUPPLEMENT_FREQUENCIES,
  supplementDoseLabel,
  supplementFrequencyLabel,
} from "@openvalens/api/presenters/supplements";
import { Button } from "@openvalens/ui/components/button";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ReminderDaysField, ReminderDaysRow } from "@/components/reminder-days";
import { Pill, Plus, Tablets } from "lucide-react";

import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/supplements")({
  component: SupplementsPage,
});

const UNITS = ["mg", "mcg", "IU", "g", "ml"] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-medium text-ink-3">{label}</Label>
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
  if (isError)
    return (
      <span className="text-sm text-destructive">
        <Trans>Could not save.</Trans>
      </span>
    );
  if (pending)
    return (
      <span className="text-sm text-ink-3">
        <Trans>Saving…</Trans>
      </span>
    );
  if (isSuccess)
    return (
      <span className="text-sm text-success">
        <Trans>Saved</Trans>
      </span>
    );
  return null;
}

function AddSupplementForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);
  const [days, setDays] = useState<number[]>([]);
  const needsDays = frequencyNeedsDays(frequency);

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
      daysOfWeek: needsDays ? days : null,
    });
    setName("");
    setDose("");
    setFrequency(SUPPLEMENT_FREQUENCIES[0]);
    setDays([]);
    onSaved();
  };

  return (
    <section className="sheet grid min-w-0 gap-4 p-5" aria-labelledby="add-supplement-heading">
      <h3 id="add-supplement-heading" className="flex items-center gap-2.5 text-lg text-ink">
        <ToneIcon icon={Plus} tone="food" size="sm" />
        <Trans>Add supplement</Trans>
      </h3>
      <Field label={t`Name`}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Vitamin D"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        <Field label={t({ message: "Dose", comment: "safety" })}>
          <Input
            inputMode="decimal"
            value={dose}
            onChange={(event) => setDose(event.target.value)}
            placeholder="500"
            className="num"
          />
        </Field>
        <Field label={t({ message: "Unit", comment: "safety" })}>
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
        <Field label={t({ message: "Frequency", comment: "safety" })}>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger>
              <SelectValue>{_(supplementFrequencyLabel(frequency))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUPPLEMENT_FREQUENCIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {_(supplementFrequencyLabel(option))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {needsDays ? (
        <ReminderDaysField frequency={frequency} value={days} onChange={setDays} />
      ) : null}
      <div className="flex items-center gap-3">
        <Button onClick={() => void submit()} disabled={!valid || pending}>
          {pending ? t`Saving…` : t`Save`}
        </Button>
        <SaveStatus
          pending={pending}
          isError={addSupplement.isError || addSchedule.isError}
          isSuccess={addSupplement.isSuccess && addSchedule.isSuccess}
        />
      </div>
    </section>
  );
}

function AddMedicationForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);
  const [days, setDays] = useState<number[]>([]);
  const needsDays = frequencyNeedsDays(frequency);

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
        daysOfWeek: needsDays ? days : null,
      },
      {
        onSuccess: () => {
          setName("");
          setDose("");
          setFrequency(SUPPLEMENT_FREQUENCIES[0]);
          setDays([]);
          onSaved();
        },
      },
    );
  };

  return (
    <section className="sheet grid min-w-0 gap-4 p-5" aria-labelledby="add-medication-heading">
      <h3 id="add-medication-heading" className="flex items-center gap-2.5 text-lg text-ink">
        <ToneIcon icon={Plus} tone="heart" size="sm" />
        <Trans>Add medication</Trans>
      </h3>
      <Field label={t`Name`}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Metformin"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        <Field label={t({ message: "Dose", comment: "safety" })}>
          <Input
            inputMode="decimal"
            value={dose}
            onChange={(event) => setDose(event.target.value)}
            placeholder="500"
            className="num"
          />
        </Field>
        <Field label={t({ message: "Unit", comment: "safety" })}>
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
        <Field label={t({ message: "Frequency", comment: "safety" })}>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger>
              <SelectValue>{_(supplementFrequencyLabel(frequency))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUPPLEMENT_FREQUENCIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {_(supplementFrequencyLabel(option))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {needsDays ? (
        <ReminderDaysField frequency={frequency} value={days} onChange={setDays} />
      ) : null}
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={submit} disabled={!valid || addMedication.isPending}>
          {addMedication.isPending ? t`Saving…` : t`Save`}
        </Button>
        <SaveStatus
          pending={addMedication.isPending}
          isError={addMedication.isError}
          isSuccess={addMedication.isSuccess}
        />
      </div>
    </section>
  );
}

function SupplementsPage() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const queryClient = useQueryClient();
  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const medications = useQuery(orpc.plans.listMedications.queryOptions({ input: {} }));
  const saveScheduleDays = useMutation(
    orpc.plans.upsertSchedule.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: orpc.plans.listSupplements.key() }),
    }),
  );
  const saveMedicationDays = useMutation(
    orpc.plans.upsertMedication.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: orpc.plans.listMedications.key() }),
    }),
  );

  const header = <PageHeader title={<Trans>Supplements</Trans>} />;

  if (supplements.isPending || medications.isPending) {
    return (
      <Page>
        {header}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" aria-hidden="true">
          <div className="grid gap-2">
            {["a", "b", "c", "d"].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </Page>
    );
  }

  if (supplements.isError || medications.isError || !supplements.data || !medications.data) {
    return (
      <Page>
        {header}
        <ErrorState
          title={<Trans>Could not load supplements.</Trans>}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void supplements.refetch();
                void medications.refetch();
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  const supplementList = supplements.data;
  const medicationList = medications.data;

  return (
    <Page>
      {header}

      <section
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
        aria-label={t`Supplements`}
      >
        {supplementList.length === 0 ? (
          <EmptyState
            icon={Pill}
            title={<Trans>No supplements logged. Add one to get reminders.</Trans>}
          />
        ) : (
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label={t`Supplements`}>
            {supplementList.map((supplement) => (
              <li key={supplement.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                <div className="flex items-start gap-3">
                  <ToneIcon icon={Pill} tone="food" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-semibold break-words text-ink">{supplement.name}</span>
                    {supplement.category || supplement.activeScheduleCount > 0 ? (
                      <span className="text-sm text-ink-3">
                        {supplement.category}
                        {supplement.category && supplement.activeScheduleCount > 0 ? ", " : ""}
                        {supplement.activeScheduleCount > 0
                          ? t`${plural(supplement.activeScheduleCount, { one: "# scheduled", other: "# scheduled" })}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                  <span className="num shrink-0 rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink">
                    <span className="sr-only">{t({ message: "Dose", comment: "safety" })}: </span>
                    {supplementDoseLabel(supplement.dose, null)}
                  </span>
                </div>
                {supplement.schedules
                  .filter(
                    (schedule) =>
                      schedule.status === "active" && frequencyNeedsDays(schedule.frequency),
                  )
                  .map((schedule) => (
                    <ReminderDaysRow
                      key={schedule.id}
                      item={schedule}
                      pending={saveScheduleDays.isPending}
                      onSave={(daysOfWeek) =>
                        saveScheduleDays.mutate({ id: schedule.id, daysOfWeek })
                      }
                    />
                  ))}
              </li>
            ))}
          </ul>
        )}
        <AddSupplementForm onSaved={() => void supplements.refetch()} />
      </section>

      <Section icon={Tablets} tone="heart" title={<Trans>Medications</Trans>}>
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {medicationList.length === 0 ? (
            <EmptyState
              title={<Trans>No medications logged. Add one to track your protocol.</Trans>}
            />
          ) : (
            <ul className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label={t`Medications`}>
              {medicationList.map((medication) => (
                <li key={medication.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <ToneIcon icon={Tablets} tone="heart" />
                    <div className="grid min-w-0 flex-1 gap-1">
                      <span className="font-semibold break-words text-ink">{medication.name}</span>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                        <StatusPill tone={medication.status === "active" ? "good" : "neutral"}>
                          <span className="sr-only">{t`Status`}: </span>
                          {_(medicationStatusLabel(medication.status))}
                        </StatusPill>
                        {medication.frequency && !frequencyNeedsDays(medication.frequency)
                          ? _(supplementFrequencyLabel(medication.frequency))
                          : null}
                      </span>
                    </div>
                    <span className="num shrink-0 rounded-full bg-heart-soft px-2.5 py-1 text-sm font-semibold text-ink">
                      <span className="sr-only">{t({ message: "Dose", comment: "safety" })}: </span>
                      {medicationDoseLabel(medication.dose, null)}
                    </span>
                  </div>
                  {frequencyNeedsDays(medication.frequency) ? (
                    <ReminderDaysRow
                      item={medication}
                      pending={saveMedicationDays.isPending}
                      onSave={(daysOfWeek) =>
                        saveMedicationDays.mutate({
                          id: medication.id,
                          name: medication.name,
                          dose: medication.dose,
                          route: medication.route,
                          protocol: medication.protocol,
                          frequency: medication.frequency,
                          status: medication.status,
                          interactions: medication.interactions,
                          notes: medication.notes,
                          daysOfWeek,
                        })
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <AddMedicationForm onSaved={() => void medications.refetch()} />
        </div>
      </Section>
    </Page>
  );
}
