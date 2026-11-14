import { Trans, useLingui } from "@lingui/react/macro";
import {
  TRACKER_AGGREGATION_LABELS,
  TRACKER_PERIOD_LABELS,
  TRACKER_TYPE_LABELS,
} from "@openvalens/api/presenters/trackers";
import {
  NUMBER_AGGREGATIONS,
  TRACKER_ICONS,
  TRACKER_LIMITS,
  TRACKER_TARGET_PERIODS,
  TRACKER_TYPES,
  type NumberAggregation,
  type TrackerTargetPeriod,
  type TrackerType,
} from "@openvalens/trackers/model";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Switch } from "@openvalens/ui/components/switch";
import { cn } from "@openvalens/ui/lib/utils";
import { useId, type ReactNode } from "react";

import { trackerIcon } from "@/components/tracker-icons";

import { trackerDraftProblems, type TrackerDraft } from "@openvalens/api/presenters/tracker-draft";

const NATIVE_SELECT =
  "h-9 rounded-md border border-input bg-card px-3 text-ink hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";

/**
 * The fields of a custom tracker (#441), for creating one and for its
 * settings. `locked` (the tracker has entries) disables type, unit and how a
 * day's entries combine: to change those, create a new tracker. `isOwner`
 * false hides the owner-only switches.
 */
export function TrackerEditor({
  draft,
  onChange,
  locked = false,
  showErrors = false,
}: {
  draft: TrackerDraft;
  onChange: (draft: TrackerDraft) => void;
  locked?: boolean;
  showErrors?: boolean;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const problems = showErrors ? trackerDraftProblems(draft, i18n.locale) : [];
  const set = <K extends keyof TrackerDraft>(key: K, value: TrackerDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const unitName = draft.unit.trim() || t`the tracker's unit`;
  const targetHint =
    draft.type === "duration"
      ? t`For example 20 min.`
      : draft.type === "yes_no"
        ? t`Days with a yes: 1 per day, or up to 7 per week.`
        : draft.type === "scale"
          ? t`A rating from 1 to 5.`
          : t`In ${unitName}.`;

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>
          <Trans>Name</Trans>
        </Label>
        <Input
          id={`${id}-name`}
          value={draft.name}
          maxLength={TRACKER_LIMITS.nameLength}
          onChange={(event) => set("name", event.target.value)}
          aria-invalid={problems.includes("name") || undefined}
          aria-describedby={problems.includes("name") ? `${id}-name-error` : undefined}
        />
        {problems.includes("name") ? (
          <p id={`${id}-name-error`} role="alert" className="text-sm text-destructive">
            <Trans>Give the tracker a name, up to 40 characters.</Trans>
          </p>
        ) : null}
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium text-ink">
          <Trans>Icon</Trans>
        </legend>
        <div role="radiogroup" aria-label={t`Icon`} className="flex flex-wrap gap-1.5">
          {TRACKER_ICONS.map((key) => {
            const Icon = trackerIcon(key);
            const selected = draft.icon === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={key}
                onClick={() => set("icon", key)}
                className={cn(
                  "grid size-9 place-items-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card text-ink-2 hover:bg-muted",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-type`}>
            <Trans>Type</Trans>
          </Label>
          <select
            id={`${id}-type`}
            className={NATIVE_SELECT}
            value={draft.type}
            disabled={locked}
            onChange={(event) => set("type", event.target.value as TrackerType)}
          >
            {TRACKER_TYPES.map((type) => (
              <option key={type} value={type}>
                {i18n._(TRACKER_TYPE_LABELS[type])}
              </option>
            ))}
          </select>
        </div>
        {draft.type === "number" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-unit`}>
              <Trans>Unit</Trans>
            </Label>
            <Input
              id={`${id}-unit`}
              value={draft.unit}
              maxLength={TRACKER_LIMITS.unitLength}
              placeholder={t`reps, pages, cups`}
              disabled={locked}
              onChange={(event) => set("unit", event.target.value)}
              aria-invalid={problems.includes("unit") || undefined}
            />
            {problems.includes("unit") ? (
              <p role="alert" className="text-sm text-destructive">
                <Trans>Enter a unit, up to 12 characters.</Trans>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {locked ? (
        <p className="text-sm text-ink-3">
          <Trans>
            Type and unit cannot change after the first entry. Create a new tracker instead.
          </Trans>
        </p>
      ) : null}

      {draft.type === "number" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-aggregation`}>
              <Trans>Several entries in a day</Trans>
            </Label>
            <select
              id={`${id}-aggregation`}
              className={NATIVE_SELECT}
              value={draft.aggregation}
              disabled={locked}
              onChange={(event) => set("aggregation", event.target.value as NumberAggregation)}
            >
              {NUMBER_AGGREGATIONS.map((aggregation) => (
                <option key={aggregation} value={aggregation}>
                  {i18n._(TRACKER_AGGREGATION_LABELS[aggregation])}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-decimals`}>
              <Trans>Decimals shown</Trans>
            </Label>
            <select
              id={`${id}-decimals`}
              className={NATIVE_SELECT}
              value={draft.decimals}
              onChange={(event) => set("decimals", Number(event.target.value))}
            >
              {[0, 1, 2].map((decimals) => (
                <option key={decimals} value={decimals}>
                  {decimals}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`${id}-target-on`}>
            <Trans>Target</Trans>
          </Label>
          <Switch
            id={`${id}-target-on`}
            checked={draft.targetEnabled}
            onCheckedChange={(checked) => set("targetEnabled", checked)}
          />
        </div>
        {draft.targetEnabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={t`Target`}
              value={draft.target}
              onChange={(event) => set("target", event.target.value)}
              inputMode={draft.type === "duration" ? "text" : "decimal"}
              className="max-w-40"
              aria-invalid={problems.includes("target") || undefined}
              aria-describedby={`${id}-target-hint`}
            />
            <select
              aria-label={t`Target period`}
              className={NATIVE_SELECT}
              value={draft.targetPeriod}
              onChange={(event) => set("targetPeriod", event.target.value as TrackerTargetPeriod)}
            >
              {TRACKER_TARGET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {i18n._(TRACKER_PERIOD_LABELS[period])}
                </option>
              ))}
            </select>
            <p
              id={`${id}-target-hint`}
              className={cn(
                "w-full text-sm",
                problems.includes("target") ? "text-destructive" : "text-ink-3",
              )}
              role={problems.includes("target") ? "alert" : undefined}
            >
              {targetHint}
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 border-t border-rule pt-4">
        <SwitchRow
          id={`${id}-shared`}
          checked={draft.shared}
          onChange={(checked) => set("shared", checked)}
          label={<Trans>Share with this workspace</Trans>}
          hint={
            <Trans>
              Members who can read records see it; collaborators can add entries. Only you can
              change or delete it.
            </Trans>
          }
        />
        <SwitchRow
          id={`${id}-ai`}
          checked={draft.aiVisible}
          onChange={(checked) => set("aiVisible", checked)}
          label={<Trans>Coach and connected AI apps can read this</Trans>}
          hint={
            draft.type === "scale" ? (
              <Trans>Notes are never shared with the Coach.</Trans>
            ) : (
              <Trans>
                Insights can also describe changes in it. Notes are never shared with the Coach.
              </Trans>
            )
          }
        />
      </div>
    </div>
  );
}

function SwitchRow({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-sm text-ink-3">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={onChange}
      />
    </div>
  );
}
