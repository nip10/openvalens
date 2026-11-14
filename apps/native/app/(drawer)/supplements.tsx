import { plural } from "@lingui/core/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import { Pill, Plus, Tablets } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { DecimalHint } from "@/components/decimal-hint";
import { ReminderDaysField, ReminderDaysRow } from "@/components/reminder-days";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { parseDecimal } from "@openvalens/i18n/numbers";

const UNITS = ["mg", "mcg", "IU", "g", "ml"] as const;

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-paper-2 px-3 font-sans text-base text-ink";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="font-sans text-sm font-medium text-ink-3">{label}</Text>
      {children}
    </View>
  );
}

function Pills({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  labelFor: (option: string) => string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            className={`min-h-9 justify-center rounded-full border px-3.5 py-1.5 active:opacity-70 ${
              selected ? "border-primary bg-primary/15" : "border-rule-2 bg-sheet"
            }`}
          >
            <Text
              className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}
            >
              {labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
      <Text className="font-sans text-sm text-destructive">
        <Trans>Could not save.</Trans>
      </Text>
    );
  if (pending)
    return (
      <Text className="font-sans text-sm text-ink-3">
        <Trans>Saving…</Trans>
      </Text>
    );
  if (isSuccess)
    return (
      <Text className="font-sans text-sm text-success">
        <Trans>Saved</Trans>
      </Text>
    );
  return null;
}

function AddSupplementForm({ onSaved }: { onSaved: () => void }) {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const placeholder = useThemeColor("ink-3");
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);
  const [days, setDays] = useState<number[]>([]);
  const needsDays = frequencyNeedsDays(frequency);

  const addSupplement = useMutation(orpc.plans.upsertSupplement.mutationOptions());
  const addSchedule = useMutation(orpc.plans.upsertSchedule.mutationOptions());

  const numeric = parseDecimal(dose, i18n.locale) ?? Number.NaN;
  const valid = name.trim().length > 0 && Number.isFinite(numeric);
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
    <Section sheet icon={Plus} tone="food" title={t`Add supplement`}>
      <Field label={t`Name`}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Vitamin D"
          className={INPUT_CLASS}
          placeholderTextColor={placeholder}
        />
      </Field>
      <Field label={t({ message: "Dose", comment: "safety" })}>
        <TextInput
          value={dose}
          onChangeText={setDose}
          placeholder="500"
          keyboardType="numeric"
          className={INPUT_CLASS}
          placeholderTextColor={placeholder}
        />
        <DecimalHint value={dose} />
      </Field>
      <Field label={t({ message: "Unit", comment: "safety" })}>
        <Pills options={UNITS} value={unit} onChange={setUnit} labelFor={(option) => option} />
      </Field>
      <Field label={t({ message: "Frequency", comment: "safety" })}>
        <Pills
          options={SUPPLEMENT_FREQUENCIES}
          value={frequency}
          onChange={setFrequency}
          labelFor={(option) => _(supplementFrequencyLabel(option))}
        />
      </Field>
      {needsDays ? (
        <ReminderDaysField frequency={frequency} value={days} onChange={setDays} />
      ) : null}
      <View className="flex-row items-center gap-3 pt-1">
        <Button onPress={() => void submit()} isDisabled={!valid || pending}>
          {pending ? t`Saving…` : t`Save`}
        </Button>
        <SaveStatus
          pending={pending}
          isError={addSupplement.isError || addSchedule.isError}
          isSuccess={addSupplement.isSuccess && addSchedule.isSuccess}
        />
      </View>
    </Section>
  );
}

function AddMedicationForm({ onSaved }: { onSaved: () => void }) {
  const { t, i18n } = useLingui();
  const { _ } = useLinguiRuntime();
  const placeholder = useThemeColor("ink-3");
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [frequency, setFrequency] = useState<string>(SUPPLEMENT_FREQUENCIES[0]);
  const [days, setDays] = useState<number[]>([]);
  const needsDays = frequencyNeedsDays(frequency);

  const addMedication = useMutation(orpc.plans.upsertMedication.mutationOptions());

  const numeric = parseDecimal(dose, i18n.locale) ?? Number.NaN;
  const valid = name.trim().length > 0 && Number.isFinite(numeric);

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
    <Section sheet icon={Plus} tone="heart" title={t`Add medication`}>
      <Field label={t`Name`}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Metformin"
          className={INPUT_CLASS}
          placeholderTextColor={placeholder}
        />
      </Field>
      <Field label={t({ message: "Dose", comment: "safety" })}>
        <TextInput
          value={dose}
          onChangeText={setDose}
          placeholder="500"
          keyboardType="numeric"
          className={INPUT_CLASS}
          placeholderTextColor={placeholder}
        />
        <DecimalHint value={dose} />
      </Field>
      <Field label={t({ message: "Unit", comment: "safety" })}>
        <Pills options={UNITS} value={unit} onChange={setUnit} labelFor={(option) => option} />
      </Field>
      <Field label={t({ message: "Frequency", comment: "safety" })}>
        <Pills
          options={SUPPLEMENT_FREQUENCIES}
          value={frequency}
          onChange={setFrequency}
          labelFor={(option) => _(supplementFrequencyLabel(option))}
        />
      </Field>
      {needsDays ? (
        <ReminderDaysField frequency={frequency} value={days} onChange={setDays} />
      ) : null}
      <View className="flex-row items-center gap-3 pt-1">
        <Button variant="outline" onPress={submit} isDisabled={!valid || addMedication.isPending}>
          {addMedication.isPending ? t`Saving…` : t`Save`}
        </Button>
        <SaveStatus
          pending={addMedication.isPending}
          isError={addMedication.isError}
          isSuccess={addMedication.isSuccess}
        />
      </View>
    </Section>
  );
}

export default function SupplementsScreen() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const foreground = useThemeColor("foreground");
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

  const header = <PageHeader title={t`Supplements`} />;

  if (supplements.isPending || medications.isPending)
    return (
      <Container>
        <Page>
          <ModuleHiddenNote module="supplements" />
          {header}
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );

  if (supplements.isError || medications.isError || !supplements.data || !medications.data)
    return (
      <Container>
        <Page>
          <ModuleHiddenNote module="supplements" />
          {header}
          <ErrorState
            title={<Trans>Could not load supplements.</Trans>}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  void supplements.refetch();
                  void medications.refetch();
                }}
              >
                {t`Retry`}
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const supplementList = supplements.data;
  const medicationList = medications.data;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={supplements.isRefetching || medications.isRefetching}
            onRefresh={() => {
              void supplements.refetch();
              void medications.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <ModuleHiddenNote module="supplements" />
        {header}

        <View className="gap-3" accessibilityLabel={t`Supplements`}>
          {supplementList.length === 0 ? (
            <EmptyState
              icon={Pill}
              tone="food"
              title={<Trans>No supplements logged. Add one to get reminders.</Trans>}
            />
          ) : (
            supplementList.map((supplement) => {
              const scheduled =
                supplement.activeScheduleCount > 0
                  ? t`${plural(supplement.activeScheduleCount, { one: "# scheduled", other: "# scheduled" })}`
                  : "";
              const subtitle = [supplement.category, scheduled].filter(Boolean).join(", ");
              return (
                <ListCard
                  key={supplement.id}
                  icon={Pill}
                  tone="food"
                  title={supplement.name}
                  subtitle={subtitle || undefined}
                  chip={supplementDoseLabel(supplement.dose, null)}
                >
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
                </ListCard>
              );
            })
          )}
        </View>

        <AddSupplementForm onSaved={() => void supplements.refetch()} />
        <ActualIntake
          supplements={supplementList.map((item) => ({ ...item, dose: item.dose ?? "" }))}
        />

        <Section icon={Tablets} tone="heart" title={t`Medications`}>
          {medicationList.length === 0 ? (
            <EmptyState
              icon={Tablets}
              tone="heart"
              title={<Trans>No medications logged. Add one to track your protocol.</Trans>}
            />
          ) : (
            <View className="gap-3" accessibilityLabel={t`Medications`}>
              {medicationList.map((medication) => (
                <ListCard
                  key={medication.id}
                  icon={Tablets}
                  tone="heart"
                  title={medication.name}
                  chip={medicationDoseLabel(medication.dose, null)}
                  status={{
                    label: _(medicationStatusLabel(medication.status)),
                    tone: medication.status === "active" ? "good" : "neutral",
                  }}
                  subtitle={
                    medication.frequency && !frequencyNeedsDays(medication.frequency)
                      ? _(supplementFrequencyLabel(medication.frequency))
                      : undefined
                  }
                >
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
                </ListCard>
              ))}
            </View>
          )}
        </Section>

        <AddMedicationForm onSaved={() => void medications.refetch()} />
      </Page>
    </Container>
  );
}

function ActualIntake({
  supplements,
}: {
  supplements: Array<{ id: number; name: string; dose: string }>;
}) {
  const { t } = useLingui();
  const client = useQueryClient();
  const rows = useQuery(orpc.supplementIntake.list.queryOptions({ input: {} }));
  const [selected, setSelected] = useState(supplements[0]?.id ?? 0);
  const [dose, setDose] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString());
  const [editing, setEditing] = useState<number | null>(null);
  const [correctedDose, setCorrectedDose] = useState("");
  const [correctedAt, setCorrectedAt] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [updateKeys, setUpdateKeys] = useState<Record<number, string>>({});
  const [deleteKeys, setDeleteKeys] = useState<Record<number, string>>({});
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: orpc.supplementIntake.key() });
    await client.invalidateQueries({ queryKey: orpc.goals.key() });
  };
  const add = useMutation(
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
      title={t`Log actual intake`}
      description={t`Reminders are not proof. Log doses you took; goal credit is once per day, while each real dose stays recorded.`}
    >
      {supplements.length ? (
        <View className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            {supplements.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === s.id }}
                onPress={() => {
                  setSelected(s.id);
                  if (add.isError) setCreateKey("");
                }}
                className={`rounded-xl border px-3 py-2 ${selected === s.id ? "border-signal bg-food-soft" : "border-border"}`}
              >
                <Text className="text-ink">{s.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel={t`Dose actually taken`}
            value={dose}
            onChangeText={(value) => {
              setDose(value);
              if (add.isError) setCreateKey("");
            }}
            placeholder={supplements.find((s) => s.id === selected)?.dose ?? t`Dose taken`}
            className="rounded-xl border border-border p-3 text-ink"
          />
          <TextInput
            accessibilityLabel={t`Date and time taken`}
            value={occurredAt}
            onChangeText={(value) => {
              setOccurredAt(value);
              if (add.isError) setCreateKey("");
            }}
            placeholder="2026-11-02T09:00:00.000Z"
            className="rounded-xl border border-border p-3 text-ink"
          />
          <Button
            isDisabled={!selected || add.isPending}
            onPress={() => {
              const key = createKey || globalThis.crypto.randomUUID();
              setCreateKey(key);
              add.mutate({
                supplementId: selected,
                occurredAt,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                dose: dose.trim() || supplements.find((s) => s.id === selected)?.dose || "Dose",
                clientMutationId: key,
              });
            }}
          >
            <Button.Label>{add.isPending ? t`Saving…` : t`Log dose`}</Button.Label>
          </Button>
        </View>
      ) : (
        <Text className="text-sm text-ink-3">{t`Add a supplement first to log an actual dose.`}</Text>
      )}
      {add.isError ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {add.error.message ?? t`Could not save intake. Retry the same dose.`}
        </Text>
      ) : null}
      {rows.isError ? (
        <Text
          accessibilityRole="alert"
          className="text-sm text-destructive"
        >{t`Could not load intake history.`}</Text>
      ) : null}
      {rows.data?.map((row: SupplementIntake) => (
        <View key={row.id} className="mt-2 rounded-xl bg-paper-2 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-sm text-ink">
              {supplements.find((s) => s.id === row.supplementId)?.name ?? t`Supplement`} ·{" "}
              {row.dose} · {new Date(row.occurredAt).toLocaleString()}
            </Text>
            <View className="flex-row gap-1">
              <Button
                size="sm"
                variant="outline"
                onPress={() => {
                  setEditing(row.id);
                  setCorrectedDose(row.dose);
                  setCorrectedAt(row.occurredAt);
                }}
              >
                <Button.Label>{t`Correct`}</Button.Label>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPress={() =>
                  Alert.alert(t`Undo this intake?`, t`This removes only the intake record.`, [
                    { text: t`Cancel`, style: "cancel" },
                    {
                      text: t`Undo`,
                      style: "destructive",
                      onPress: () => {
                        const key = deleteKeys[row.id] || globalThis.crypto.randomUUID();
                        setDeleteKeys((current) => ({ ...current, [row.id]: key }));
                        remove.mutate({ id: row.id, version: row.version, clientMutationId: key });
                      },
                    },
                  ])
                }
              >
                <Button.Label>{t`Undo`}</Button.Label>
              </Button>
            </View>
          </View>
          {editing === row.id ? (
            <View className="mt-2 gap-2">
              <TextInput
                accessibilityLabel={t`Corrected dose`}
                value={correctedDose}
                onChangeText={setCorrectedDose}
                className="rounded-xl border border-border p-3 text-ink"
              />
              <TextInput
                accessibilityLabel={t`Corrected date and time`}
                value={correctedAt}
                onChangeText={setCorrectedAt}
                className="rounded-xl border border-border p-3 text-ink"
              />
              <Button
                isDisabled={correct.isPending}
                onPress={() => {
                  const key = updateKeys[row.id] || globalThis.crypto.randomUUID();
                  setUpdateKeys((current) => ({ ...current, [row.id]: key }));
                  correct.mutate({
                    id: row.id,
                    version: row.version,
                    dose: correctedDose,
                    occurredAt: correctedAt,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                    clientMutationId: key,
                  });
                }}
              >
                <Button.Label>{correct.isPending ? t`Saving…` : t`Save correction`}</Button.Label>
              </Button>
            </View>
          ) : null}
        </View>
      ))}
    </Section>
  );
}
