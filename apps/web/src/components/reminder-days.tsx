import { useLingui } from "@lingui/react/macro";
import {
  ISO_WEEKDAYS,
  REMINDER_DAYS_COPY,
  reminderCadence,
  weekdayLabel,
} from "@openvalens/api/presenters/supplements";
import { Button } from "@openvalens/ui/components/button";
import { useState } from "react";

/**
 * Reminder days for weekly and training-day supplements and medications.
 * Reminders go out only on the chosen ISO weekdays; with none chosen the item
 * gets no reminders, and the row says so.
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
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={i18n._(REMINDER_DAYS_COPY.label)}
    >
      {ISO_WEEKDAYS.map((day) => {
        const selected = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            aria-label={weekdayLabel(day, i18n.locale, "long")}
            onClick={() =>
              onChange(
                selected
                  ? value.filter((other) => other !== day)
                  : [...value, day].sort((a, b) => a - b),
              )
            }
            className={`rounded-full border px-3 py-1 text-sm ${
              selected
                ? "border-primary bg-primary/15 font-medium"
                : "border-border text-muted-foreground"
            }`}
          >
            {weekdayLabel(day, i18n.locale)}
          </button>
        );
      })}
    </div>
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
  const training = frequency === "training_days";
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{i18n._(REMINDER_DAYS_COPY.label)}</span>
      <WeekdayPicker value={value} onChange={onChange} />
      <p className="text-sm text-muted-foreground">
        {i18n._(training ? REMINDER_DAYS_COPY.trainingNote : REMINDER_DAYS_COPY.needed)}
      </p>
    </div>
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
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">
          {i18n._(cadence.frequency)}
          {cadence.days ? ` · ${cadence.days}` : ""}
        </span>
        {cadence.needsDays ? (
          <span className="text-warning-foreground">{i18n._(REMINDER_DAYS_COPY.needed)}</span>
        ) : null}
        {!editing ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(item.daysOfWeek ?? []);
              setEditing(true);
            }}
          >
            {i18n._(REMINDER_DAYS_COPY.edit)}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="grid gap-2">
          <WeekdayPicker value={draft} onChange={setDraft} disabled={pending} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              {i18n._(REMINDER_DAYS_COPY.save)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {i18n._(REMINDER_DAYS_COPY.cancel)}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
