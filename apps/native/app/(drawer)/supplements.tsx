import { plural } from "@lingui/core/macro";
import { useLingui as useLinguiRuntime } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  medicationDoseLabel,
  medicationStatusLabel,
  SUPPLEMENT_FREQUENCIES,
  supplementDoseLabel,
  supplementFrequencyLabel,
} from "@openvalens/api/presenters/supplements";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, Chip, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const UNITS = ["mg", "mcg", "IU", "g", "ml"] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
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
            className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
              selected ? "border-primary bg-primary/15" : "border-border bg-card"
            }`}
          >
            <Text
              className={`text-sm ${
                selected ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
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
      <Text className="text-sm text-destructive">
        <Trans>Could not save.</Trans>
      </Text>
    );
  if (pending)
    return (
      <Text className="text-sm text-muted-foreground">
        <Trans>Saving…</Trans>
      </Text>
    );
  if (isSuccess)
    return (
      <Text className="text-sm text-success">
        <Trans>Saved</Trans>
      </Text>
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
    <CardStack title={t`Add supplement`}>
      <Card variant="secondary" className="gap-3 p-4">
        <Field label={t`Name`}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Vitamin D"
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
            placeholderTextColor="#9ca3af"
          />
        </Field>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label={t({ message: "Dose", comment: "safety" })}>
              <TextInput
                value={dose}
                onChangeText={setDose}
                placeholder="500"
                keyboardType="numeric"
                className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
                placeholderTextColor="#9ca3af"
              />
            </Field>
          </View>
        </View>
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
        <View className="flex-row items-center gap-3">
          <Button onPress={() => void submit()} isDisabled={!valid || pending}>
            {pending ? t`Saving…` : t`Save`}
          </Button>
          <SaveStatus
            pending={pending}
            isError={addSupplement.isError || addSchedule.isError}
            isSuccess={addSupplement.isSuccess && addSchedule.isSuccess}
          />
        </View>
      </Card>
    </CardStack>
  );
}

function AddMedicationForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
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
    <CardStack title={t`Add medication`}>
      <Card variant="secondary" className="gap-3 p-4">
        <Field label={t`Name`}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Metformin"
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
            placeholderTextColor="#9ca3af"
          />
        </Field>
        <Field label={t({ message: "Dose", comment: "safety" })}>
          <TextInput
            value={dose}
            onChangeText={setDose}
            placeholder="500"
            keyboardType="numeric"
            className="min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground"
            placeholderTextColor="#9ca3af"
          />
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
        <View className="flex-row items-center gap-3">
          <Button onPress={submit} isDisabled={!valid || addMedication.isPending}>
            {addMedication.isPending ? t`Saving…` : t`Save`}
          </Button>
          <SaveStatus
            pending={addMedication.isPending}
            isError={addMedication.isError}
            isSuccess={addMedication.isSuccess}
          />
        </View>
      </Card>
    </CardStack>
  );
}

export default function SupplementsScreen() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const foreground = useThemeColor("foreground");
  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const medications = useQuery(orpc.plans.listMedications.queryOptions({ input: {} }));

  if (supplements.isPending || medications.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (supplements.isError || medications.isError || !supplements.data || !medications.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">
          <Trans>Could not load supplements.</Trans>
        </Text>
        <Pressable
          onPress={() => {
            void supplements.refetch();
            void medications.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">
            <Trans>Retry</Trans>
          </Text>
        </Pressable>
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
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">
            <Trans>Supplements</Trans>
          </Text>
          <Text className="font-mono text-3xl text-foreground">
            <Trans>Regimen</Trans>
          </Text>
        </View>

        <AddSupplementForm onSaved={() => void supplements.refetch()} />

        {supplementList.length === 0 ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="text-center font-medium text-foreground">
              <Trans>No supplements logged. Add one to get reminders.</Trans>
            </Text>
          </Card>
        ) : (
          <CardStack>
            <Card variant="secondary" className="p-0">
              {supplementList.map((supplement, index) => (
                <View
                  key={supplement.id}
                  className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                    index < supplementList.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">{supplement.name}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {supplementDoseLabel(supplement.dose, null)}
                      {supplement.category ? ` · ${supplement.category}` : ""}
                    </Text>
                  </View>
                  {supplement.activeScheduleCount > 0 ? (
                    <Chip size="sm" color="default">
                      <Chip.Label>
                        {t`${plural(supplement.activeScheduleCount, { one: "# scheduled", other: "# scheduled" })}`}
                      </Chip.Label>
                    </Chip>
                  ) : null}
                </View>
              ))}
            </Card>
          </CardStack>
        )}

        <AddMedicationForm onSaved={() => void medications.refetch()} />

        {medicationList.length === 0 ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="text-center font-medium text-foreground">
              <Trans>No medications logged. Add one to track your protocol.</Trans>
            </Text>
          </Card>
        ) : (
          <CardStack>
            <Card variant="secondary" className="p-0">
              {medicationList.map((medication, index) => (
                <View
                  key={medication.id}
                  className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                    index < medicationList.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">{medication.name}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {medicationDoseLabel(medication.dose, null)}
                      {medication.frequency
                        ? ` · ${_(supplementFrequencyLabel(medication.frequency))}`
                        : ""}
                    </Text>
                  </View>
                  <Chip size="sm" color="default">
                    <Chip.Label>{_(medicationStatusLabel(medication.status))}</Chip.Label>
                  </Chip>
                </View>
              ))}
            </Card>
          </CardStack>
        )}
      </View>
    </Container>
  );
}
