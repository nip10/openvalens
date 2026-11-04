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
import type { SupplementIntake } from "@openvalens/plans/supplement-intake";
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
import { ModuleHiddenNote } from "@/components/module-hidden-note";

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
        <ModuleHiddenNote module="supplements" />
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
        <ModuleHiddenNote module="supplements" />
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
      <ModuleHiddenNote module="supplements" />
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

      <SupplementIntakeSection supplements={supplementList} />

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

function SupplementIntakeSection({
  supplements,
}: {
  supplements: Array<{ id: number; name: string; dose: string | null }>;
}) {
  const { t } = useLingui();
  const client = useQueryClient();
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = useQuery(orpc.supplementIntake.list.queryOptions({ input: { from } }));
  const [selected, setSelected] = useState(String(supplements[0]?.id ?? ""));
  const [dose, setDose] = useState("");
  const [occurredLocal, setOccurredLocal] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [editDose, setEditDose] = useState("");
  const [editOccurred, setEditOccurred] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [updateKeys, setUpdateKeys] = useState<Record<number, string>>({});
  const [deleteKeys, setDeleteKeys] = useState<Record<number, string>>({});
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: orpc.supplementIntake.key() });
    await client.invalidateQueries({ queryKey: orpc.goals.key() });
  };
  const create = useMutation(
    orpc.supplementIntake.create.mutationOptions({
      onSuccess: async () => {
        setDose("");
        setCreateKey("");
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.supplementIntake.delete.mutationOptions({
      onSuccess: async (_result, variables) => {
        setDeleteKeys((current) => {
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
        await refresh();
      },
    }),
  );
  const correct = useMutation(
    orpc.supplementIntake.update.mutationOptions({
      onSuccess: async (_result, variables) => {
        setEditing(null);
        setUpdateKeys((current) => {
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
        await refresh();
      },
    }),
  );
  return (
    <Section
      icon={Pill}
      tone="food"
      title={<Trans>Log supplement intake</Trans>}
      description={
        <Trans>
          Log doses actually taken. Schedules are reminders, not proof. Goals count the day once,
          while every dose stays recorded.
        </Trans>
      }
    >
      {supplements.length === 0 ? (
        <EmptyState
          title={<Trans>Add a supplement first</Trans>}
          description={
            <Trans>Actual intake can be logged after you add a supplement to your list.</Trans>
          }
        />
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const supplementId = Number(selected);
            const item = supplements.find((s) => s.id === supplementId);
            if (!item) return;
            const actualDose = dose.trim() || item.dose;
            if (!actualDose) return;
            const key = createKey || globalThis.crypto.randomUUID();
            setCreateKey(key);
            create.mutate({
              supplementId,
              occurredAt: new Date(occurredLocal).toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              dose: actualDose,
              clientMutationId: key,
            });
          }}
        >
          <Field label={t`Supplement`}>
            <Select
              value={selected}
              onValueChange={(value) => {
                setSelected(value);
                if (create.isError) setCreateKey("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supplements.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t`Dose taken`}>
            <Input
              value={dose}
              onChange={(e) => {
                setDose(e.target.value);
                if (create.isError) setCreateKey("");
              }}
              placeholder={supplements.find((s) => String(s.id) === selected)?.dose ?? "Dose"}
            />
          </Field>
          <Field label={t`Time taken`}>
            <Input
              type="datetime-local"
              value={occurredLocal}
              onChange={(e) => {
                setOccurredLocal(e.target.value);
                if (create.isError) setCreateKey("");
              }}
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            <Trans>Log dose</Trans>
          </Button>
        </form>
      )}
      {create.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          <Trans>Could not save intake. Try again.</Trans>
        </p>
      ) : null}
      {rows.isError ? (
        <p className="mt-3 text-sm text-destructive">
          <Trans>Could not load recent intake.</Trans>
        </p>
      ) : rows.data?.length ? (
        <ul className="mt-4 grid gap-2">
          {rows.data.map((row: SupplementIntake) => (
            <li key={row.id} className="sheet grid gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>
                    {supplements.find((s) => s.id === row.supplementId)?.name ?? t`Supplement`}
                  </strong>{" "}
                  · {row.dose} · {new Date(row.occurredAt).toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(row.id);
                      setEditDose(row.dose);
                      setEditOccurred(
                        new Date(
                          new Date(row.occurredAt).getTime() -
                            new Date(row.occurredAt).getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16),
                      );
                    }}
                  >
                    <Trans>Correct</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm("Remove this intake record?")) {
                        const key = deleteKeys[row.id] || globalThis.crypto.randomUUID();
                        setDeleteKeys((current) => ({ ...current, [row.id]: key }));
                        remove.mutate({ id: row.id, version: row.version, clientMutationId: key });
                      }
                    }}
                  >
                    <Trans>Undo</Trans>
                  </Button>
                </div>
              </div>
              {editing === row.id ? (
                <div className="flex flex-wrap gap-2">
                  <Input
                    aria-label="Corrected dose"
                    value={editDose}
                    onChange={(e) => setEditDose(e.target.value)}
                  />
                  <Input
                    aria-label="Corrected time"
                    type="datetime-local"
                    value={editOccurred}
                    onChange={(e) => setEditOccurred(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={correct.isPending}
                    onClick={() => {
                      const key = updateKeys[row.id] || globalThis.crypto.randomUUID();
                      setUpdateKeys((current) => ({ ...current, [row.id]: key }));
                      correct.mutate({
                        id: row.id,
                        version: row.version,
                        dose: editDose,
                        occurredAt: new Date(editOccurred).toISOString(),
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                        clientMutationId: key,
                      });
                    }}
                  >
                    <Trans>Save correction</Trans>
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-3">
          <Trans>No actual doses logged this week.</Trans>
        </p>
      )}
    </Section>
  );
}
