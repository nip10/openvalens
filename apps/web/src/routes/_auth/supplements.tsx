import { useLingui as useLinguiRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatScheduleTime,
  frequencyNeedsDays,
  medicationDoseLabel,
  medicationStatusLabel,
  SUPPLEMENT_FREQUENCIES,
  supplementDoseLabel,
  supplementFrequencyLabel,
} from "@openvalens/api/presenters/supplements";
import type { SupplementIntake } from "@openvalens/plans/supplement-intake";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openvalens/ui/components/alert-dialog";
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
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, History, ListChecks, Pencil, Pill, Plus, Tablets, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { DecimalHint } from "@/components/decimal-hint";
import { FormDialog } from "@/components/form-dialog";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { MoreMenu } from "@/components/more-menu";
import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { useOpenLog } from "@/components/quick-log/log-launcher";
import { ReminderDaysField, ReminderDaysRow } from "@/components/reminder-days";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import {
  buildChecklist,
  type ChecklistGroupId,
  type ChecklistItem,
  type ChecklistSchedule,
  localDateOf,
  scheduleAmount,
} from "@/utils/supplement-checklist";
import { supplementIntakeWindowStart } from "@/utils/supplement-intake-window";
import { parseDecimal } from "@openvalens/i18n/numbers";

export const Route = createFileRoute("/_auth/supplements")({
  component: SupplementsPage,
});

const UNITS = ["mg", "mcg", "IU", "g", "ml"] as const;
const TIMES_OF_DAY = ["morning", "lunch", "dinner", "pre-bed", "training"] as const;

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const newMutationId = () => globalThis.crypto.randomUUID();

/** `YYYY-MM-DDTHH:mm` in the device zone, for a datetime-local input. */
function localInputValue(iso: string | Date): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-ink-3">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * The dose history window (local midnight seven days back). Fixed once per
 * mount: a fresh timestamp each render changed the query key and refetched
 * the list forever (supplements#0).
 */
function useWeekIntakes() {
  const [from] = useState(() => supplementIntakeWindowStart(new Date()));
  return useQuery(orpc.supplementIntake.list.queryOptions({ input: { from } }));
}

function useRefreshIntakes() {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: orpc.supplementIntake.key() });
    await client.invalidateQueries({ queryKey: orpc.quickLog.key() });
    await client.invalidateQueries({ queryKey: orpc.goals.key() });
  };
}

/** Name, dose with its unit beside it, and how often: shared by both create dialogs. */
function DoseFields({
  idPrefix,
  dose,
  onDose,
  unit,
  onUnit,
  frequency,
  onFrequency,
}: {
  idPrefix: string;
  dose: string;
  onDose: (value: string) => void;
  unit: string;
  onUnit: (value: string) => void;
  frequency: string;
  onFrequency: (value: string) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t({ message: "Dose", comment: "safety" })} htmlFor={`${idPrefix}-dose`}>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-dose`}
            inputMode="decimal"
            value={dose}
            onChange={(event) => onDose(event.target.value)}
            className="num min-w-0 flex-1"
          />
          <Select value={unit} onValueChange={onUnit}>
            <SelectTrigger
              className="w-24 shrink-0"
              aria-label={t({ message: "Unit", comment: "safety" })}
            >
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
        </div>
        <DecimalHint value={dose} />
      </Field>
      <Field label={t({ message: "Frequency", comment: "safety" })}>
        <Select value={frequency} onValueChange={onFrequency}>
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
  );
}

function AddSupplementDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const id = useId();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);
  const [timeOfDay, setTimeOfDay] = useState<(typeof TIMES_OF_DAY)[number]>("morning");
  const [days, setDays] = useState<number[]>([]);
  const needsDays = frequencyNeedsDays(frequency);

  const addSupplement = useMutation(orpc.plans.upsertSupplement.mutationOptions());
  const addSchedule = useMutation(orpc.plans.upsertSchedule.mutationOptions());

  const numeric = parseDecimal(dose, i18n.locale) ?? Number.NaN;
  const valid = name.trim().length > 0 && Number.isFinite(numeric);
  const pending = addSupplement.isPending || addSchedule.isPending;

  const reset = () => {
    setName("");
    setDose("");
    setUnit(UNITS[0]);
    setFrequency(SUPPLEMENT_FREQUENCIES[0]);
    setTimeOfDay("morning");
    setDays([]);
    addSupplement.reset();
    addSchedule.reset();
  };

  const submit = async () => {
    if (!valid || pending) return;
    try {
      const created = await addSupplement.mutateAsync({
        name: name.trim(),
        dose: supplementDoseLabel(numeric, unit),
      });
      // The supplement row has no frequency column; the reminder lives on the schedule.
      await addSchedule.mutateAsync({
        supplementId: created.id,
        timeOfDay,
        frequency,
        daysOfWeek: needsDays ? days : null,
      });
    } catch {
      return;
    }
    reset();
    onSaved();
    onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={<Trans>Add supplement</Trans>}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t`Name`} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t`e.g. Zinc`}
          />
        </Field>
        <DoseFields
          idPrefix={id}
          dose={dose}
          onDose={setDose}
          unit={unit}
          onUnit={setUnit}
          frequency={frequency}
          onFrequency={setFrequency}
        />
        <Field label={t({ message: "Time of day", comment: "safety" })}>
          <Select
            value={timeOfDay}
            onValueChange={(value) => setTimeOfDay(value as (typeof TIMES_OF_DAY)[number])}
          >
            <SelectTrigger>
              <SelectValue>{_(formatScheduleTime(timeOfDay))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TIMES_OF_DAY.map((option) => (
                <SelectItem key={option} value={option}>
                  {_(formatScheduleTime(option))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {needsDays ? (
          <ReminderDaysField frequency={frequency} value={days} onChange={setDays} />
        ) : null}
        {addSupplement.isError || addSchedule.isError ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={!valid || pending}>
            {pending ? t`Saving…` : t`Save`}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

function AddMedicationDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);
  const [days, setDays] = useState<number[]>([]);
  const needsDays = frequencyNeedsDays(frequency);

  const addMedication = useMutation(orpc.plans.upsertMedication.mutationOptions());

  const numeric = parseDecimal(dose, i18n.locale) ?? Number.NaN;
  const valid = name.trim().length > 0 && Number.isFinite(numeric);

  const reset = () => {
    setName("");
    setDose("");
    setUnit(UNITS[0]);
    setFrequency(SUPPLEMENT_FREQUENCIES[0]);
    setDays([]);
    addMedication.reset();
  };

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
          reset();
          onSaved();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={<Trans>Add medication</Trans>}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t`Name`} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t`e.g. Metformin`}
          />
        </Field>
        <DoseFields
          idPrefix={id}
          dose={dose}
          onDose={setDose}
          unit={unit}
          onUnit={setUnit}
          frequency={frequency}
          onFrequency={setFrequency}
        />
        {needsDays ? (
          <ReminderDaysField frequency={frequency} value={days} onChange={setDays} />
        ) : null}
        {addMedication.isError ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={!valid || addMedication.isPending}>
            {addMedication.isPending ? t`Saving…` : t`Save`}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

type SupplementRow = {
  id: number;
  name: string;
  dose: string | null;
  form: string | null;
  schedules: Array<{
    id: number;
    status: string;
    frequency: string | null;
    daysOfWeek: number[] | null;
  }>;
};

function SupplementsPage() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<"supplement" | "medication" | null>(null);
  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const medications = useQuery(orpc.plans.listMedications.queryOptions({ input: {} }));
  // A link from the evidence check ("#supplement-12") lands on its card once loaded.
  const supplementsLoaded = supplements.data !== undefined;
  useEffect(() => {
    if (!supplementsLoaded || typeof window === "undefined" || !window.location.hash) return;
    document
      .getElementById(decodeURIComponent(window.location.hash.slice(1)))
      ?.scrollIntoView({ block: "start" });
  }, [supplementsLoaded]);
  // The list carries each schedule's cadence only; time of day and amount come per supplement.
  const scheduleQueries = useQueries({
    queries: (supplements.data ?? []).map((supplement) =>
      orpc.plans.listSchedules.queryOptions({ input: { supplementId: supplement.id } }),
    ),
  });
  const schedules: ChecklistSchedule[] = scheduleQueries.flatMap((query) => query.data ?? []);
  const schedulesPending = scheduleQueries.some((query) => query.isPending);
  const intakes = useWeekIntakes();
  const saveScheduleDays = useMutation(
    orpc.plans.upsertSchedule.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plans.key() }),
    }),
  );
  const saveMedicationDays = useMutation(
    orpc.plans.upsertMedication.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: orpc.plans.listMedications.key() }),
    }),
  );

  const header = (
    <PageHeader
      title={<Trans>Supplements</Trans>}
      actions={
        <>
          <Button onClick={() => setAdding("supplement")}>
            <Plus className="size-4" aria-hidden="true" />
            <Trans>Add supplement</Trans>
          </Button>
          <Button variant="outline" onClick={() => setAdding("medication")}>
            <Plus className="size-4" aria-hidden="true" />
            <Trans>Add medication</Trans>
          </Button>
        </>
      }
    />
  );
  const dialogs = (
    <>
      <AddSupplementDialog
        open={adding === "supplement"}
        onOpenChange={(open) => setAdding(open ? "supplement" : null)}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: orpc.plans.key() })}
      />
      <AddMedicationDialog
        open={adding === "medication"}
        onOpenChange={(open) => setAdding(open ? "medication" : null)}
        onSaved={() =>
          void queryClient.invalidateQueries({ queryKey: orpc.plans.listMedications.key() })
        }
      />
    </>
  );

  if (supplements.isPending || medications.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="supplements" />
        {header}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {["a", "b", "c"].map((key) => (
            <Skeleton key={key} className="h-40 w-full rounded-3xl" />
          ))}
        </div>
        {dialogs}
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
        {dialogs}
      </Page>
    );
  }

  const supplementList = supplements.data as SupplementRow[];
  const medicationList = medications.data;

  return (
    <Page>
      <ModuleHiddenNote module="supplements" />
      {header}

      <TodayChecklist
        supplements={supplementList}
        schedules={schedules}
        schedulesPending={schedulesPending}
        intakes={intakes}
        onAdd={() => setAdding("supplement")}
      />

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <Section icon={Pill} tone="food" title={<Trans>Your supplements</Trans>}>
          {supplementList.length === 0 ? (
            <EmptyState icon={Pill} title={<Trans>No supplements yet</Trans>} />
          ) : (
            <ul className="grid min-w-0 gap-3" aria-label={t`Supplements`}>
              {supplementList.map((supplement) => (
                <SupplementCard
                  key={supplement.id}
                  supplement={supplement}
                  schedules={schedules.filter((item) => item.supplementId === supplement.id)}
                  daysPending={saveScheduleDays.isPending}
                  onSaveDays={(scheduleId, daysOfWeek) =>
                    saveScheduleDays.mutate({ id: scheduleId, daysOfWeek })
                  }
                />
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Tablets} tone="heart" title={<Trans>Medications</Trans>}>
          {medicationList.length === 0 ? (
            <EmptyState icon={Tablets} title={<Trans>No medications yet</Trans>} />
          ) : (
            <ul className="grid min-w-0 gap-3" aria-label={t`Medications`}>
              {medicationList.map((medication) => (
                <MedicationCard
                  key={medication.id}
                  medication={medication}
                  daysPending={saveMedicationDays.isPending}
                  onSaveDays={(daysOfWeek) =>
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
              ))}
            </ul>
          )}
        </Section>
      </div>

      <SupplementIntakeSection supplements={supplementList} />
      {dialogs}
    </Page>
  );
}

const GROUP_ANYTIME = "anytime" satisfies ChecklistGroupId;

/** Today's doses by time of day, each with a one-tap "Taken" (supplements#5, #1). */
function TodayChecklist({
  supplements,
  schedules,
  schedulesPending,
  intakes,
  onAdd,
}: {
  supplements: SupplementRow[];
  schedules: ChecklistSchedule[];
  schedulesPending: boolean;
  intakes: ReturnType<typeof useWeekIntakes>;
  onAdd: () => void;
}) {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const openLog = useOpenLog();
  const refresh = useRefreshIntakes();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const create = useMutation(orpc.supplementIntake.create.mutationOptions());
  const remove = useMutation(orpc.supplementIntake.delete.mutationOptions());
  const time = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" });

  const groups = buildChecklist({
    supplements,
    schedules,
    intakes: intakes.data ?? [],
    today: localDateOf(new Date()),
  });

  const take = (item: ChecklistItem) => {
    if (!item.dose) {
      openLog({ kind: "supplement_intake", values: { supplement: String(item.supplement.id) } });
      return;
    }
    setSavingKey(item.key);
    create.mutate(
      {
        supplementId: item.supplement.id,
        occurredAt: new Date().toISOString(),
        timeZone: deviceTimeZone(),
        dose: item.dose,
        clientMutationId: newMutationId(),
      },
      {
        onSuccess: async (saved) => {
          await refresh();
          const name = item.supplement.name;
          toast.success(t`${name} taken.`, {
            action: {
              label: t`Undo`,
              onClick: () =>
                remove.mutate(
                  { id: saved.id, version: saved.version, clientMutationId: newMutationId() },
                  {
                    onSuccess: () => void refresh(),
                    onError: () => toast.error(t`Could not undo. Remove it from the history.`),
                  },
                ),
            },
          });
        },
        onError: () => toast.error(t`Could not save. Try again.`),
        onSettled: () => setSavingKey(null),
      },
    );
  };

  const groupTitle = (id: ChecklistGroupId) =>
    id === GROUP_ANYTIME ? t`Any time` : _(formatScheduleTime(id));

  return (
    <Section
      icon={ListChecks}
      tone="food"
      title={<Trans>Today</Trans>}
      description={<Trans>Record each dose when you take it.</Trans>}
      info={
        <Trans>
          Schedules are reminders, so only the doses you record count as taken. A goal counts the
          day once, while every dose stays in your history. For a dose at another time, use the +
          button.
        </Trans>
      }
      actions={
        supplements.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => openLog({ kind: "supplement_intake" })}>
            <Plus className="size-4" aria-hidden="true" />
            <Trans>Log another dose</Trans>
          </Button>
        ) : null
      }
    >
      {supplements.length === 0 ? (
        <EmptyState
          icon={Pill}
          title={<Trans>No supplements yet</Trans>}
          description={<Trans>Add one and today's doses show up here.</Trans>}
          action={
            <Button variant="outline" onClick={onAdd}>
              <Trans>Add supplement</Trans>
            </Button>
          }
        />
      ) : schedulesPending || intakes.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {["a", "b"].map((key) => (
            <Skeleton key={key} className="h-32 w-full rounded-3xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="sheet p-5 text-sm text-ink-3">
          <Trans>Nothing scheduled today.</Trans>
        </p>
      ) : (
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const done = group.items.filter((item) => item.taken).length;
            const total = group.items.length;
            return (
              <section
                key={group.id}
                className="sheet flex min-w-0 flex-col gap-3 p-4"
                aria-label={groupTitle(group.id)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-lg text-ink">{groupTitle(group.id)}</h3>
                  <span className="num text-sm text-ink-3">{t`${done} of ${total}`}</span>
                </div>
                <ul className="grid gap-2">
                  {group.items.map((item) => {
                    const name = item.supplement.name;
                    return (
                      <li
                        key={item.key}
                        className="flex min-w-0 items-center gap-3 rounded-2xl bg-paper-2 px-3 py-2"
                      >
                        <div className="grid min-w-0 flex-1">
                          <span className="font-medium break-words text-ink">{name}</span>
                          {item.dose ? (
                            <span className="text-sm text-ink-3">{item.dose}</span>
                          ) : null}
                        </div>
                        {item.taken ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink-2">
                            <Check className="size-4 text-food" aria-hidden="true" />
                            <span className="sr-only">{t`Taken at`} </span>
                            <span className="num">
                              {time.format(new Date(item.taken.occurredAt))}
                            </span>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={savingKey !== null}
                            aria-label={t`Taken: ${name}`}
                            onClick={() => take(item)}
                          >
                            <Check className="size-4" aria-hidden="true" />
                            {savingKey === item.key ? t`Saving…` : t`Taken`}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {intakes.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not load today's doses.</Trans>
        </p>
      ) : null}
    </Section>
  );
}

/** A supplement with its schedule as it reads ("Morning, 1 × softgel"), not a count. */
function SupplementCard({
  supplement,
  schedules,
  daysPending,
  onSaveDays,
}: {
  supplement: SupplementRow;
  schedules: ChecklistSchedule[];
  daysPending: boolean;
  onSaveDays: (scheduleId: number, daysOfWeek: number[]) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const active = schedules.filter((schedule) => schedule.status === "active");
  const timing = active
    .map((schedule) => {
      const amount = scheduleAmount(schedule.quantity, supplement.form);
      const when = _(formatScheduleTime(schedule.timeOfDay));
      return amount ? `${when}, ${amount}` : when;
    })
    .join(" · ");
  return (
    // The id lets the evidence check link to this card (preventive-care#8).
    <li
      id={`supplement-${supplement.id}`}
      className="sheet flex min-w-0 scroll-mt-24 flex-col gap-3 p-4"
    >
      <div className="flex items-start gap-3">
        <ToneIcon icon={Pill} tone="food" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-semibold break-words text-ink">{supplement.name}</span>
          <span className="text-sm text-ink-3">{timing || t`No set time`}</span>
        </div>
        <span className="num shrink-0 rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink">
          <span className="sr-only">{t({ message: "Dose", comment: "safety" })}: </span>
          {supplementDoseLabel(supplement.dose, null)}
        </span>
      </div>
      {supplement.schedules
        .filter(
          (schedule) => schedule.status === "active" && frequencyNeedsDays(schedule.frequency),
        )
        .map((schedule) => (
          <div key={schedule.id} className="mt-auto">
            <ReminderDaysRow
              item={schedule}
              pending={daysPending}
              onSave={(daysOfWeek) => onSaveDays(schedule.id, daysOfWeek)}
            />
          </div>
        ))}
    </li>
  );
}

function MedicationCard({
  medication,
  daysPending,
  onSaveDays,
}: {
  medication: {
    id: number;
    name: string;
    dose: string | null;
    frequency: string | null;
    daysOfWeek: number[] | null;
    status: string;
  };
  daysPending: boolean;
  onSaveDays: (daysOfWeek: number[]) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  return (
    <li className="sheet flex min-w-0 flex-col gap-3 p-4">
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
        <div className="mt-auto">
          <ReminderDaysRow item={medication} pending={daysPending} onSave={onSaveDays} />
        </div>
      ) : null}
    </li>
  );
}

/** This week's recorded doses: correct the dose or time, or remove one. */
export function SupplementIntakeSection({
  supplements,
}: {
  supplements: Array<{ id: number; name: string; dose: string | null }>;
}) {
  const { t, i18n } = useLingui();
  const rows = useWeekIntakes();
  const refresh = useRefreshIntakes();
  const [correcting, setCorrecting] = useState<SupplementIntake | null>(null);
  const [removing, setRemoving] = useState<SupplementIntake | null>(null);
  const [deleteKeys, setDeleteKeys] = useState<Record<number, string>>({});
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
  const time = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" });
  const list = [...(rows.data ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return (
    <Section icon={History} tone="food" title={<Trans>This week</Trans>}>
      {rows.isError ? (
        <p className="text-sm text-destructive">
          <Trans>Could not load recent intake.</Trans>
        </p>
      ) : rows.isPending ? (
        <Skeleton className="h-10 w-full rounded-2xl" aria-hidden="true" />
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-3">
          <Trans>No doses recorded this week.</Trans>
        </p>
      ) : (
        <Details summary={t`Dose history (${list.length})`}>
          <ul className="sheet grid min-w-0 divide-y divide-rule px-4 py-1">
            {list.map((row: SupplementIntake) => {
              const at = new Date(row.occurredAt);
              return (
                <li key={row.id} className="flex min-w-0 items-center gap-3 py-2.5">
                  <div className="grid min-w-0 flex-1">
                    <span className="font-medium break-words text-ink">
                      {supplements.find((s) => s.id === row.supplementId)?.name ?? t`Supplement`}
                    </span>
                    <span className="text-sm text-ink-3">
                      {row.dose} · {friendlyDate(i18n, localDateOf(at))}, {time.format(at)}
                    </span>
                  </div>
                  <MoreMenu
                    label={t`More for this dose`}
                    items={[
                      { label: t`Correct`, icon: Pencil, onSelect: () => setCorrecting(row) },
                      {
                        label: t`Remove`,
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => setRemoving(row),
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </Details>
      )}
      <CorrectIntakeDialog
        intake={correcting}
        onClose={() => setCorrecting(null)}
        onSaved={refresh}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Remove this dose?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>It comes off your history and any goal it counted for.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!removing) return;
                const key = deleteKeys[removing.id] || newMutationId();
                setDeleteKeys((current) => ({ ...current, [removing.id]: key }));
                remove.mutate({
                  id: removing.id,
                  version: removing.version,
                  clientMutationId: key,
                });
                setRemoving(null);
              }}
            >
              <Trans>Remove</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {remove.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not remove it. Try again.</Trans>
        </p>
      ) : null}
    </Section>
  );
}

function CorrectIntakeDialog({
  intake,
  onClose,
  onSaved,
}: {
  intake: SupplementIntake | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  return (
    <FormDialog
      open={intake !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={<Trans>Correct this dose</Trans>}
    >
      {intake ? (
        <CorrectIntakeForm key={intake.id} intake={intake} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </FormDialog>
  );
}

function CorrectIntakeForm({
  intake,
  onClose,
  onSaved,
}: {
  intake: SupplementIntake;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLingui();
  const id = useId();
  const [dose, setDose] = useState(intake.dose);
  const [when, setWhen] = useState(() => localInputValue(intake.occurredAt));
  const [key] = useState(newMutationId);
  const correct = useMutation(
    orpc.supplementIntake.update.mutationOptions({
      onSuccess: async () => {
        await onSaved();
        onClose();
      },
    }),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dose.trim() || !when) return;
        correct.mutate({
          id: intake.id,
          version: intake.version,
          dose: dose.trim(),
          occurredAt: new Date(when).toISOString(),
          timeZone: deviceTimeZone(),
          clientMutationId: key,
        });
      }}
    >
      <Field label={t`Dose taken`} htmlFor={`${id}-dose`}>
        <Input id={`${id}-dose`} value={dose} onChange={(event) => setDose(event.target.value)} />
      </Field>
      <Field label={t`Time taken`} htmlFor={`${id}-when`}>
        <Input
          id={`${id}-when`}
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
      </Field>
      {correct.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not save. Try again.</Trans>
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" disabled={!dose.trim() || !when || correct.isPending}>
          {correct.isPending ? t`Saving…` : t`Save correction`}
        </Button>
      </div>
    </form>
  );
}
