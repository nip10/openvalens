import { Trans, useLingui } from "@lingui/react/macro";
import { TRACKER_TEMPLATE_COPY } from "@openvalens/api/presenters/trackers";
import type { TrackerTemplateId, TrackerType } from "@openvalens/trackers/model";
import { Input } from "@openvalens/ui/components/input";
import { cn } from "@openvalens/ui/lib/utils";

import { DecimalHint } from "@/components/decimal-hint";

/**
 * The value control for one tracker type (#441): a number with its unit, the
 * 1-5 self-rating as five buttons, yes/no, or a typed duration ("20 min",
 * "1:30", "45 s"). The parent parses `text` with `parseTrackerInput`.
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
}: {
  id: string;
  type: TrackerType;
  unit: string | null;
  template: TrackerTemplateId | null;
  text: string;
  onText: (text: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const { t, i18n } = useLingui();
  if (type === "scale") {
    const copy = template ? TRACKER_TEMPLATE_COPY[template] : undefined;
    const low = copy?.scaleLow ? i18n._(copy.scaleLow) : null;
    const high = copy?.scaleHigh ? i18n._(copy.scaleHigh) : null;
    return (
      <div className="grid gap-1.5">
        <div
          role="radiogroup"
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
                role="radio"
                aria-checked={selected}
                onClick={() => onText(String(value))}
                className={cn(
                  "num h-10 min-w-10 rounded-md border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
        <p className="text-sm text-ink-3">
          {low && high ? (
            <Trans>
              1 = {low}, 5 = {high}. Your own rating.
            </Trans>
          ) : (
            <Trans>From 1 to 5. Your own rating.</Trans>
          )}
        </p>
      </div>
    );
  }
  if (type === "yes_no") {
    return (
      <div
        role="radiogroup"
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
              role="radio"
              aria-checked={selected}
              onClick={() => onText(option.value)}
              className={cn(
                "h-10 rounded-md border px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
