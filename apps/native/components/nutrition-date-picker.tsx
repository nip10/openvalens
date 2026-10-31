import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { useState } from "react";
import { Modal, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Sheet } from "@/components/bloom";

export type LocalCalendarDate = `${number}-${number}-${number}`;

/** Parse a calendar date at local midday, avoiding UTC conversion and DST edges. */
export function localDatePickerValue(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError("Expected a local calendar date in YYYY-MM-DD form");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    throw new RangeError("Invalid local calendar date");
  return date;
}

/** Format local date parts directly; never serialize a picker Date as UTC. */
export function localDatePickerISO(date: Date): LocalCalendarDate {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` as LocalCalendarDate;
}

export type NutritionDatePickerProps = {
  value: string;
  onChange: (localDate: LocalCalendarDate) => void;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  locale?: string;
};

/** Controlled native date selector for local diary calendar dates. */
export function NutritionDatePicker({
  value,
  onChange,
  label,
  accessibilityLabel,
  disabled = false,
  compact = false,
  locale,
}: NutritionDatePickerProps) {
  const { t, i18n } = useLingui();
  const insets = useSafeAreaInsets();
  const selected = localDatePickerValue(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  // The app's language, not the phone's, so the date reads like the rest of the screen.
  const displayValue = new Intl.DateTimeFormat(locale ?? i18n.locale, {
    dateStyle: compact ? "medium" : "full",
  }).format(selected);

  const show = () => {
    if (disabled) return;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: selected,
        mode: "date",
        display: "calendar",
        onValueChange: (_event, date) => onChange(localDatePickerISO(date)),
        onDismiss: () => undefined,
      });
    } else {
      setDraft(selected);
      setOpen(true);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="min-h-11"
        isDisabled={disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={show}
      >
        <Button.Label>{compact ? displayValue : `${label}: ${displayValue}`}</Button.Label>
      </Button>
      {Platform.OS !== "android" ? (
        <Modal
          visible={open}
          transparent
          animationType="slide"
          onRequestClose={() => setOpen(false)}
          presentationStyle="overFullScreen"
        >
          <View className="flex-1 justify-end bg-black/40">
            <Sheet
              className="gap-3 rounded-b-none px-4 pt-4"
              style={{ paddingBottom: Math.max(insets.bottom, 16) }}
              accessibilityLabel={accessibilityLabel ?? label}
            >
              <Text className="font-display text-lg font-semibold text-ink">{label}</Text>
              <DateTimePicker
                value={draft}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onValueChange={(_event, date) => setDraft(date)}
                locale={locale ?? i18n.locale}
              />
              <Button
                className="min-h-11 self-end"
                onPress={() => {
                  onChange(localDatePickerISO(draft));
                  setOpen(false);
                }}
              >
                <Button.Label>{t`Done`}</Button.Label>
              </Button>
            </Sheet>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
