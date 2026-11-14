import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  logKindPermissionCheck,
  type LogKind,
  type LogKindField,
} from "@openvalens/api/presenters/log-kinds";
import {
  MANUAL_SLEEP_ERROR_MESSAGES,
  SLEEP_QUALITY_LABELS,
  SLEEP_QUALITY_VALUES,
} from "@openvalens/api/presenters/manual-sleep";
import { deviceTimeZone, newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  isAccessReadOnlySyncError,
  isAuthSyncError,
  isPermanentSyncError,
} from "@openvalens/api/presenters/offline";
import {
  FIRST_LOG_CARD_COPY,
  FIRST_LOG_WATER_NOTE,
  firstLogKinds,
  turnsOnWater,
  type FirstLogKindId,
} from "@openvalens/api/presenters/onboarding";
import { WATER_UNIT_LABELS, type WaterUnit } from "@openvalens/api/presenters/plain-water";
import {
  buildQuickLogWrite,
  quickFormDefaults,
  unitKey,
  type QuickFormValues,
  type QuickLogWrite,
} from "@openvalens/api/presenters/quick-log";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn, useToast } from "heroui-native";
import { BedDouble, Droplet, Scale, type LucideIcon } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Sheet, ToneIcon, type Tone } from "@/components/bloom";
import { DecimalHint } from "@/components/decimal-hint";
import { enqueueMetricSample } from "@/lib/offline/sync";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

import type { OnboardingProfileFlow, StepNav } from "./flow";
import { StepFrame } from "./flow";

const CARD_ICON: Record<FirstLogKindId, { icon: LucideIcon; tone: Tone }> = {
  weight: { icon: Scale, tone: "weight" },
  water: { icon: Droplet, tone: "water" },
  sleep: { icon: BedDouble, tone: "sleep" },
};

const COPY = {
  saved: msg`Saved: {what}`,
  savedOffline: msg`Saved on this device: {what}. It syncs when you are back online.`,
  waterOn: msg`Water logging is on.`,
  waterFailed: msg`Could not turn on water logging. Try again.`,
};

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink";

const unitLabel = (code: string) =>
  code in WATER_UNIT_LABELS ? WATER_UNIT_LABELS[code as WaterUnit] : code;

/** A failed metric sample may wait on the phone unless it was refused or the session ended. */
const canQueue = (error: unknown) =>
  !(isPermanentSyncError(error) || isAuthSyncError(error) || isAccessReadOnlySyncError(error));

/**
 * Saves one first entry through its own procedure, as the quick log does
 * (#440). A weight that cannot reach the server waits in the offline outbox.
 */
async function saveFirstLog(write: QuickLogWrite): Promise<{ queued: boolean }> {
  switch (write.type) {
    case "metric": {
      const results = await Promise.allSettled(
        write.samples.map((sample) => client.healthRecord.ingestMetricSample(sample)),
      );
      let queued = false;
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") continue;
        if (!canQueue(result.reason)) throw result.reason;
        enqueueMetricSample(write.samples[index]!, result.reason);
        queued = true;
      }
      return { queued };
    }
    case "sleep":
      await client.sleep.logManualSession(write.input);
      return { queued: false };
    case "water":
      await client.plainWater.add(write.input);
      return { queued: false };
  }
  // Supplements are not one of the first-log cards.
  throw new Error("unsupported");
}

/** A small pill choice: a unit, or a sleep rating. */
function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      className={cn(
        "min-h-11 justify-center rounded-full border px-4 active:opacity-70",
        selected ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-paper-2",
      )}
    >
      <Text className={cn("font-sans text-sm", selected ? "font-semibold text-ink" : "text-ink-2")}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The chosen card's fields: numbers with their unit, times, and the 1–5 sleep rating. */
function FirstLogForm({
  kind,
  values,
  errors,
  showErrors,
  failed,
  onChange,
  onSubmit,
}: {
  kind: LogKind<FirstLogKindId>;
  values: QuickFormValues;
  errors: readonly string[];
  showErrors: boolean;
  failed: boolean;
  onChange: (id: string, value: string) => void;
  onSubmit: () => void;
}) {
  const { t, i18n } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
  const invalid = (field: string) => showErrors && errors.includes(field);
  const firstNumber = kind.fields.find((field) => field.type === "number")?.id;

  const fieldLabel = (field: LogKindField, text: string) => (
    <Text className="font-sans text-sm font-medium text-ink-2">
      {text}
      {!field.required && field.type !== "datetime" ? (
        <Text className="font-normal text-ink-3">{` (${t`optional`})`}</Text>
      ) : null}
    </Text>
  );

  const renderField = (field: LogKindField) => {
    const label = i18n._(field.label);
    const testID = `first-log-${kind.id}-${field.id}`;
    if (field.type === "number") {
      const units = field.acceptedUnits ?? (field.unit ? [field.unit.code] : []);
      const symbol = field.unit ? i18n._(field.unit.symbol) : null;
      const chosenUnit = values[unitKey(field.id)] ?? field.unit?.code;
      return (
        <View key={field.id} className="gap-2">
          {fieldLabel(field, label)}
          <View className="flex-row items-center gap-3">
            <TextInput
              testID={testID}
              accessibilityLabel={symbol && units.length <= 1 ? `${label} (${symbol})` : label}
              value={values[field.id] ?? ""}
              onChangeText={(text) => onChange(field.id, text)}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={onSubmit}
              autoFocus={field.id === firstNumber}
              placeholderTextColor={placeholderColor}
              className={cn(
                INPUT_CLASS,
                "min-w-0 flex-1",
                invalid(field.id) && "border-destructive",
              )}
              style={{ fontVariant: ["tabular-nums"] }}
            />
            {units.length <= 1 && symbol ? (
              <Text className="font-sans text-base text-ink-3">{symbol}</Text>
            ) : null}
          </View>
          <DecimalHint value={values[field.id]} />
          {units.length > 1 && field.unit ? (
            <View
              className="flex-row flex-wrap gap-2"
              accessibilityRole="radiogroup"
              accessibilityLabel={t`Unit for ${label}`}
            >
              {units.map((code) => (
                <Pill
                  key={code}
                  label={unitLabel(code)}
                  selected={chosenUnit === code}
                  onPress={() => onChange(unitKey(field.id), code)}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    }
    if (field.type === "rating") {
      return (
        <View key={field.id} className="gap-2">
          {fieldLabel(field, label)}
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {SLEEP_QUALITY_VALUES.map((value) => {
              const selected = values[field.id] === String(value);
              return (
                <Pill
                  key={value}
                  label={`${value} · ${i18n._(SLEEP_QUALITY_LABELS[value]!)}`}
                  selected={selected}
                  onPress={() => onChange(field.id, selected ? "" : String(value))}
                />
              );
            })}
          </View>
        </View>
      );
    }
    // `datetime` (the first-log kinds have no `choice` field).
    return (
      <View key={field.id} className="gap-2">
        {fieldLabel(field, label)}
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={values[field.id] ?? ""}
          onChangeText={(text) => onChange(field.id, text)}
          placeholder="YYYY-MM-DDTHH:MM"
          placeholderTextColor={placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          className={cn(INPUT_CLASS, invalid(field.id) && "border-destructive")}
        />
      </View>
    );
  };

  const errorText = !showErrors
    ? null
    : errors.includes("order")
      ? i18n._(MANUAL_SLEEP_ERROR_MESSAGES.order)
      : errors.length > 0
        ? t`Check the highlighted values.`
        : null;

  return (
    <Sheet className="gap-5 p-4">
      <View className="flex-row items-center gap-3">
        <ToneIcon icon={CARD_ICON[kind.id].icon} tone={CARD_ICON[kind.id].tone} size="sm" />
        <Text className="font-display text-lg font-semibold text-ink">{i18n._(kind.label)}</Text>
      </View>
      {kind.fields.map(renderField)}
      {errorText ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {errorText}
        </Text>
      ) : null}
      {failed ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not save. Try again.`}
        </Text>
      ) : null}
    </Sheet>
  );
}

/**
 * Screen 2 (and the "Log your first entry" item): Weight, Water or Last
 * night's sleep as three large cards, then that kind's quick-log fields and
 * save path (#440). Choosing Water first turns plain water on.
 */
export function FirstLogStep({
  flow,
  nav,
}: {
  flow: OnboardingProfileFlow & {
    snapshot: NonNullable<OnboardingProfileFlow["snapshot"]>;
  };
  nav: StepNav;
}) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const me = useQuery(orpc.sharing.me.queryOptions({ input: {} }));
  const water = useQuery(orpc.plainWater.getPreferences.queryOptions({ input: {} }));
  const products = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const weightUnit = products.data?.units === "imperial" ? "lb" : "kg";
  const kinds = firstLogKinds({
    enabledModules: flow.snapshot.enabledModules,
    can: logKindPermissionCheck(me.data?.role),
  });

  const [kind, setKind] = useState<LogKind<FirstLogKindId> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [mutationId, setMutationId] = useState(newClientMutationId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);

  const turnOnWater = useMutation(
    orpc.plainWater.updatePreferences.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() }),
    }),
  );

  const open = async (next: LogKind<FirstLogKindId>) => {
    setError(null);
    if (turnsOnWater(next.id, water.data?.enabled)) {
      try {
        await turnOnWater.mutateAsync({ enabled: true });
        toast.show({ variant: "success", label: i18n._(COPY.waterOn) });
      } catch {
        setError(COPY.waterFailed);
        return;
      }
    }
    setValues(quickFormDefaults(next, new Date(), { weightUnit }));
    setShowErrors(false);
    setFailed(false);
    setMutationId(newClientMutationId());
    setKind(next);
  };

  const parsed = kind
    ? buildQuickLogWrite(kind, values, {
        timeZone,
        locale: i18n.locale,
        // One id per open form, so a retried save cannot log twice.
        newId: () => mutationId,
      })
    : null;

  const submit = async () => {
    if (!kind || !parsed || saving) return;
    if (!parsed.ok) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const result = await saveFirstLog(parsed.write);
      for (const key of [
        orpc.quickLog.key(),
        orpc.healthRecord.key(),
        orpc.body.key(),
        orpc.sleep.key(),
        orpc.plainWater.key(),
      ])
        void queryClient.invalidateQueries({ queryKey: key });
      const what = i18n._(kind.label);
      toast.show({
        variant: "success",
        label: i18n._({ ...(result.queued ? COPY.savedOffline : COPY.saved), values: { what } }),
      });
      nav.onDone();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepFrame
      step={nav.step}
      title={<Trans>Log your first entry</Trans>}
      description={
        <Trans>Pick one to try it. It takes a few seconds, and you can change it later.</Trans>
      }
      // Until a card is chosen there is nothing to save: Skip (first run) or Back.
      continueLabel={t`Save`}
      onContinue={kind ? () => void submit() : undefined}
      busy={saving}
      error={error}
      onSkip={kind ? undefined : nav.onSkip}
      onBack={kind ? () => setKind(null) : nav.onBack}
    >
      {kind && parsed ? (
        <FirstLogForm
          kind={kind}
          values={values}
          errors={parsed.ok ? [] : parsed.errors}
          showErrors={showErrors}
          failed={failed}
          onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
          onSubmit={() => void submit()}
        />
      ) : me.isPending ? (
        <Sheet className="h-36" />
      ) : kinds.length === 0 ? (
        <Sheet>
          <Text className="font-sans text-sm leading-relaxed text-ink-2">
            <Trans>
              Your role in this workspace can't add entries. You can still look around and connect
              your data.
            </Trans>
          </Text>
        </Sheet>
      ) : (
        <View className="gap-3" accessibilityLabel={t`What to log`}>
          {kinds.map((card) => (
            <Pressable
              key={card.id}
              onPress={() => void open(card)}
              disabled={turnOnWater.isPending}
              accessibilityRole="button"
              testID={`first-log-${card.id}`}
              className="active:opacity-80"
            >
              <Sheet className="min-h-24 flex-row items-center gap-4 p-5">
                <ToneIcon icon={CARD_ICON[card.id].icon} tone={CARD_ICON[card.id].tone} />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-display text-lg font-semibold text-ink">
                    {i18n._(FIRST_LOG_CARD_COPY[card.id])}
                  </Text>
                  {turnsOnWater(card.id, water.data?.enabled ?? null) ? (
                    <Text className="font-sans text-sm text-ink-3">
                      {i18n._(FIRST_LOG_WATER_NOTE)}
                    </Text>
                  ) : null}
                </View>
              </Sheet>
            </Pressable>
          ))}
        </View>
      )}
    </StepFrame>
  );
}
