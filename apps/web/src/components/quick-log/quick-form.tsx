import { Trans, useLingui } from "@lingui/react/macro";
import type { LogKind, LogKindField } from "@openvalens/api/presenters/log-kinds";
import {
  MANUAL_SLEEP_ERROR_MESSAGES,
  SLEEP_QUALITY_LABELS,
  SLEEP_QUALITY_VALUES,
} from "@openvalens/api/presenters/manual-sleep";
import { WATER_UNIT_LABELS, type WaterUnit } from "@openvalens/api/presenters/plain-water";
import { unitKey, type QuickFormValues } from "@openvalens/api/presenters/quick-log";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { TRACKER_LIMITS } from "@openvalens/trackers/model";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";

import { ToneIcon } from "@/components/page";

import { LOG_KIND_ICONS, LOG_KIND_TONES } from "./log-kind-icons";

const SELECT =
  "h-9 rounded-xl border border-input bg-card px-3 text-ink hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";

export type SupplementOption = { id: number; name: string; dose: string | null };

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

const unitLabel = (code: string) =>
  code in WATER_UNIT_LABELS ? WATER_UNIT_LABELS[code as WaterUnit] : code;

/**
 * A log kind's quick form, built from its `fields` (#440): numbers with their
 * unit (and the other units the member may type), times, a 1–5 rating, the
 * member's own supplements and, for custom trackers (#441), yes/no, a typed
 * duration and an optional note. Enter saves.
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
  onBack,
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
  onBack: () => void;
}) {
  const { t, i18n } = useLingui();
  const firstField = useRef<HTMLDivElement>(null);
  useEffect(() => {
    firstField.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }, []);
  const id = (field: string) => `quick-log-${kind.id}-${field}`;
  const invalid = (field: string) => showErrors && errors.includes(field);

  const renderField = (field: LogKindField) => {
    const label = i18n._(field.label);
    if (field.type === "number") {
      const units = field.acceptedUnits ?? (field.unit ? [field.unit.code] : []);
      const symbol = field.unit ? i18n._(field.unit.symbol) : null;
      return (
        <div key={field.id} className="grid gap-2">
          <Label htmlFor={id(field.id)} className="text-sm font-medium">
            {label}
            {!field.required ? (
              <span className="font-normal text-ink-3"> ({t`optional`})</span>
            ) : null}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={id(field.id)}
              inputMode="decimal"
              autoComplete="off"
              className="num"
              value={values[field.id] ?? ""}
              onChange={(event) => onChange(field.id, event.target.value)}
              placeholder={
                field.min !== undefined && field.max !== undefined && units.length <= 1
                  ? `${field.min}–${field.max}`
                  : undefined
              }
              aria-invalid={invalid(field.id) || undefined}
            />
            {units.length > 1 && field.unit ? (
              <select
                aria-label={t`Unit for ${label}`}
                className={SELECT}
                value={values[unitKey(field.id)] ?? field.unit.code}
                onChange={(event) => onChange(unitKey(field.id), event.target.value)}
              >
                {units.map((code) => (
                  <option key={code} value={code}>
                    {unitLabel(code)}
                  </option>
                ))}
              </select>
            ) : symbol ? (
              <span className="text-sm text-ink-3">{symbol}</span>
            ) : null}
          </div>
        </div>
      );
    }
    if (field.type === "datetime")
      return (
        <div key={field.id} className="grid gap-2">
          <Label htmlFor={id(field.id)} className="text-sm font-medium">
            {label}
          </Label>
          <Input
            id={id(field.id)}
            type="datetime-local"
            value={values[field.id] ?? ""}
            onChange={(event) => onChange(field.id, event.target.value)}
            aria-invalid={invalid(field.id) || undefined}
          />
        </div>
      );
    if (field.type === "rating") {
      // Sleep quality has its own words; a tracker's 1–5 self-rating shows the numbers.
      const options =
        kind.id === "sleep"
          ? SLEEP_QUALITY_VALUES.map((value) => ({
              value: String(value),
              text: i18n._(SLEEP_QUALITY_LABELS[value]!),
            }))
          : range(field.min ?? 1, field.max ?? 5).map((value) => ({
              value: String(value),
              text: String(value),
            }));
      return (
        <ToggleGroup
          key={field.id}
          label={label}
          optional={!field.required}
          options={options}
          value={values[field.id] ?? ""}
          onChange={(value) => onChange(field.id, value)}
        />
      );
    }
    if (field.type === "yes_no")
      return (
        <ToggleGroup
          key={field.id}
          label={label}
          optional={false}
          options={[
            { value: "yes", text: t`Yes` },
            { value: "no", text: t`No` },
          ]}
          value={values[field.id] ?? ""}
          onChange={(value) => onChange(field.id, value)}
        />
      );
    if (field.type === "duration")
      return (
        <div key={field.id} className="grid gap-2">
          <Label htmlFor={id(field.id)} className="text-sm font-medium">
            {label}
          </Label>
          <Input
            id={id(field.id)}
            autoComplete="off"
            className="num"
            value={values[field.id] ?? ""}
            onChange={(event) => onChange(field.id, event.target.value)}
            placeholder={t`20 min`}
            aria-describedby={id(`${field.id}-hint`)}
            aria-invalid={invalid(field.id) || undefined}
          />
          <p id={id(`${field.id}-hint`)} className="text-xs text-ink-3">
            <Trans>Such as 20 min, 1:30 or 45 s.</Trans>
          </p>
        </div>
      );
    if (field.type === "text")
      return (
        <div key={field.id} className="grid gap-2 sm:col-span-2">
          <Label htmlFor={id(field.id)} className="text-sm font-medium">
            {label}
            {!field.required ? (
              <span className="font-normal text-ink-3"> ({t`optional`})</span>
            ) : null}
          </Label>
          <Textarea
            id={id(field.id)}
            rows={2}
            maxLength={TRACKER_LIMITS.noteLength}
            value={values[field.id] ?? ""}
            onChange={(event) => onChange(field.id, event.target.value)}
            aria-invalid={invalid(field.id) || undefined}
          />
        </div>
      );
    // `choice`: the quick form offers the member's own supplements.
    return (
      <div key={field.id} className="grid gap-2">
        <Label htmlFor={id(field.id)} className="text-sm font-medium">
          {label}
        </Label>
        {supplements === null ? (
          <p className="text-sm text-ink-3">
            <Trans>Loading your supplements…</Trans>
          </p>
        ) : supplements.length === 0 ? (
          <p className="text-sm text-ink-3">
            <Trans>No supplements yet. Add one on Supplements.</Trans>
          </p>
        ) : (
          <select
            id={id(field.id)}
            className={SELECT}
            value={values[field.id] ?? ""}
            onChange={(event) => onChange(field.id, event.target.value)}
            aria-invalid={invalid(field.id) || undefined}
          >
            <option value="">{t`Choose a supplement`}</option>
            {supplements.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.dose ? `${option.name} · ${option.dose}` : option.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const errorText = !showErrors
    ? null
    : errors.includes("order")
      ? kind.id === "sleep"
        ? i18n._(MANUAL_SLEEP_ERROR_MESSAGES.order)
        : t`Systolic must be higher than diastolic.`
      : errors.includes("value") &&
          kind.fields.some((field) => field.id === "value" && field.type === "duration")
        ? t`Enter a duration such as 20 min, 1:30 or 45 s.`
        : errors.length > 0
          ? t`Check the highlighted values.`
          : null;

  return (
    <form
      className="grid gap-5 p-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label={t`Back`}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <ToneIcon icon={LOG_KIND_ICONS[kind.icon]} tone={LOG_KIND_TONES[kind.icon]} size="sm" />
        <h2 className="font-display text-xl text-ink">{i18n._(kind.label)}</h2>
      </div>
      <div ref={firstField} className="grid gap-4 sm:grid-cols-2">
        {kind.fields.map(renderField)}
      </div>
      {errorText ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not save. Try again.</Trans>
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </Button>
      </div>
    </form>
  );
}

/** A labelled row of toggle buttons; pressing the chosen one again clears it. */
function ToggleGroup({
  label,
  optional,
  options,
  value,
  onChange,
}: {
  label: string;
  optional: boolean;
  options: readonly { value: string; text: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  return (
    <fieldset className="grid gap-2">
      <legend className="pb-2 text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-ink-3"> ({t`optional`})</span> : null}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={selected ? "secondary" : "outline"}
              aria-pressed={selected}
              onClick={() => onChange(selected ? "" : option.value)}
            >
              {option.text}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
