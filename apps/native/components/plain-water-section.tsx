import { newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import {
  WATER_COPY,
  WATER_UNITS,
  WATER_UNIT_LABELS,
  buildWaterDayView,
  describeWaterAttention,
  describeWaterRow,
  describeWaterSubtotal,
  formatObservedClock,
  formatWaterAmount,
  formatWaterGoal,
  formatWaterSubtotal,
  parseWaterAmount,
  parseWaterGoal,
  waterAmountValue,
  waterDateInstant,
  type WaterAttention,
  type WaterDayRow,
  type WaterUnit,
} from "@openvalens/api/presenters/plain-water";
import { Button, Card, Spinner } from "heroui-native";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Switch, Text, TextInput, View } from "react-native";

import {
  WATER_PREFERENCES_CACHE_KEY,
  retryWaterConflict,
  waterCacheKey,
  waterDayEnabled,
  waterPendingCounts,
} from "@/lib/plain-water/view";
import { usePlainWaterOutbox, type PlainWaterOutbox } from "@/lib/plain-water/sync";
import { canDiscardWaterItem } from "@/lib/plain-water/outbox";
import { editAmountChanged, editUnitChanged, waterEditAmountPatch } from "@/lib/plain-water/form";
import { useCacheFirst } from "@/lib/offline/sync";
import { client, orpc } from "@/utils/orpc";

/**
 * Plain water (Issue #83) on mobile, between the day's targets and the meal add
 * flow. Every write goes through the durable outbox (lib/plain-water), so it
 * works the same online and offline, and is shown with its sync state. The
 * card records plain water only: never part of meal totals, never a verdict,
 * and never a goal the member did not set.
 */

const inputClass =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-lg border px-3 ${selected ? "border-foreground bg-accent" : "border-border"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

function UnitChoice({
  value,
  onChange,
}: {
  value: WaterUnit;
  onChange: (unit: WaterUnit) => void;
}) {
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {WATER_UNITS.map((unit) => (
        <Chip
          key={unit}
          label={WATER_UNIT_LABELS[unit]}
          selected={value === unit}
          onPress={() => onChange(unit)}
        />
      ))}
    </View>
  );
}

export function PlainWaterSection({
  localDate,
  timeZone,
  hideNumbers,
}: {
  localDate: string;
  timeZone: string;
  hideNumbers: boolean;
}) {
  const outbox = usePlainWaterOutbox();
  const queryClient = useQueryClient();
  const day = useCacheFirst(
    waterCacheKey(localDate, timeZone),
    orpc.plainWater.getDay.queryOptions({ input: { date: localDate, timeZone } }),
  );
  const preferences = useCacheFirst(
    WATER_PREFERENCES_CACHE_KEY,
    orpc.plainWater.getPreferences.queryOptions({ input: {} }),
  );
  const [unit, setUnit] = useState<WaterUnit>("ml");
  const [notice, setNotice] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // Fail closed: a preference that has not arrived is not shown as any state.
  const enabled = waterDayEnabled(preferences.data, day.data);
  const view = useMemo(
    () => (day.data ? buildWaterDayView(day.data, outbox.items, hideNumbers) : null),
    [day.data, outbox.items, hideNumbers],
  );
  const counts = waterPendingCounts(outbox.items);
  const attention = view?.attention ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.plainWater.key() });

  /**
   * Settings are not queued: they are a direct write with a clear failure, so
   * the switch never pretends to have saved.
   */
  const saveSettings = async (input: { enabled: boolean } | { personalGoal: number | null }) => {
    setNotice(null);
    setSavingSettings(true);
    try {
      await client.plainWater.updatePreferences(
        "personalGoal" in input
          ? input.personalGoal === null
            ? { personalGoal: null }
            : { personalGoal: input.personalGoal, personalGoalUnit: "ml" }
          : input,
      );
      if (!active.current) return false;
      announce(
        "enabled" in input
          ? input.enabled
            ? WATER_COPY.turnedOn
            : WATER_COPY.turnedOff
          : "personalGoal" in input && input.personalGoal === null
            ? WATER_COPY.goalCleared
            : WATER_COPY.goalSaved,
      );
      void refresh();
      return true;
    } catch {
      if (!active.current) return false;
      setNotice(WATER_COPY.settingsError);
      announce(WATER_COPY.settingsError);
      void refresh();
      return false;
    } finally {
      if (active.current) setSavingSettings(false);
    }
  };

  const onEnqueue = (op: Parameters<PlainWaterOutbox["enqueue"]>[0]) => {
    setNotice(null);
    const queued = outbox.enqueue(op);
    if (!queued) {
      setNotice(WATER_COPY.storageSaveError);
      announce(WATER_COPY.storageSaveError);
      return false;
    }
    announce(WATER_COPY.savedOnDevice);
    return true;
  };

  const keepMine = (item: WaterAttention) => {
    const queued = outbox.items.find((entry) => entry.id === item.id);
    if (!queued) return;
    setNotice(null);
    const applied = retryWaterConflict({ resolveConflict: outbox.resolveConflict }, queued);
    if (!applied) {
      const message =
        "Could not confirm conflict resolution on this device. Review the queued water changes before trying again.";
      setNotice(message);
      announce(message);
      return;
    }
    announce(WATER_COPY.savedOnDevice);
  };

  return (
    <Card variant="secondary" className="gap-3 p-4">
      <View className="gap-1">
        <Text className="font-medium text-foreground" accessibilityRole="header">
          {WATER_COPY.title}
        </Text>
        <Text className="text-sm text-muted-foreground">{WATER_COPY.scopeNote}</Text>
      </View>

      {outbox.error ? (
        <Pressable onPress={() => void outbox.syncNow()} accessibilityRole="button">
          <Text className="text-sm text-muted-foreground">
            {WATER_COPY.storageError} {WATER_COPY.retry}
          </Text>
        </Pressable>
      ) : null}

      {notice ? (
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      {counts.queued + counts.syncing + counts.attention > 0 ? (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-sm text-foreground" accessibilityLiveRegion="polite">
            {`${WATER_COPY.pendingTitle}: `}
            {[
              counts.queued ? `${counts.queued} queued` : null,
              counts.syncing ? `${counts.syncing} syncing` : null,
              counts.attention ? `${counts.attention} needs attention` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </Text>
          <Button size="sm" variant="secondary" onPress={() => void outbox.syncNow()}>
            {WATER_COPY.syncNow}
          </Button>
        </View>
      ) : null}

      {attention.map((item) => {
        const copy = describeWaterAttention(item, unit);
        const queued = outbox.items.find((entry) => entry.id === item.id);
        const discardable = queued ? canDiscardWaterItem(queued) : false;
        return (
          <View key={item.id} className="gap-2 rounded-lg border border-border p-3">
            <Text className="font-medium text-foreground" accessibilityRole="alert">
              {copy.title}
            </Text>
            {copy.other ? (
              <Text className="text-sm text-muted-foreground">{copy.other}</Text>
            ) : null}
            <Text className="text-sm text-muted-foreground">{copy.mine}</Text>
            {!item.isConflict ? (
              <Text className="text-sm text-muted-foreground">{WATER_COPY.rejectedBody}</Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {item.isConflict ? (
                <>
                  <Button size="sm" onPress={() => keepMine(item)}>
                    {WATER_COPY.keepMine}
                  </Button>
                  {discardable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        if (outbox.discard(item.id)) announce(WATER_COPY.keepOther);
                      }}
                    >
                      {WATER_COPY.keepOther}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <Button size="sm" onPress={() => outbox.retry(item.id)}>
                    {WATER_COPY.retry}
                  </Button>
                  {discardable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        if (outbox.discard(item.id)) announce("Change discarded on this device.");
                      }}
                    >
                      {WATER_COPY.discard}
                    </Button>
                  ) : null}
                </>
              )}
            </View>
          </View>
        );
      })}

      {enabled === null ? (
        day.isPending || preferences.isPending ? (
          <Spinner />
        ) : (
          <Pressable
            onPress={() => {
              void day.refetch();
              void preferences.refetch();
            }}
            accessibilityRole="button"
          >
            <Text className="text-sm text-muted-foreground">
              {WATER_COPY.readError} {WATER_COPY.retry}
            </Text>
          </Pressable>
        )
      ) : enabled === false ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">{WATER_COPY.offTitle}</Text>
          <Text className="text-sm text-muted-foreground">{WATER_COPY.offBody}</Text>
          <View>
            <Button size="sm" onPress={() => void saveSettings({ enabled: true })}>
              {WATER_COPY.turnOn}
            </Button>
          </View>
        </View>
      ) : (
        <PlainWaterDayPanel
          key={`${localDate}:${timeZone}:${hideNumbers ? "hidden" : "visible"}`}
          view={view}
          localDate={localDate}
          timeZone={timeZone}
          hideNumbers={hideNumbers}
          unit={unit}
          onUnitChange={setUnit}
          outbox={outbox}
          onEnqueue={onEnqueue}
          settingsBusy={savingSettings}
          onSaveGoal={(personalGoalMl) => saveSettings({ personalGoal: personalGoalMl })}
        />
      )}

      {enabled ? (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-sm text-foreground">{WATER_COPY.settingsTitle}</Text>
          <Switch
            value={true}
            onValueChange={(value) => void saveSettings({ enabled: value })}
            disabled={savingSettings}
            accessibilityLabel={WATER_COPY.settingsTitle}
          />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * The day-scoped part: subtotal, entries and the add flow. Remounted whenever
 * the diary day changes so a draft, an open editor or a pending removal can
 * never carry a revision from another day.
 */
function PlainWaterDayPanel({
  view,
  localDate,
  timeZone,
  hideNumbers,
  unit,
  onUnitChange,
  outbox,
  onEnqueue,
  settingsBusy,
  onSaveGoal,
}: {
  view: ReturnType<typeof buildWaterDayView> | null;
  localDate: string;
  timeZone: string;
  hideNumbers: boolean;
  unit: WaterUnit;
  onUnitChange: (unit: WaterUnit) => void;
  outbox: PlainWaterOutbox;
  onEnqueue: (op: Parameters<PlainWaterOutbox["enqueue"]>[0]) => boolean;
  settingsBusy: boolean;
  onSaveGoal: (personalGoalMl: number | null) => Promise<boolean>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [addUnit, setAddUnit] = useState<WaterUnit>(unit);
  const [clock, setClock] = useState(
    () => formatObservedClock(new Date().toISOString(), timeZone) ?? "12:00",
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    entryId: number;
    revision: number;
    amount: string;
    amountDirty: boolean;
    unit: WaterUnit;
    clock: string;
    originalClock: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);

  if (!view) {
    return <Spinner />;
  }

  const submitAdd = () => {
    const parsed = parseWaterAmount(amount, addUnit);
    if (!parsed.ok) {
      setFormError(parsed.error);
      announce(parsed.error);
      return;
    }
    const instant = waterDateInstant(localDate, clock, timeZone);
    if (!instant.ok) {
      const message =
        instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid;
      setFormError(message);
      announce(message);
      return;
    }
    const queued = onEnqueue({
      kind: "add",
      input: {
        clientMutationId: newClientMutationId(),
        quantity: parsed.quantity,
        unit: parsed.unit,
        observedAt: instant.observedAt,
        timeZone,
      },
    });
    setFormError(null);
    if (queued) setAddOpen(false);
  };

  const submitEdit = () => {
    if (!editing) return;
    let patch: { quantity?: number; unit?: WaterUnit; observedAt?: string; timeZone?: string } = {};
    const amountPatch = waterEditAmountPatch(editing);
    if (!amountPatch.ok) {
      setFormError(amountPatch.error);
      announce(amountPatch.error);
      return;
    }
    patch = amountPatch.patch;
    if (editing.clock !== editing.originalClock) {
      const instant = waterDateInstant(localDate, editing.clock, timeZone);
      if (!instant.ok) {
        const message =
          instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid;
        setFormError(message);
        announce(message);
        return;
      }
      patch = { ...patch, observedAt: instant.observedAt, timeZone };
    }
    if (patch.quantity === undefined && patch.observedAt === undefined) {
      setFormError(WATER_COPY.nothingChanged);
      announce(WATER_COPY.nothingChanged);
      return;
    }
    const queued = onEnqueue({
      kind: "change",
      input: {
        clientMutationId: newClientMutationId(),
        id: editing.entryId,
        expectedRevision: editing.revision,
        ...patch,
      },
    });
    setFormError(null);
    if (queued) setEditing(null);
  };

  const removeRow = (row: WaterDayRow) => {
    // Discard is permitted only when the queue can prove the operation is
    // cancellable; uncertain or in-flight writes stay available for resolution.
    if (row.state !== "synced" && row.pendingOpId) {
      const item = outbox.items.find((entry) => entry.id === row.pendingOpId);
      if (!item || !canDiscardWaterItem(item) || !outbox.discard(row.pendingOpId)) return;
      setConfirming(null);
      announce("Change discarded on this device.");
      return;
    }
    if (row.entryId === null || row.revision === null) return;
    onEnqueue({
      kind: "delete",
      input: {
        clientMutationId: newClientMutationId(),
        id: row.entryId,
        expectedRevision: row.revision,
      },
    });
    setConfirming(null);
  };

  const submitGoal = async (clear: boolean) => {
    if (clear) {
      setGoalError(null);
      await onSaveGoal(null);
      return;
    }
    const parsed = parseWaterGoal(goalText, unit);
    if (!parsed.ok) {
      setGoalError(parsed.error);
      announce(parsed.error);
      return;
    }
    setGoalError(null);
    await onSaveGoal(parsed.personalGoalMl);
  };

  return (
    <>
      <View
        className="gap-1 rounded-lg border border-border p-3"
        accessible
        accessibilityLabel={describeWaterSubtotal(view, unit, hideNumbers)}
      >
        <View className="flex-row flex-wrap items-baseline justify-between gap-2">
          <Text className="text-sm text-muted-foreground">{WATER_COPY.subtotalLabel}</Text>
          <Text className="font-mono text-lg text-foreground">
            {formatWaterSubtotal(view, unit, hideNumbers)}
          </Text>
        </View>
        <View className="flex-row flex-wrap items-baseline justify-between gap-2">
          <Text className="text-sm text-foreground">
            {WATER_COPY.goalLabel}:{" "}
            <Text className="font-mono">
              {formatWaterGoal(view.personalGoalMl, unit, hideNumbers)}
            </Text>
          </Text>
          <Text className="text-xs text-muted-foreground">{WATER_COPY.goalNote}</Text>
        </View>
        {hideNumbers ? (
          <Text className="text-xs text-muted-foreground">{WATER_COPY.hiddenNote}</Text>
        ) : (
          <UnitChoice value={unit} onChange={onUnitChange} />
        )}
      </View>

      {view.pendingRemovalCount > 0 ? (
        <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">
          {view.pendingRemovalCount === 1
            ? "1 removal waiting to sync."
            : `${view.pendingRemovalCount} removals waiting to sync.`}
        </Text>
      ) : null}

      {view.rows.length === 0 ? (
        <Text className="text-sm text-muted-foreground">
          {view.reconciliationUnknown ? WATER_COPY.reconciliationUnknown : WATER_COPY.empty}
        </Text>
      ) : (
        view.rows.map((row) => (
          <View
            key={row.key}
            className="gap-2 rounded-lg border border-border p-3"
            accessible
            accessibilityLabel={describeWaterRow(row, unit, hideNumbers)}
          >
            <View className="flex-row flex-wrap items-baseline justify-between gap-2">
              <Text className="font-mono text-sm text-muted-foreground">
                {formatObservedClock(row.observedAt, timeZone) ?? row.observedAt}
              </Text>
              <Text className="font-mono text-sm text-foreground">
                {formatWaterAmount(row.quantityMl, unit, hideNumbers)}
              </Text>
              {row.state === "synced" ? null : (
                <Text className="text-xs text-muted-foreground">
                  {row.state === "syncing"
                    ? WATER_COPY.rowSyncing
                    : row.state === "needs_attention"
                      ? WATER_COPY.rowNeedsAttention
                      : WATER_COPY.rowQueued}
                </Text>
              )}
            </View>

            <View className="flex-row flex-wrap gap-2">
              {row.state === "synced" && !row.local ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setConfirming(null);
                      setFormError(null);
                      setEditing({
                        entryId: row.entryId as number,
                        revision: row.revision as number,
                        // A hidden row carries no amount, so the field starts blank.
                        amount: String(waterAmountValue(row.quantityMl, unit) ?? ""),
                        amountDirty: false,
                        unit,
                        clock: formatObservedClock(row.observedAt, timeZone) ?? "",
                        originalClock: formatObservedClock(row.observedAt, timeZone) ?? "",
                      });
                    }}
                  >
                    {WATER_COPY.edit}
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => setConfirming(row.key)}>
                    {WATER_COPY.delete}
                  </Button>
                </>
              ) : null}
              {row.state !== "synced" &&
              row.pendingOpId &&
              (() => {
                const item = outbox.items.find((entry) => entry.id === row.pendingOpId);
                return item ? canDiscardWaterItem(item) : false;
              })() ? (
                <Button size="sm" variant="secondary" onPress={() => setConfirming(row.key)}>
                  {WATER_COPY.discard}
                </Button>
              ) : null}
            </View>

            {confirming === row.key ? (
              <View className="gap-2 rounded-lg border border-border p-3">
                <Text className="text-sm text-foreground">
                  {row.state !== "synced"
                    ? row.local
                      ? WATER_COPY.deleteConfirmLocal
                      : WATER_COPY.discardConfirm
                    : WATER_COPY.deleteConfirm}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Button size="sm" onPress={() => removeRow(row)}>
                    {row.state !== "synced" ? WATER_COPY.confirmDiscard : WATER_COPY.confirmDelete}
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => setConfirming(null)}>
                    {WATER_COPY.cancel}
                  </Button>
                </View>
              </View>
            ) : null}

            {editing?.entryId === row.entryId && row.entryId !== null ? (
              <View className="gap-2 rounded-lg border border-border p-3">
                {hideNumbers ? (
                  <Text className="text-xs text-muted-foreground">{WATER_COPY.editHiddenNote}</Text>
                ) : null}
                <TextInput
                  className={inputClass}
                  value={editing.amount}
                  onChangeText={(value) =>
                    setEditing((current) => (current ? editAmountChanged(current, value) : current))
                  }
                  placeholder={WATER_COPY.amountPlaceholder}
                  placeholderTextColor="#8b8b8b"
                  keyboardType="decimal-pad"
                  accessibilityLabel={WATER_COPY.amountLabel}
                />
                <UnitChoice
                  value={editing.unit}
                  onChange={(next) =>
                    setEditing((current) => (current ? editUnitChanged(current, next) : current))
                  }
                />
                <TextInput
                  className={inputClass}
                  value={editing.clock}
                  onChangeText={(value) =>
                    setEditing((current) => (current ? { ...current, clock: value } : current))
                  }
                  placeholder={WATER_COPY.timePlaceholder}
                  placeholderTextColor="#8b8b8b"
                  maxLength={5}
                  accessibilityLabel={WATER_COPY.timeLabel}
                />
                <View className="flex-row flex-wrap gap-2">
                  <Button size="sm" onPress={submitEdit} isDisabled={outbox.busy}>
                    {WATER_COPY.save}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setEditing(null);
                      setFormError(null);
                    }}
                  >
                    {WATER_COPY.cancel}
                  </Button>
                </View>
              </View>
            ) : null}
          </View>
        ))
      )}

      {formError ? (
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {formError}
        </Text>
      ) : null}

      {addOpen ? (
        <View className="gap-2 rounded-lg border border-border p-3">
          <TextInput
            className={inputClass}
            value={amount}
            onChangeText={setAmount}
            placeholder={WATER_COPY.amountPlaceholder}
            placeholderTextColor="#8b8b8b"
            keyboardType="decimal-pad"
            accessibilityLabel={WATER_COPY.amountLabel}
          />
          <UnitChoice value={addUnit} onChange={setAddUnit} />
          <View className="flex-row items-end gap-2">
            <TextInput
              className={`${inputClass} flex-1`}
              value={clock}
              onChangeText={setClock}
              placeholder={WATER_COPY.timePlaceholder}
              placeholderTextColor="#8b8b8b"
              maxLength={5}
              accessibilityLabel={WATER_COPY.timeLabel}
            />
            <Button
              size="sm"
              variant="secondary"
              onPress={() =>
                setClock(formatObservedClock(new Date().toISOString(), timeZone) ?? clock)
              }
            >
              {WATER_COPY.useNow}
            </Button>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button size="sm" onPress={submitAdd}>
              {WATER_COPY.save}
            </Button>
            <Button size="sm" variant="secondary" onPress={() => setAddOpen(false)}>
              {WATER_COPY.cancel}
            </Button>
          </View>
        </View>
      ) : (
        <View className="flex-row">
          <Button
            size="sm"
            onPress={() => {
              setAddOpen(true);
              setAmount("");
              setAddUnit(unit);
              setClock(formatObservedClock(new Date().toISOString(), timeZone) ?? "12:00");
              setFormError(null);
            }}
          >
            {WATER_COPY.add}
          </Button>
        </View>
      )}

      <View className="gap-2 rounded-lg border border-border p-3">
        <Text className="text-sm font-medium text-foreground">{WATER_COPY.goalLabel}</Text>
        {hideNumbers ? (
          <Text className="text-xs text-muted-foreground">{WATER_COPY.editGoalHiddenNote}</Text>
        ) : null}
        <View className="flex-row items-end gap-2">
          <TextInput
            className={`${inputClass} flex-1`}
            value={goalText}
            onChangeText={setGoalText}
            placeholder={WATER_COPY.goalAmountPlaceholder}
            placeholderTextColor="#8b8b8b"
            keyboardType="decimal-pad"
            accessibilityLabel={WATER_COPY.goalAmountLabel}
          />
          {hideNumbers ? null : (
            <Text className="pb-3 text-sm text-muted-foreground">{WATER_UNIT_LABELS[unit]}</Text>
          )}
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Button size="sm" onPress={() => void submitGoal(false)} isDisabled={settingsBusy}>
            {settingsBusy ? WATER_COPY.saving : WATER_COPY.setGoal}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void submitGoal(true)}
            isDisabled={settingsBusy || (view.personalGoalMl === null && !hideNumbers)}
          >
            {WATER_COPY.clearGoal}
          </Button>
        </View>
        {goalError ? (
          <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
            {goalError}
          </Text>
        ) : null}
        <Text className="text-xs text-muted-foreground">{WATER_COPY.goalNote}</Text>
      </View>
    </>
  );
}
