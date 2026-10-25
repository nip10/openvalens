import { useLingui } from "@lingui/react/macro";
import {
  ISO_WEEKDAYS,
  REMINDER_DAYS_COPY,
  reminderCadence,
  weekdayLabel,
} from "@openvalens/api/presenters/supplements";
import { Button } from "@openvalens/ui/components/button";
import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { StatusPill } from "@/components/page";

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
      className="flex flex-wrap gap-1.5"
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
            className={`h-9 min-w-11 cursor-pointer rounded-full border px-3 text-sm transition-colors duration-[var(--dur-short)] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-55 ${
              selected
                ? "border-transparent bg-sidebar-accent font-semibold text-signal hover:bg-sidebar-accent"
                : "border-input bg-card text-ink-3"
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
      <span className="text-sm font-medium text-ink-3">{i18n._(REMINDER_DAYS_COPY.label)}</span>
      <WeekdayPicker value={value} onChange={onChange} />
      <p className="text-sm text-ink-3">
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
        <CalendarDays className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
        <span className="text-ink-2">
          {i18n._(cadence.frequency)}
          {cadence.days ? ` · ${cadence.days}` : ""}
        </span>
        {cadence.needsDays ? (
          <StatusPill tone="warn">{i18n._(REMINDER_DAYS_COPY.needed)}</StatusPill>
        ) : null}
        {!editing ? (
          <Button
            size="xs"
            variant="ghost"
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
        <div className="grid gap-3 rounded-2xl bg-paper-2 p-3">
          <WeekdayPicker value={draft} onChange={setDraft} disabled={pending} />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
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
