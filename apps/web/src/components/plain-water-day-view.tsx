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
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { useId, useState } from "react";

/**
 * Plain water (Issue #83), shown as its own subtotal between the day's
 * targets and the meal add flow. It records plain water only and never adds to
 * meal totals. Quantities arrive already redacted by `buildWaterDayView`, so
 * this view has no raw amount to leak into text, placeholders or labels while
 * numbers are hidden. There is no progress, streak, default goal or advice.
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
  onAdd: (input: { quantity: number; unit: WaterUnit; observedAt: string }) => Promise<boolean>;
  onChange: (
    entryId: number,
    revision: number,
    patch: {
      quantity?: number;
      unit?: WaterUnit;
      observedAt?: string;
      timeZone?: string;
    },
  ) => Promise<boolean>;
  onDelete: (entryId: number, revision: number) => void;
  /** Queue banners and conflict cards, owned by the platform. */
  aboveList?: ReactNode;
};

function WaterField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
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
          variant={value === unit ? "default" : "outline"}
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

export function PlainWaterDayView({
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
}: PlainWaterDayViewProps) {
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
    unit: WaterUnit;
    clock: string;
    originalClock: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const openAdd = () => {
    setAddOpen(true);
    setAmount("");
    setAddUnit(unit);
    setClock(nowClock(timeZone));
    setAddError(null);
  };

  const submitAdd = async () => {
    const parsed = parseWaterAmount(amount, addUnit);
    if (!parsed.ok) return setAddError(parsed.error);
    const instant = waterDateInstant(localDate, clock, timeZone);
    if (!instant.ok)
      return setAddError(
        instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid,
      );
    setAddError(null);
    const saved = await onAdd({
      quantity: parsed.quantity,
      unit: parsed.unit,
      observedAt: instant.observedAt,
    });
    if (saved) setAddOpen(false);
  };

  const submitEdit = async () => {
    if (!editing) return;
    const quantityText = editing.amount.trim();
    const timeChanged = editing.clock !== editing.originalClock;
    let patch: { quantity?: number; unit?: WaterUnit; observedAt?: string; timeZone?: string } = {};
    if (quantityText) {
      const parsed = parseWaterAmount(editing.amount, editing.unit);
      if (!parsed.ok) return setEditError(parsed.error);
      patch = { quantity: parsed.quantity, unit: parsed.unit };
    }
    if (timeChanged) {
      const instant = waterDateInstant(localDate, editing.clock, timeZone);
      if (!instant.ok)
        return setEditError(
          instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid,
        );
      patch = { ...patch, observedAt: instant.observedAt, timeZone };
    }
    if (patch.quantity === undefined && patch.observedAt === undefined)
      return setEditError(WATER_COPY.nothingChanged);
    setEditError(null);
    const saved = await onChange(editing.entryId, editing.revision, patch);
    if (saved) setEditing(null);
  };

  const submitGoal = async (clear: boolean) => {
    if (clear) {
      setGoalError(null);
      await onSaveGoal(null);
      return;
    }
    const parsed = parseWaterGoal(goalText, unit);
    if (!parsed.ok) return setGoalError(parsed.error);
    setGoalError(null);
    await onSaveGoal(parsed.personalGoalMl);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>
            <h2 id="plain-water-heading" className="text-lg font-medium">
              {WATER_COPY.title}
            </h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{WATER_COPY.scopeNote}</p>
        </div>
        {enabled === false ? <Badge variant="outline">{WATER_COPY.optional}</Badge> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {load === "loading" ? <Skeleton className="h-20 w-full" /> : null}

        {load === "error" ? (
          <p className="text-sm text-muted-foreground" role="alert">
            {WATER_COPY.networkError}{" "}
            <button type="button" className="underline" onClick={onRetry}>
              {WATER_COPY.retry}
            </button>
          </p>
        ) : null}

        {load === "ready" && enabled === null ? (
          <p className="text-sm text-muted-foreground" role="alert">
            {WATER_COPY.networkError}{" "}
            <button type="button" className="underline" onClick={onRetry}>
              {WATER_COPY.retry}
            </button>
          </p>
        ) : null}

        {enabled === false ? (
          <div className="grid gap-2">
            <p className="font-medium">{WATER_COPY.offTitle}</p>
            <p className="text-sm text-muted-foreground">{WATER_COPY.offBody}</p>
            <div>
              <Button size="sm" onClick={() => onToggleEnabled(true)} disabled={busy !== null}>
                {WATER_COPY.turnOn}
              </Button>
            </div>
          </div>
        ) : null}

        {enabled && view ? (
          <>
            <div
              className="grid gap-1 rounded-md border p-3"
              aria-label={describeWaterSubtotal(view, unit, hideNumbers)}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">{WATER_COPY.subtotalLabel}</span>
                <span className="font-mono text-lg">
                  {formatWaterSubtotal(view, unit, hideNumbers)}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">
                  {WATER_COPY.goalLabel}:{" "}
                  <span className="font-mono">
                    {formatWaterGoal(view.personalGoalMl, unit, hideNumbers)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{WATER_COPY.goalNote}</span>
              </div>
              {hideNumbers ? (
                <p className="text-xs text-muted-foreground">{WATER_COPY.hiddenNote}</p>
              ) : (
                <div className="mt-1">
                  <UnitChoice value={unit} onChange={onUnitChange} label="Display unit" />
                </div>
              )}
            </div>

            {formError ? (
              <p className="text-sm text-muted-foreground" role="alert">
                {formError}
              </p>
            ) : null}

            {aboveList}

            {view.pendingRemovalCount > 0 ? (
              <p className="text-xs text-muted-foreground" role="status">
                {view.pendingRemovalCount === 1
                  ? "1 removal waiting to sync."
                  : `${view.pendingRemovalCount} removals waiting to sync.`}
              </p>
            ) : null}

            {view.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{WATER_COPY.empty}</p>
            ) : (
              <ul
                className="divide-y divide-border rounded-md border"
                aria-label={WATER_COPY.entriesLabel}
              >
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
                      setEditing({
                        entryId: row.entryId,
                        revision: row.revision,
                        // Redacted rows carry no amount, so a hidden edit starts blank.
                        amount: String(waterAmountValue(row.quantityMl, unit) ?? ""),
                        unit,
                        clock: formatObservedClock(row.observedAt, timeZone) ?? "",
                        originalClock: formatObservedClock(row.observedAt, timeZone) ?? "",
                      });
                    }}
                    onEditAmount={(value) =>
                      setEditing((current) => (current ? { ...current, amount: value } : current))
                    }
                    onEditUnit={(next) =>
                      setEditing((current) => (current ? { ...current, unit: next } : current))
                    }
                    onEditClock={(next) =>
                      setEditing((current) => (current ? { ...current, clock: next } : current))
                    }
                    onSaveEdit={submitEdit}
                    onCancelEdit={() => {
                      setEditing(null);
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
              <div className="grid gap-3 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                  <WaterField label={WATER_COPY.amountLabel}>
                    {(id) => (
                      <Input
                        id={id}
                        inputMode="decimal"
                        placeholder={WATER_COPY.amountPlaceholder}
                        value={amount}
                        aria-invalid={addError !== null}
                        onChange={(event) => setAmount(event.target.value)}
                      />
                    )}
                  </WaterField>
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium">{WATER_COPY.unitLabel}</span>
                    <UnitChoice
                      value={addUnit}
                      onChange={setAddUnit}
                      label={WATER_COPY.unitLabel}
                    />
                  </div>
                  <WaterField label={WATER_COPY.timeLabel}>
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
                    <Button size="sm" onClick={() => void submitAdd()} disabled={busy !== null}>
                      {busy === "add" ? WATER_COPY.saving : WATER_COPY.save}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setClock(nowClock(timeZone))}>
                      {WATER_COPY.useNow}
                    </Button>
                  </div>
                </div>
                {addError ? (
                  <p className="text-sm text-muted-foreground" role="alert">
                    {addError}
                  </p>
                ) : null}
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                    {WATER_COPY.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button size="sm" onClick={openAdd}>
                  {WATER_COPY.add}
                </Button>
              </div>
            )}

            <details
              className="text-sm"
              open={settingsOpen}
              onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-muted-foreground">
                {WATER_COPY.settingsTitle}
              </summary>
              <div className="mt-3 grid gap-3">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={enabled === true}
                    onCheckedChange={(checked) => onToggleEnabled(checked)}
                    disabled={busy !== null}
                    aria-describedby="plain-water-switch-note"
                  />
                  <span>{WATER_COPY.settingsTitle}</span>
                </label>
                <p id="plain-water-switch-note" className="text-xs text-muted-foreground">
                  {WATER_COPY.offBody}
                </p>
                <div className="grid gap-2 rounded-md border p-3">
                  <p className="text-sm font-medium">{WATER_COPY.goalLabel}</p>
                  {hideNumbers ? (
                    <p className="text-xs text-muted-foreground">{WATER_COPY.editGoalHiddenNote}</p>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-2">
                    <WaterField label={WATER_COPY.goalAmountLabel}>
                      {(id) => (
                        <Input
                          id={id}
                          inputMode="decimal"
                          placeholder={WATER_COPY.goalAmountPlaceholder}
                          value={goalText}
                          aria-invalid={goalError !== null}
                          onChange={(event) => setGoalText(event.target.value)}
                        />
                      )}
                    </WaterField>
                    {hideNumbers ? null : (
                      <span className="pb-2 text-sm text-muted-foreground">
                        {WATER_UNIT_LABELS[unit]}
                      </span>
                    )}
                    <Button
                      size="sm"
                      onClick={() => void submitGoal(false)}
                      disabled={busy !== null}
                    >
                      {busy === "settings" ? WATER_COPY.saving : WATER_COPY.setGoal}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void submitGoal(true)}
                      disabled={busy !== null || (view.personalGoalMl === null && !hideNumbers)}
                    >
                      {WATER_COPY.clearGoal}
                    </Button>
                  </div>
                  {goalError ? (
                    <p className="text-sm text-muted-foreground" role="alert">
                      {goalError}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{WATER_COPY.goalNote}</p>
                </div>
              </div>
            </details>
          </>
        ) : null}
      </CardContent>
    </Card>
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
  const time = observedTimeLabel(row, deviceZone) ?? row.observedAt;
  const stateLabel =
    row.state === "syncing"
      ? WATER_COPY.rowSyncing
      : row.state === "needs_attention"
        ? WATER_COPY.rowNeedsAttention
        : WATER_COPY.rowQueued;
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-sm text-muted-foreground">{time}</span>
          <span className="font-mono text-sm">
            {formatWaterAmount(row.quantityMl, unit, hideNumbers)}
          </span>
          {row.state === "synced" ? null : <Badge variant="outline">{stateLabel}</Badge>}
        </div>
        <div className="flex flex-wrap gap-1">
          {row.state === "synced" && !row.local ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={editing}
                onClick={editing ? onCancelEdit : onStartEdit}
              >
                {WATER_COPY.edit} <span className="sr-only">{`entry at ${time}`}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={onAskDelete}>
                {WATER_COPY.delete} <span className="sr-only">{`entry at ${time}`}</span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <div className="grid gap-2 rounded-md border p-3" role="alert">
          <p className="text-sm">{WATER_COPY.deleteConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onDelete} disabled={busy !== null}>
              {WATER_COPY.confirmDelete}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelDelete}>
              {WATER_COPY.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          {hideNumbers ? (
            <p className="text-xs text-muted-foreground sm:col-span-4">
              {WATER_COPY.editHiddenNote}
            </p>
          ) : null}
          <WaterField label={WATER_COPY.amountLabel}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder={WATER_COPY.amountPlaceholder}
                value={editAmount}
                aria-invalid={editError !== null}
                onChange={(event) => onEditAmount(event.target.value)}
              />
            )}
          </WaterField>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{WATER_COPY.unitLabel}</span>
            <UnitChoice value={editUnit} onChange={onEditUnit} label={WATER_COPY.unitLabel} />
          </div>
          <WaterField label={WATER_COPY.timeLabel}>
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
            <Button size="sm" onClick={() => void onSaveEdit()} disabled={busy !== null}>
              {busy === "edit" ? WATER_COPY.saving : WATER_COPY.save}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>
              {WATER_COPY.cancel}
            </Button>
          </div>
          {editError ? (
            <p className="text-sm text-muted-foreground sm:col-span-4" role="alert">
              {editError}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
