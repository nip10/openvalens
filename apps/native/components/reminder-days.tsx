import { useLingui } from "@lingui/react/macro";
import {
  ISO_WEEKDAYS,
  REMINDER_DAYS_COPY,
  reminderCadence,
  weekdayLabel,
} from "@openvalens/api/presenters/supplements";
import { Button } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Reminder days for weekly and training-day supplements and medications,
 * parity with the web `reminder-days.tsx`. Reminders go out only on the
 * chosen ISO weekdays; with none chosen the item gets no reminders, and the
 * row says so.
 */
export function WeekdayPicker({
  value,
  onChange,
  disabled,
}: {
  value: ReadonlyArray<number>;
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const { i18n } = useLingui();
  return (
    <View
      className="flex-row flex-wrap gap-2"
      accessibilityLabel={i18n._(REMINDER_DAYS_COPY.label)}
    >
      {ISO_WEEKDAYS.map((day) => {
        const selected = value.includes(day);
        return (
          <Pressable
            key={day}
            disabled={disabled}
            onPress={() =>
              onChange(
                selected
                  ? value.filter((other) => other !== day)
                  : [...value, day].sort((a, b) => a - b),
              )
            }
            accessibilityRole="button"
            accessibilityLabel={weekdayLabel(day, i18n.locale, "long")}
            accessibilityState={{ selected, disabled }}
            className={`min-h-11 min-w-11 items-center justify-center rounded-full border px-3 active:opacity-70 ${
              selected ? "border-signal bg-sidebar-accent" : "border-rule bg-paper"
            }`}
          >
            <Text
              className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}
            >
              {weekdayLabel(day, i18n.locale)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The picker with its label and the training-day note, for the add forms. */
export function ReminderDaysField({
  frequency,
  value,
  onChange,
}: {
  frequency: string;
  value: ReadonlyArray<number>;
  onChange: (next: number[]) => void;
}) {
  const { i18n } = useLingui();
  return (
    <View className="gap-2">
      <Text className="font-sans text-sm font-medium text-ink-2">
        {i18n._(REMINDER_DAYS_COPY.label)}
      </Text>
      <WeekdayPicker value={value} onChange={onChange} />
      <Text className="font-sans text-sm text-ink-3">
        {i18n._(
          frequency === "training_days"
            ? REMINDER_DAYS_COPY.trainingNote
            : REMINDER_DAYS_COPY.needed,
        )}
      </Text>
    </View>
  );
}

/**
 * The cadence line of a listed item ("Weekly · Mon, Thu"), with a warning
 * when reminders wait on days, and an inline editor for those days.
 */
export function ReminderDaysRow({
  item,
  pending,
  onSave,
}: {
  item: { frequency: string | null; daysOfWeek: number[] | null };
  pending: boolean;
  onSave: (days: number[]) => void;
}) {
  const { i18n } = useLingui();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number[]>(item.daysOfWeek ?? []);
  const cadence = reminderCadence(item, i18n.locale);
  return (
    <View className="gap-2 pt-1">
      <Text className="font-sans text-sm text-ink-3">
        {i18n._(cadence.frequency)}
        {cadence.days ? ` · ${cadence.days}` : ""}
      </Text>
      {cadence.needsDays ? (
        <Text className="font-sans text-sm text-warning">{i18n._(REMINDER_DAYS_COPY.needed)}</Text>
      ) : null}
      {editing ? (
        <View className="gap-2">
          <WeekdayPicker value={draft} onChange={setDraft} disabled={pending} />
          <View className="flex-row gap-2">
            <Button
              size="sm"
              isDisabled={pending}
              onPress={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              <Button.Label>{i18n._(REMINDER_DAYS_COPY.save)}</Button.Label>
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setEditing(false)}>
              <Button.Label>{i18n._(REMINDER_DAYS_COPY.cancel)}</Button.Label>
            </Button>
          </View>
        </View>
      ) : (
        <View className="flex-row">
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              setDraft(item.daysOfWeek ?? []);
              setEditing(true);
            }}
          >
            <Button.Label>{i18n._(REMINDER_DAYS_COPY.edit)}</Button.Label>
          </Button>
        </View>
      )}
    </View>
  );
}
