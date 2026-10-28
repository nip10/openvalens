import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

function dateFromIso(value: string | null): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year!, month! - 1, day!, 12);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
}

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DateField({
  label,
  value,
  onChange,
  nullable = false,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  nullable?: boolean;
}) {
  const { i18n, t } = useLingui();
  const [open, setOpen] = useState(false);
  const selectedDate = dateFromIso(value);
  const formatted = value
    ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: "long" }).format(selectedDate)
    : t`Choose a date`;

  const onPickerChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setOpen(false);
    if (event.type === "set" && date) onChange(localIso(date));
  };

  return (
    <View className="gap-2">
      <Text nativeID="date-field-label" className="font-sans text-sm font-medium text-ink-3">
        {label}
      </Text>
      {Platform.OS === "web" ? (
        <input
          aria-label={label}
          type="date"
          value={value ?? ""}
          onChange={(event) => onChange(event.currentTarget.value || null)}
          style={{
            minHeight: 44,
            borderRadius: 12,
            border: "1px solid var(--color-rule-2)",
            padding: "0 12px",
            background: "var(--color-paper-2)",
            color: "var(--color-ink)",
            font: "inherit",
          }}
        />
      ) : (
        <>
          <View className="flex-row items-center gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${formatted}`}
              accessibilityHint={t`Opens the date picker`}
              onPress={() => setOpen(true)}
              className="min-h-11 flex-1 justify-center rounded-xl border border-rule-2 bg-paper-2 px-3"
            >
              <Text className="font-sans text-base text-ink">{formatted}</Text>
            </Pressable>
            {nullable && value ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`Clear date`}
                onPress={() => onChange(null)}
                className="min-h-11 justify-center px-2"
              >
                <Text className="font-sans text-sm font-semibold text-signal">
                  <Trans>Clear</Trans>
                </Text>
              </Pressable>
            ) : null}
          </View>
          {open && Platform.OS === "ios" ? (
            <View className="overflow-hidden rounded-xl border border-rule-2 bg-sheet">
              <DateTimePicker
                value={selectedDate}
                mode="date"
                display="inline"
                onChange={onPickerChange}
                accessibilityLabel={label}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
                className="min-h-11 items-center justify-center border-t border-rule"
              >
                <Text className="font-sans font-semibold text-signal">
                  <Trans>Done</Trans>
                </Text>
              </Pressable>
            </View>
          ) : null}
          {open && Platform.OS === "android" ? (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="default"
              onChange={onPickerChange}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
