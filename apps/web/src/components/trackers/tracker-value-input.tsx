import { useLingui } from "@lingui/react/macro";
import { TRACKER_TEMPLATE_COPY } from "@openvalens/api/presenters/trackers";
import type { TrackerTemplateId, TrackerType } from "@openvalens/trackers/model";
import { Input } from "@openvalens/ui/components/input";
import { cn } from "@openvalens/ui/lib/utils";

import { DecimalHint } from "@/components/decimal-hint";

/**
 * The value control for one tracker type (#441): a number with its unit, the
 * 1-5 self-rating as five buttons, yes/no, or a typed duration ("20 min",
 * "1:30", "45 s"). The parent parses `text` with `parseTrackerInput`. With
 * `instant`, a tap on a rating or yes/no is the whole entry: the parent saves it.
 */
export function TrackerValueInput({
  id,
  type,
  unit,
  template,
  text,
  onText,
  invalid,
  describedBy,
  instant = false,
  disabled = false,
}: {
  id: string;
  type: TrackerType;
  unit: string | null;
  template: TrackerTemplateId | null;
  text: string;
  onText: (text: string) => void;
  invalid?: boolean;
  describedBy?: string;
  /** A tap on a rating or yes/no logs it at once (plain buttons, not radios). */
  instant?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useLingui();
  if (type === "scale") {
    const copy = template ? TRACKER_TEMPLATE_COPY[template] : undefined;
    // The two ends, as opposites ("Very low" and "Very good"), under 1 and 5.
    const low = copy?.scaleLow ? i18n._(copy.scaleLow) : t`Low`;
    const high = copy?.scaleHigh ? i18n._(copy.scaleHigh) : t`High`;
    return (
      <div className="grid w-fit max-w-full gap-1.5">
        <div
          role={instant ? "group" : "radiogroup"}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
          className="flex flex-wrap gap-2"
        >
          {[1, 2, 3, 4, 5].map((value) => {
            const selected = text === String(value);
            return (
              <button
                key={value}
                type="button"
                role={instant ? undefined : "radio"}
                aria-checked={instant ? undefined : selected}
                aria-pressed={instant ? selected : undefined}
                disabled={disabled}
                onClick={() => onText(String(value))}
                className={cn(
                  "num h-10 min-w-10 rounded-md border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card text-ink hover:bg-muted",
                )}
              >
                {value}
              </button>
            );
          })}
        </div>
        <p className="flex justify-between gap-4 text-xs text-ink-3">
          <span>{low}</span>
          <span className="text-right">{high}</span>
        </p>
      </div>
    );
  }
  if (type === "yes_no") {
    return (
      <div
        role={instant ? "group" : "radiogroup"}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        className="flex gap-2"
      >
        {[
          { value: "yes", label: t`Yes` },
          { value: "no", label: t`No` },
        ].map((option) => {
          const selected = text === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role={instant ? undefined : "radio"}
              aria-checked={instant ? undefined : selected}
              aria-pressed={instant ? selected : undefined}
              disabled={disabled}
              onClick={() => onText(option.value)}
              className={cn(
                "h-10 rounded-md border px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-card text-ink hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={text}
          onChange={(event) => onText(event.target.value)}
          inputMode={type === "number" ? "decimal" : "text"}
          placeholder={type === "duration" ? t`20 min, 1:30 or 45 s` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          className="max-w-48"
        />
        {type === "number" && unit ? <span className="text-ink-3">{unit}</span> : null}
      </div>
      {type === "number" ? <DecimalHint value={text} /> : null}
    </div>
  );
}
