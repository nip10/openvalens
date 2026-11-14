import { useLingui } from "@lingui/react/macro";
import type { LogKind, LogKindField } from "@openvalens/api/presenters/log-kinds";
import {
  MANUAL_SLEEP_ERROR_MESSAGES,
  SLEEP_QUALITY_LABELS,
  SLEEP_QUALITY_VALUES,
} from "@openvalens/api/presenters/manual-sleep";
import { WATER_UNIT_LABELS, type WaterUnit } from "@openvalens/api/presenters/plain-water";
import { unitKey, type QuickFormValues } from "@openvalens/api/presenters/quick-log";
import { Button, cn } from "heroui-native";
import { Pressable, Text, TextInput, View } from "react-native";

import { DecimalHint } from "@/components/decimal-hint";
import { SelectField } from "@/components/select-field";
import { useThemeColor } from "@/utils/theme";

export type SupplementOption = { id: number; name: string; dose: string | null };

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink";

const unitLabel = (code: string) =>
  code in WATER_UNIT_LABELS ? WATER_UNIT_LABELS[code as WaterUnit] : code;

/** A small pill choice, as on the water card and the sleep form. */
function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
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

/**
 * A log kind's quick form on mobile, built from its `fields` (#440): numbers
 * with their unit (and the other units the member may type), times, a 1–5
 * rating and the member's own supplements. The twin of the web palette's form.
 * The "+" picker and the first run's first log (#444) both use it; the first
 * run hides the Save button because its screen keeps Save at the bottom.
 */
export function QuickForm({
  kind,
  values,
  errors,
  showErrors,
  supplements,
  pending,
  failed,
  onChange,
  onSubmit,
  showSave = true,
}: {
  kind: LogKind;
  values: QuickFormValues;
  errors: readonly string[];
  showErrors: boolean;
  supplements: readonly SupplementOption[] | null;
  pending: boolean;
  failed: boolean;
  onChange: (id: string, value: string) => void;
  onSubmit: () => void;
  /** Off when the screen already has its own Save button. */
  showSave?: boolean;
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
    const testID = `quick-log-${kind.id}-${field.id}`;
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
              placeholder={
                field.min !== undefined && field.max !== undefined && units.length <= 1
                  ? `${field.min}–${field.max}`
                  : undefined
              }
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
                <Chip
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
    if (field.type === "datetime")
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
    if (field.type === "rating")
      return (
        <View key={field.id} className="gap-2">
          {fieldLabel(field, label)}
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {SLEEP_QUALITY_VALUES.map((value) => {
              const selected = values[field.id] === String(value);
              const text = `${value} · ${i18n._(SLEEP_QUALITY_LABELS[value]!)}`;
              return (
                <Chip
                  key={value}
                  label={text}
                  selected={selected}
                  onPress={() => onChange(field.id, selected ? "" : String(value))}
                />
              );
            })}
          </View>
        </View>
      );
    // `choice`: the quick form offers the member's own supplements.
    return (
      <View key={field.id} className="gap-2">
        {fieldLabel(field, label)}
        {supplements === null ? (
          <Text className="font-sans text-sm text-ink-3">{t`Loading your supplements…`}</Text>
        ) : supplements.length === 0 ? (
          <Text className="font-sans text-sm text-ink-3">
            {t`No supplements yet. Add one on Supplements.`}
          </Text>
        ) : (
          <SelectField
            testID={testID}
            accessibilityLabel={label}
            placeholder={t`Choose a supplement`}
            value={values[field.id] || undefined}
            onChange={(next) => onChange(field.id, next)}
            options={supplements.map((option) => ({
              value: String(option.id),
              label: option.dose ? `${option.name} · ${option.dose}` : option.name,
            }))}
          />
        )}
      </View>
    );
  };

  const errorText = !showErrors
    ? null
    : errors.includes("order")
      ? kind.id === "sleep"
        ? i18n._(MANUAL_SLEEP_ERROR_MESSAGES.order)
        : t`Systolic must be higher than diastolic.`
      : errors.length > 0
        ? t`Check the highlighted values.`
        : null;

  return (
    <View className="gap-5">
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
      {showSave ? (
        <Button testID="quick-log-save" onPress={onSubmit} isDisabled={pending}>
          <Button.Label>{pending ? t`Saving…` : t`Save`}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
