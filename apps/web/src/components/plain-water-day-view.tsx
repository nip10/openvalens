import type { ReactNode } from "react";
import {
  WATER_COPY,
  WATER_UNITS,
  WATER_UNIT_LABELS,
  formatObservedClock,
  formatWaterAmount,
  formatWaterGoal,
  formatWaterSubtotal,
  describeWaterSubtotal,
  observedTimeLabel,
  parseWaterAmount,
  parseWaterGoal,
  waterAmountValue,
  waterDateInstant,
  type WaterDayRow,
  type WaterDayView,
  type WaterUnit,
} from "@openvalens/api/presenters/plain-water";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { plural } from "@lingui/core/macro";
import { ChevronRight, GlassWater, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { inlineButtonClass } from "./food-classes";
import { InfoTip, Meter, Section, StatusPill } from "./page";
import { editAmountChanged, editUnitChanged, waterEditAmountPatch } from "./plain-water-form";
import {
  isResolvedFormGeneration,
  newPlainWaterFormGeneration,
} from "./plain-water-form-lifecycle";

/**
 * Plain water (Issue #83), shown as its own subtotal between the day's
 * targets and the meal add flow. It records plain water only and never adds to
 * meal totals. Quantities arrive already redacted by `buildWaterDayView`, so
 * this view has no raw amount to leak into text, placeholders or labels while
 * numbers are hidden. There is no streak, default goal or advice; a soft bar
 * toward the member's own goal shows only when they set one and numbers show.
 */
export type PlainWaterDayViewProps = {
  view: WaterDayView | null;
  load: "loading" | "error" | "ready";
  /** Server preference merged with the day read; `null` while unknown. */
  enabled: boolean | null;
  hideNumbers: boolean;
  unit: WaterUnit;
  onUnitChange: (unit: WaterUnit) => void;
  localDate: string;
  timeZone: string;
  busy: "add" | "edit" | "delete" | "settings" | null;
  formError: string | null;
  onRetry: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  /** Resolves true once the server accepted the change. */
  onSaveGoal: (personalGoalMl: number | null) => Promise<boolean>;
  onAdd: (
    input: { quantity: number; unit: WaterUnit; observedAt: string },
    generation?: number,
  ) => Promise<boolean>;
  onChange: (
    entryId: number,
    revision: number,
    patch: {
      quantity?: number;
      unit?: WaterUnit;
      observedAt?: string;
      timeZone?: string;
    },
    generation?: number,
  ) => Promise<boolean>;
  onDelete: (entryId: number, revision: number) => void;
  /** Queue banners and conflict cards, owned by the platform. */
  aboveList?: ReactNode;
  resolvedIntentGeneration?: number | null;
};

function WaterField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-ink-3">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

function UnitChoice({
  value,
  onChange,
  label,
}: {
  value: WaterUnit;
  onChange: (unit: WaterUnit) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {WATER_UNITS.map((unit) => (
        <Button
          key={unit}
          type="button"
          size="sm"
          variant="outline"
          className="aria-pressed:border-transparent aria-pressed:bg-water-soft aria-pressed:text-ink"
          aria-pressed={value === unit}
          onClick={() => onChange(unit)}
        >
          {WATER_UNIT_LABELS[unit]}
        </Button>
      ))}
    </div>
  );
}

function nowClock(timeZone: string): string {
  return formatObservedClock(new Date().toISOString(), timeZone) ?? "12:00";
}

export function PlainWaterDayView(props: PlainWaterDayViewProps) {
  return (
    <PlainWaterDayViewState
      key={props.hideNumbers ? "numbers-hidden" : "numbers-visible"}
      {...props}
    />
  );
}

function PlainWaterDayViewState({
  view,
  load,
  enabled,
  hideNumbers,
  unit,
  onUnitChange,
  localDate,
  timeZone,
  busy,
  formError,
  onRetry,
  onToggleEnabled,
  onSaveGoal,
  onAdd,
  onChange,
  onDelete,
  aboveList,
  resolvedIntentGeneration = null,
}: PlainWaterDayViewProps) {
  const { t, i18n } = useLingui();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [addUnit, setAddUnit] = useState<WaterUnit>(unit);
  const [clock, setClock] = useState(() => nowClock(timeZone));
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    entryId: number;
    revision: number;
    amount: string;
    amountDirty: boolean;
    unit: WaterUnit;
    clock: string;
    originalClock: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [addGeneration, setAddGeneration] = useState<number | null>(null);
  const [editGeneration, setEditGeneration] = useState<number | null>(null);
  const addGenerationRef = useRef(addGeneration);
  const editGenerationRef = useRef(editGeneration);
  addGenerationRef.current = addGeneration;
  editGenerationRef.current = editGeneration;

  // Resolve the exact submitted draft before committing another render. The
  // controller keeps retry identity outside this privacy-keyed form boundary.
  if (isResolvedFormGeneration(addGeneration, resolvedIntentGeneration)) {
    setAddGeneration(null);
    setAddOpen(false);
    setAmount("");
    setAddError(null);
  }
  if (isResolvedFormGeneration(editGeneration, resolvedIntentGeneration)) {
    setEditGeneration(null);
    setEditing(null);
    setEditError(null);
  }

  const openAdd = () => {
    setAddOpen(true);
    setAddGeneration(newPlainWaterFormGeneration());
    setAmount("");
    setAddUnit(unit);
    setClock(nowClock(timeZone));
    setAddError(null);
  };

  const submitAdd = async () => {
    if (addGeneration === null) return;
    const parsed = parseWaterAmount(amount, addUnit);
    if (!parsed.ok) return setAddError(i18n._(parsed.error));
    const instant = waterDateInstant(localDate, clock, timeZone);
    if (!instant.ok)
      return setAddError(
        i18n._(
          instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid,
        ),
      );
    setAddError(null);
    const saved = await onAdd(
      {
        quantity: parsed.quantity,
        unit: parsed.unit,
        observedAt: instant.observedAt,
      },
      addGeneration,
    );
    if (saved && addGenerationRef.current === addGeneration) {
      setAddOpen(false);
      setAddGeneration(null);
      setAmount("");
    }
  };

  const submitEdit = async () => {
    if (!editing || editGeneration === null) return;
    const timeChanged = editing.clock !== editing.originalClock;
    const amountPatch = waterEditAmountPatch(editing);
    if (!amountPatch.ok) return setEditError(i18n._(amountPatch.error));
    let patch: { quantity?: number; unit?: WaterUnit; observedAt?: string; timeZone?: string } =
      amountPatch.patch;
    if (timeChanged) {
      const instant = waterDateInstant(localDate, editing.clock, timeZone);
      if (!instant.ok)
        return setEditError(
          i18n._(
            instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid,
          ),
        );
      patch = { ...patch, observedAt: instant.observedAt, timeZone };
    }
    if (patch.quantity === undefined && patch.observedAt === undefined)
      return setEditError(i18n._(WATER_COPY.nothingChanged));
    setEditError(null);
    const saved = await onChange(editing.entryId, editing.revision, patch, editGeneration);
    if (saved && editGenerationRef.current === editGeneration) {
      setEditing(null);
      setEditGeneration(null);
    }
  };

  const submitGoal = async (clear: boolean) => {
    if (clear) {
      setGoalError(null);
      await onSaveGoal(null);
      return;
    }
    const parsed = parseWaterGoal(goalText, unit);
    if (!parsed.ok) return setGoalError(i18n._(parsed.error));
    setGoalError(null);
    await onSaveGoal(parsed.personalGoalMl);
  };

  const errorLine = (
    <p className="rounded-2xl bg-destructive/6 px-4 py-3 text-sm text-ink-2" role="alert">
      {i18n._(WATER_COPY.readError)}{" "}
      <button type="button" className={inlineButtonClass} onClick={onRetry}>
        {i18n._(WATER_COPY.retry)}
      </button>
    </p>
  );
  const goalShare =
    view && !hideNumbers && view.subtotalMl !== null && view.personalGoalMl
      ? view.subtotalMl / view.personalGoalMl
      : null;

  return (
    <Section
      icon={GlassWater}
      tone="water"
      sheet
      aria-labelledby="plain-water-heading"
      title={<span id="plain-water-heading">{i18n._(WATER_COPY.title)}</span>}
      info={i18n._(WATER_COPY.scopeNote)}
      actions={
        enabled === false ? (
          <StatusPill tone="neutral">{i18n._(WATER_COPY.optional)}</StatusPill>
        ) : null
      }
    >
      <div className="grid min-w-0 gap-4">
        {load === "loading" ? <Skeleton className="h-20 w-full rounded-2xl" /> : null}

        {load === "error" ? errorLine : null}

        {load === "ready" && enabled === null ? errorLine : null}

        {enabled === false ? (
          <div className="grid gap-2">
            <p className="font-display font-medium text-ink">{i18n._(WATER_COPY.offTitle)}</p>
            <p className="text-sm text-ink-3">{i18n._(WATER_COPY.offBody)}</p>
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onToggleEnabled(true)}
                disabled={busy !== null}
              >
                {i18n._(WATER_COPY.turnOn)}
              </Button>
            </div>
          </div>
        ) : null}

        {enabled && view ? (
          <>
            <div
              className="grid gap-3"
              aria-label={describeWaterSubtotal(view, unit, hideNumbers, i18n)}
            >
              <div className="grid gap-1">
                <span className="text-sm text-ink-3">{i18n._(WATER_COPY.subtotalLabel)}</span>
                <span className="num font-display text-[2.125rem] leading-none font-medium tracking-[-0.02em] text-ink">
                  {formatWaterSubtotal(view, unit, hideNumbers, i18n)}
                </span>
              </div>
              {goalShare !== null ? (
                <Meter value={goalShare} tone="water" label={t`Toward your personal goal`} />
              ) : null}
              <div className="flex flex-wrap items-center gap-1 text-sm text-ink-2">
                <span>
                  <Trans>
                    Personal goal:{" "}
                    <span className="num font-semibold text-ink">
                      {formatWaterGoal(view.personalGoalMl, unit, hideNumbers, i18n)}
                    </span>
                  </Trans>
                </span>
                <InfoTip>{i18n._(WATER_COPY.goalNote)}</InfoTip>
              </div>
              {hideNumbers ? (
                <p className="text-sm text-ink-3">{i18n._(WATER_COPY.hiddenNote)}</p>
              ) : (
                <div className="mt-1">
                  <UnitChoice value={unit} onChange={onUnitChange} label={t`Display unit`} />
                </div>
              )}
            </div>

            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}

            {aboveList}

            {view.pendingRemovalCount > 0 ? (
              <p className="text-sm text-ink-3" role="status">
                {t`${plural(view.pendingRemovalCount, {
                  one: "# removal waiting to sync.",
                  other: "# removals waiting to sync.",
                })}`}
              </p>
            ) : null}

            {view.rows.length === 0 ? (
              <p className="text-sm text-ink-3">
                {i18n._(
                  view.reconciliationUnknown ? WATER_COPY.reconciliationUnknown : WATER_COPY.empty,
                )}
              </p>
            ) : (
              <ul className="divide-y divide-rule" aria-label={i18n._(WATER_COPY.entriesLabel)}>
                {view.rows.map((row) => (
                  <WaterRow
                    key={row.key}
                    row={row}
                    unit={unit}
                    hideNumbers={hideNumbers}
                    deviceZone={timeZone}
                    busy={busy}
                    editing={editing?.entryId === row.entryId && row.entryId !== null}
                    editAmount={editing?.amount ?? ""}
                    editUnit={editing?.unit ?? unit}
                    editClock={editing?.clock ?? ""}
                    editError={editing?.entryId === row.entryId ? editError : null}
                    confirming={confirming === row.key}
                    onStartEdit={() => {
                      if (row.entryId === null || row.revision === null) return;
                      setConfirming(null);
                      setEditError(null);
                      setEditGeneration(newPlainWaterFormGeneration());
                      setEditing({
                        entryId: row.entryId,
                        revision: row.revision,
                        // Redacted rows carry no amount, so a hidden edit starts blank.
                        amount: String(waterAmountValue(row.quantityMl, unit) ?? ""),
                        amountDirty: false,
                        unit,
                        clock: formatObservedClock(row.observedAt, timeZone) ?? "",
                        originalClock: formatObservedClock(row.observedAt, timeZone) ?? "",
                      });
                    }}
                    onEditAmount={(value) =>
                      setEditing((current) =>
                        current ? editAmountChanged(current, value) : current,
                      )
                    }
                    onEditUnit={(next) =>
                      setEditing((current) => (current ? editUnitChanged(current, next) : current))
                    }
                    onEditClock={(next) =>
                      setEditing((current) => (current ? { ...current, clock: next } : current))
                    }
                    onSaveEdit={submitEdit}
                    onCancelEdit={() => {
                      setEditing(null);
                      setEditGeneration(null);
                      setEditError(null);
                    }}
                    onAskDelete={() => setConfirming(row.key)}
                    onCancelDelete={() => setConfirming(null)}
                    onDelete={() => {
                      if (row.entryId === null || row.revision === null) {
                        // A queued add has no server id; the queue owns it instead.
                        setConfirming(null);
                        return;
                      }
                      onDelete(row.entryId, row.revision);
                      setConfirming(null);
                    }}
                  />
                ))}
              </ul>
            )}

            {addOpen ? (
              <div className="grid gap-3 rounded-2xl bg-paper-2 p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <WaterField label={i18n._(WATER_COPY.amountLabel)}>
                    {(id) => (
                      <Input
                        id={id}
                        className="num"
                        inputMode="decimal"
                        placeholder={i18n._(WATER_COPY.amountPlaceholder)}
                        value={amount}
                        aria-invalid={addError !== null}
                        onChange={(event) => setAmount(event.target.value)}
                      />
                    )}
                  </WaterField>
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-3">
                      {i18n._(WATER_COPY.unitLabel)}
                    </span>
                    <UnitChoice
                      value={addUnit}
                      onChange={setAddUnit}
                      label={i18n._(WATER_COPY.unitLabel)}
                    />
                  </div>
                  <WaterField label={i18n._(WATER_COPY.timeLabel)}>
                    {(id) => (
                      <Input
                        id={id}
                        type="time"
                        value={clock}
                        aria-invalid={addError !== null}
                        onChange={(event) => setClock(event.target.value)}
                      />
                    )}
                  </WaterField>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void submitAdd()}
                      disabled={busy !== null}
                    >
                      {i18n._(busy === "add" ? WATER_COPY.saving : WATER_COPY.save)}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setClock(nowClock(timeZone))}>
                      {i18n._(WATER_COPY.useNow)}
                    </Button>
                  </div>
                </div>
                {addError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {addError}
                  </p>
                ) : null}
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                    {i18n._(WATER_COPY.cancel)}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button size="sm" variant="outline" onClick={openAdd}>
                  <Plus aria-hidden="true" />
                  {i18n._(WATER_COPY.add)}
                </Button>
              </div>
            )}

            <details
              className="group text-sm"
              open={settingsOpen}
              onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
            >
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 font-display font-medium text-ink-2 transition-colors duration-[var(--dur-short)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 transition-transform duration-[var(--dur-short)] group-open:rotate-90 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <Settings2 className="size-4 text-ink-3" aria-hidden="true" />
                {i18n._(WATER_COPY.settingsTitle)}
              </summary>
              <div className="mt-3 grid gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-ink-2">
                  <Switch
                    checked={enabled === true}
                    onCheckedChange={(checked) => onToggleEnabled(checked)}
                    disabled={busy !== null}
                    aria-describedby="plain-water-switch-note"
                  />
                  <span>{i18n._(WATER_COPY.settingsTitle)}</span>
                </label>
                <p id="plain-water-switch-note" className="text-sm text-ink-3">
                  {i18n._(WATER_COPY.offBody)}
                </p>
                <div className="grid gap-2 rounded-2xl bg-paper-2 p-4">
                  <p className="font-display text-sm font-medium text-ink">
                    {i18n._(WATER_COPY.goalLabel)}
                  </p>
                  {hideNumbers ? (
                    <p className="text-sm text-ink-3">{i18n._(WATER_COPY.editGoalHiddenNote)}</p>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-2">
                    <WaterField label={i18n._(WATER_COPY.goalAmountLabel)}>
                      {(id) => (
                        <Input
                          id={id}
                          inputMode="decimal"
                          placeholder={i18n._(WATER_COPY.goalAmountPlaceholder)}
                          value={goalText}
                          aria-invalid={goalError !== null}
                          onChange={(event) => setGoalText(event.target.value)}
                        />
                      )}
                    </WaterField>
                    {hideNumbers ? null : (
                      <span className="pb-2 text-sm text-ink-3">{WATER_UNIT_LABELS[unit]}</span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void submitGoal(false)}
                      disabled={busy !== null}
                    >
                      {i18n._(busy === "settings" ? WATER_COPY.saving : WATER_COPY.setGoal)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void submitGoal(true)}
                      disabled={busy !== null || (view.personalGoalMl === null && !hideNumbers)}
                    >
                      {i18n._(WATER_COPY.clearGoal)}
                    </Button>
                  </div>
                  {goalError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {goalError}
                    </p>
                  ) : null}
                  <p className="text-sm text-ink-3">{i18n._(WATER_COPY.goalNote)}</p>
                </div>
              </div>
            </details>
          </>
        ) : null}
      </div>
    </Section>
  );
}

function WaterRow({
  row,
  unit,
  hideNumbers,
  deviceZone,
  busy,
  editing,
  editAmount,
  editUnit,
  editClock,
  editError,
  confirming,
  onStartEdit,
  onEditAmount,
  onEditUnit,
  onEditClock,
  onSaveEdit,
  onCancelEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  row: WaterDayRow;
  unit: WaterUnit;
  hideNumbers: boolean;
  deviceZone: string;
  busy: PlainWaterDayViewProps["busy"];
  editing: boolean;
  editAmount: string;
  editUnit: WaterUnit;
  editClock: string;
  editError: string | null;
  confirming: boolean;
  onStartEdit: () => void;
  onEditAmount: (value: string) => void;
  onEditUnit: (unit: WaterUnit) => void;
  onEditClock: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useLingui();
  const time = observedTimeLabel(row, deviceZone) ?? row.observedAt;
  const stateLabel = i18n._(
    row.state === "syncing"
      ? WATER_COPY.rowSyncing
      : row.state === "needs_attention"
        ? WATER_COPY.rowNeedsAttention
        : WATER_COPY.rowQueued,
  );
  return (
    <li className="grid gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="num rounded-full bg-water-soft px-2.5 py-1 text-sm font-semibold text-ink">
            {formatWaterAmount(row.quantityMl, unit, hideNumbers, i18n)}
          </span>
          <span className="num text-sm text-ink-3">{time}</span>
          {row.state === "synced" ? null : (
            <StatusPill tone={row.state === "needs_attention" ? "warn" : "neutral"}>
              {stateLabel}
            </StatusPill>
          )}
        </div>
        <div className="-mr-1 flex flex-wrap items-center">
          {row.state === "synced" && !row.local ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-ink-3 hover:text-ink"
                aria-expanded={editing}
                onClick={editing ? onCancelEdit : onStartEdit}
              >
                <Pencil aria-hidden="true" />
                <span className="sr-only">
                  {i18n._(WATER_COPY.edit)} <span className="sr-only">{t`entry at ${time}`}</span>
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-ink-3 hover:text-destructive"
                onClick={onAskDelete}
              >
                <Trash2 aria-hidden="true" />
                <span className="sr-only">
                  {i18n._(WATER_COPY.delete)} <span className="sr-only">{t`entry at ${time}`}</span>
                </span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <div className="grid gap-2 rounded-2xl bg-destructive/6 px-4 py-3" role="alert">
          <p className="text-sm text-ink">{i18n._(WATER_COPY.deleteConfirm)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy !== null}>
              {i18n._(WATER_COPY.confirmDelete)}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelDelete}>
              {i18n._(WATER_COPY.cancel)}
            </Button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="grid gap-3 rounded-2xl bg-paper-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          {hideNumbers ? (
            <p className="text-sm text-ink-3 sm:col-span-2">{i18n._(WATER_COPY.editHiddenNote)}</p>
          ) : null}
          <WaterField label={i18n._(WATER_COPY.amountLabel)}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder={i18n._(WATER_COPY.amountPlaceholder)}
                value={editAmount}
                aria-invalid={editError !== null}
                onChange={(event) => onEditAmount(event.target.value)}
              />
            )}
          </WaterField>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-3">{i18n._(WATER_COPY.unitLabel)}</span>
            <UnitChoice
              value={editUnit}
              onChange={onEditUnit}
              label={i18n._(WATER_COPY.unitLabel)}
            />
          </div>
          <WaterField label={i18n._(WATER_COPY.timeLabel)}>
            {(id) => (
              <Input
                id={id}
                type="time"
                value={editClock}
                onChange={(event) => onEditClock(event.target.value)}
              />
            )}
          </WaterField>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onSaveEdit()}
              disabled={busy !== null}
            >
              {i18n._(busy === "edit" ? WATER_COPY.saving : WATER_COPY.save)}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>
              {i18n._(WATER_COPY.cancel)}
            </Button>
          </div>
          {editError ? (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {editError}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
