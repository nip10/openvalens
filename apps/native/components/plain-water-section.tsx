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
import type { MessageDescriptor } from "@lingui/core";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { GlassWater, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useThemeColor } from "@/utils/theme";

import { Details, ErrorState, Icon, InfoTip, Section, StatusPill } from "./bloom";

/**
 * Plain water (Issue #83) on mobile, between the day's targets and the meal add
 * flow. Every write goes through the durable outbox (lib/plain-water), so it
 * works the same online and offline, and is shown with its sync state. The
 * card records plain water only: never part of meal totals, never a verdict,
 * and never a goal the member did not set.
 */

const inputClass =
  "min-h-11 rounded-xl border border-rule bg-sheet px-3 font-sans text-base text-ink";

/** A quiet placeholder while the day loads. */
function Loading() {
  const { t } = useLingui();
  return (
    <View className="h-20 justify-center rounded-2xl bg-paper-2 px-4">
      <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
    </View>
  );
}

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
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? "border-water bg-water-soft" : "border-rule bg-sheet"}`}
    >
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
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
  const { t, i18n } = useLingui();
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
    if (outbox.error) return false;
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
        i18n._(
          "enabled" in input
            ? input.enabled
              ? WATER_COPY.turnedOn
              : WATER_COPY.turnedOff
            : "personalGoal" in input && input.personalGoal === null
              ? WATER_COPY.goalCleared
              : WATER_COPY.goalSaved,
        ),
      );
      void refresh();
      return true;
    } catch {
      if (!active.current) return false;
      setNotice(i18n._(WATER_COPY.settingsError));
      announce(i18n._(WATER_COPY.settingsError));
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
      setNotice(i18n._(WATER_COPY.storageSaveError));
      announce(i18n._(WATER_COPY.storageSaveError));
      return false;
    }
    announce(i18n._(WATER_COPY.savedOnDevice));
    return true;
  };

  const keepMine = (item: WaterAttention) => {
    const queued = outbox.items.find((entry) => entry.id === item.id);
    if (!queued) return;
    setNotice(null);
    const applied = retryWaterConflict({ resolveConflict: outbox.resolveConflict }, queued);
    if (!applied) {
      const message = t`Could not confirm conflict resolution on this device. Review the queued water changes before trying again.`;
      setNotice(message);
      announce(message);
      return;
    }
    announce(i18n._(WATER_COPY.savedOnDevice));
  };

  return (
    <Section
      icon={GlassWater}
      tone="water"
      sheet
      title={i18n._(WATER_COPY.title)}
      info={i18n._(WATER_COPY.scopeNote)}
      actions={
        enabled === false ? (
          <StatusPill tone="neutral">{i18n._(WATER_COPY.optional)}</StatusPill>
        ) : null
      }
    >
      {outbox.error ? (
        <ErrorState
          title={i18n._(WATER_COPY.storageError)}
          action={
            <Button size="sm" variant="outline" onPress={() => void outbox.syncNow()}>
              <Button.Label>{i18n._(WATER_COPY.retry)}</Button.Label>
            </Button>
          }
        />
      ) : null}

      {!outbox.error ? (
        <View className="gap-4">
          {notice ? (
            <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}

          {counts.queued + counts.syncing + counts.attention > 0 ? (
            <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-paper-2 px-4 py-3">
              <Text
                className="flex-1 font-sans text-sm text-ink-2"
                accessibilityLiveRegion="polite"
              >
                {`${i18n._(WATER_COPY.pendingTitle)}: `}
                {[
                  counts.queued
                    ? t`${plural(counts.queued, { one: "# queued", other: "# queued" })}`
                    : null,
                  counts.syncing
                    ? t`${plural(counts.syncing, { one: "# syncing", other: "# syncing" })}`
                    : null,
                  counts.attention
                    ? t`${plural(counts.attention, {
                        one: "# needs attention",
                        other: "# need attention",
                      })}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
              <Button size="sm" variant="outline" onPress={() => void outbox.syncNow()}>
                <Icon icon={RefreshCw} size={16} color="ink-2" />
                <Button.Label>{i18n._(WATER_COPY.syncNow)}</Button.Label>
              </Button>
            </View>
          ) : null}

          {attention.map((item) => {
            const copy = describeWaterAttention(item, unit, i18n);
            const queued = outbox.items.find((entry) => entry.id === item.id);
            const discardable = queued ? canDiscardWaterItem(queued) : false;
            return (
              <View key={item.id} className="gap-2 rounded-2xl bg-warning/10 px-4 py-3">
                <Text
                  className="font-display text-base font-medium text-ink"
                  accessibilityRole="alert"
                >
                  {copy.title}
                </Text>
                {copy.other ? (
                  <Text className="font-sans text-sm text-ink-2">{copy.other}</Text>
                ) : null}
                <Text className="font-sans text-sm text-ink-2">{copy.mine}</Text>
                {!item.isConflict ? (
                  <Text className="font-sans text-sm text-ink-3">
                    {i18n._(WATER_COPY.rejectedBody)}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  {item.isConflict ? (
                    <>
                      <Button size="sm" variant="secondary" onPress={() => keepMine(item)}>
                        <Button.Label>{i18n._(WATER_COPY.keepMine)}</Button.Label>
                      </Button>
                      {discardable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={() => {
                            if (outbox.discard(item.id)) announce(i18n._(WATER_COPY.keepOther));
                          }}
                        >
                          <Button.Label>{i18n._(WATER_COPY.keepOther)}</Button.Label>
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onPress={() => outbox.retry(item.id)}>
                        <Button.Label>{i18n._(WATER_COPY.retry)}</Button.Label>
                      </Button>
                      {discardable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={() => {
                            if (outbox.discard(item.id))
                              announce(t`Change discarded on this device.`);
                          }}
                        >
                          <Button.Label>{i18n._(WATER_COPY.discard)}</Button.Label>
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
              <Loading />
            ) : (
              <ErrorState
                title={i18n._(WATER_COPY.readError)}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      void day.refetch();
                      void preferences.refetch();
                    }}
                  >
                    <Button.Label>{i18n._(WATER_COPY.retry)}</Button.Label>
                  </Button>
                }
              />
            )
          ) : enabled === false ? (
            <View className="gap-2">
              <Text className="font-display text-base font-medium text-ink">
                {i18n._(WATER_COPY.offTitle)}
              </Text>
              <Text className="font-sans text-sm text-ink-3">{i18n._(WATER_COPY.offBody)}</Text>
              <View className="flex-row pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => void saveSettings({ enabled: true })}
                >
                  <Button.Label>{i18n._(WATER_COPY.turnOn)}</Button.Label>
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
              settingsSwitch={
                <View className="min-h-11 flex-row items-center justify-between gap-3">
                  <Text className="flex-1 font-sans text-sm text-ink-2">
                    {i18n._(WATER_COPY.settingsTitle)}
                  </Text>
                  <Switch
                    value={true}
                    onValueChange={(value) => void saveSettings({ enabled: value })}
                    disabled={savingSettings}
                    accessibilityLabel={i18n._(WATER_COPY.settingsTitle)}
                  />
                </View>
              }
            />
          )}
        </View>
      ) : null}
    </Section>
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
  settingsSwitch,
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
  settingsSwitch: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
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
    return <Loading />;
  }

  const fail = (set: (message: string) => void, error: MessageDescriptor) => {
    const message = i18n._(error);
    set(message);
    announce(message);
  };

  const submitAdd = () => {
    const parsed = parseWaterAmount(amount, addUnit);
    if (!parsed.ok) {
      fail(setFormError, parsed.error);
      return;
    }
    const instant = waterDateInstant(localDate, clock, timeZone);
    if (!instant.ok) {
      const message = i18n._(
        instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid,
      );
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
      fail(setFormError, amountPatch.error);
      return;
    }
    patch = amountPatch.patch;
    if (editing.clock !== editing.originalClock) {
      const instant = waterDateInstant(localDate, editing.clock, timeZone);
      if (!instant.ok) {
        const message = i18n._(
          instant.reason === "nonexistent" ? WATER_COPY.timeNonexistent : WATER_COPY.timeInvalid,
        );
        setFormError(message);
        announce(message);
        return;
      }
      patch = { ...patch, observedAt: instant.observedAt, timeZone };
    }
    if (patch.quantity === undefined && patch.observedAt === undefined) {
      fail(setFormError, WATER_COPY.nothingChanged);
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
      announce(t`Change discarded on this device.`);
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
      fail(setGoalError, parsed.error);
      return;
    }
    setGoalError(null);
    await onSaveGoal(parsed.personalGoalMl);
  };

  const canDiscard = (row: WaterDayRow) => {
    if (row.state === "synced" || !row.pendingOpId) return false;
    const item = outbox.items.find((entry) => entry.id === row.pendingOpId);
    return item ? canDiscardWaterItem(item) : false;
  };

  const subtotalText = formatWaterSubtotal(view, unit, hideNumbers, i18n);

  return (
    <>
      <View
        className="gap-3"
        accessible
        accessibilityLabel={describeWaterSubtotal(view, unit, hideNumbers, i18n)}
      >
        <View className="gap-1">
          <Text className="font-sans text-sm text-ink-3">{i18n._(WATER_COPY.subtotalLabel)}</Text>
          {/* A figure is set large; a sentence ("Nothing logged…") stays body size. */}
          <Text
            className={
              /\d/.test(subtotalText)
                ? "font-display text-[34px] font-medium leading-[40px] text-ink"
                : "font-display text-lg font-medium text-ink-2"
            }
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {subtotalText}
          </Text>
        </View>
        {/* The goal sits beside the total as text, never as a bar or ring. */}
        <View className="flex-row flex-wrap items-center gap-1">
          <Text className="font-sans text-sm text-ink-2">
            {t`Personal goal:`}{" "}
            <Text
              className="font-sans font-semibold text-ink"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatWaterGoal(view.personalGoalMl, unit, hideNumbers, i18n)}
            </Text>
          </Text>
          <InfoTip title={i18n._(WATER_COPY.goalLabel)}>{i18n._(WATER_COPY.goalNote)}</InfoTip>
        </View>
        {hideNumbers ? (
          <Text className="font-sans text-sm text-ink-3">{i18n._(WATER_COPY.hiddenNote)}</Text>
        ) : (
          <UnitChoice value={unit} onChange={onUnitChange} />
        )}
      </View>

      {view.pendingRemovalCount > 0 ? (
        <Text className="font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
          {t`${plural(view.pendingRemovalCount, {
            one: "# removal waiting to sync.",
            other: "# removals waiting to sync.",
          })}`}
        </Text>
      ) : null}

      {view.rows.length === 0 ? (
        <Text className="font-sans text-sm text-ink-3">
          {i18n._(view.reconciliationUnknown ? WATER_COPY.reconciliationUnknown : WATER_COPY.empty)}
        </Text>
      ) : (
        <View className="border-t border-rule">
          {view.rows.map((row) => (
            <View
              key={row.key}
              className="gap-2 border-b border-rule py-3"
              accessible
              accessibilityLabel={describeWaterRow(row, unit, hideNumbers, i18n)}
            >
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <View className="flex-row flex-wrap items-center gap-3">
                  <View className="rounded-full bg-water-soft px-2.5 py-1">
                    <Text
                      className="font-sans text-sm font-semibold text-ink"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {formatWaterAmount(row.quantityMl, unit, hideNumbers, i18n)}
                    </Text>
                  </View>
                  <Text
                    className="font-sans text-sm text-ink-3"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {formatObservedClock(row.observedAt, timeZone) ?? row.observedAt}
                  </Text>
                  {row.state === "synced" ? null : (
                    <StatusPill tone={row.state === "needs_attention" ? "warn" : "neutral"}>
                      {i18n._(
                        row.state === "syncing"
                          ? WATER_COPY.rowSyncing
                          : row.state === "needs_attention"
                            ? WATER_COPY.rowNeedsAttention
                            : WATER_COPY.rowQueued,
                      )}
                    </StatusPill>
                  )}
                </View>

                <View className="flex-row flex-wrap gap-1">
                  {row.state === "synced" && !row.local ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
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
                        <Icon icon={Pencil} size={16} color="ink-3" />
                        <Button.Label>{i18n._(WATER_COPY.edit)}</Button.Label>
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => setConfirming(row.key)}>
                        <Icon icon={Trash2} size={16} color="ink-3" />
                        <Button.Label>{i18n._(WATER_COPY.delete)}</Button.Label>
                      </Button>
                    </>
                  ) : null}
                  {canDiscard(row) ? (
                    <Button size="sm" variant="ghost" onPress={() => setConfirming(row.key)}>
                      <Button.Label>{i18n._(WATER_COPY.discard)}</Button.Label>
                    </Button>
                  ) : null}
                </View>
              </View>

              {confirming === row.key ? (
                <View className="gap-2 rounded-2xl bg-destructive/5 px-4 py-3">
                  <Text className="font-sans text-sm text-ink">
                    {i18n._(
                      row.state !== "synced"
                        ? row.local
                          ? WATER_COPY.deleteConfirmLocal
                          : WATER_COPY.discardConfirm
                        : WATER_COPY.deleteConfirm,
                    )}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button size="sm" variant="danger" onPress={() => removeRow(row)}>
                      <Button.Label>
                        {i18n._(
                          row.state !== "synced"
                            ? WATER_COPY.confirmDiscard
                            : WATER_COPY.confirmDelete,
                        )}
                      </Button.Label>
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => setConfirming(null)}>
                      <Button.Label>{i18n._(WATER_COPY.cancel)}</Button.Label>
                    </Button>
                  </View>
                </View>
              ) : null}

              {editing?.entryId === row.entryId && row.entryId !== null ? (
                <View className="gap-2 rounded-2xl bg-paper-2 p-4">
                  {hideNumbers ? (
                    <Text className="font-sans text-sm text-ink-3">
                      {i18n._(WATER_COPY.editHiddenNote)}
                    </Text>
                  ) : null}
                  <TextInput
                    className={inputClass}
                    value={editing.amount}
                    onChangeText={(value) =>
                      setEditing((current) =>
                        current ? editAmountChanged(current, value) : current,
                      )
                    }
                    placeholder={i18n._(WATER_COPY.amountPlaceholder)}
                    placeholderTextColor={placeholder}
                    keyboardType="decimal-pad"
                    accessibilityLabel={i18n._(WATER_COPY.amountLabel)}
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
                    placeholder={i18n._(WATER_COPY.timePlaceholder)}
                    placeholderTextColor={placeholder}
                    maxLength={5}
                    accessibilityLabel={i18n._(WATER_COPY.timeLabel)}
                  />
                  <View className="flex-row flex-wrap gap-2">
                    <Button size="sm" onPress={submitEdit} isDisabled={outbox.busy}>
                      <Button.Label>{i18n._(WATER_COPY.save)}</Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setEditing(null);
                        setFormError(null);
                      }}
                    >
                      <Button.Label>{i18n._(WATER_COPY.cancel)}</Button.Label>
                    </Button>
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {formError ? (
        <Text className="font-sans text-sm text-destructive" accessibilityLiveRegion="polite">
          {formError}
        </Text>
      ) : null}

      {addOpen ? (
        <View className="gap-2 rounded-2xl bg-paper-2 p-4">
          <TextInput
            className={inputClass}
            value={amount}
            onChangeText={setAmount}
            placeholder={i18n._(WATER_COPY.amountPlaceholder)}
            placeholderTextColor={placeholder}
            keyboardType="decimal-pad"
            accessibilityLabel={i18n._(WATER_COPY.amountLabel)}
          />
          <UnitChoice value={addUnit} onChange={setAddUnit} />
          <View className="flex-row items-center gap-2">
            <TextInput
              className={`${inputClass} flex-1`}
              value={clock}
              onChangeText={setClock}
              placeholder={i18n._(WATER_COPY.timePlaceholder)}
              placeholderTextColor={placeholder}
              maxLength={5}
              accessibilityLabel={i18n._(WATER_COPY.timeLabel)}
            />
            <Button
              size="sm"
              variant="outline"
              onPress={() =>
                setClock(formatObservedClock(new Date().toISOString(), timeZone) ?? clock)
              }
            >
              <Button.Label>{i18n._(WATER_COPY.useNow)}</Button.Label>
            </Button>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button size="sm" onPress={submitAdd}>
              <Button.Label>{i18n._(WATER_COPY.save)}</Button.Label>
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setAddOpen(false)}>
              <Button.Label>{i18n._(WATER_COPY.cancel)}</Button.Label>
            </Button>
          </View>
        </View>
      ) : (
        <View className="flex-row">
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              setAddOpen(true);
              setAmount("");
              setAddUnit(unit);
              setClock(formatObservedClock(new Date().toISOString(), timeZone) ?? "12:00");
              setFormError(null);
            }}
          >
            <Icon icon={Plus} size={16} color="water" />
            <Button.Label>{i18n._(WATER_COPY.add)}</Button.Label>
          </Button>
        </View>
      )}

      <Details summary={i18n._(WATER_COPY.settingsTitle)}>
        <View className="gap-3">
          {settingsSwitch}
          <View className="gap-2 rounded-2xl bg-paper-2 p-4">
            <Text className="font-display text-sm font-medium text-ink">
              {i18n._(WATER_COPY.goalLabel)}
            </Text>
            {hideNumbers ? (
              <Text className="font-sans text-sm text-ink-3">
                {i18n._(WATER_COPY.editGoalHiddenNote)}
              </Text>
            ) : null}
            <View className="flex-row items-center gap-2">
              <TextInput
                className={`${inputClass} flex-1`}
                value={goalText}
                onChangeText={setGoalText}
                placeholder={i18n._(WATER_COPY.goalAmountPlaceholder)}
                placeholderTextColor={placeholder}
                keyboardType="decimal-pad"
                accessibilityLabel={i18n._(WATER_COPY.goalAmountLabel)}
              />
              {hideNumbers ? null : (
                <Text className="font-sans text-sm text-ink-3">{WATER_UNIT_LABELS[unit]}</Text>
              )}
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onPress={() => void submitGoal(false)}
                isDisabled={settingsBusy}
              >
                <Button.Label>
                  {i18n._(settingsBusy ? WATER_COPY.saving : WATER_COPY.setGoal)}
                </Button.Label>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => void submitGoal(true)}
                isDisabled={settingsBusy || (view.personalGoalMl === null && !hideNumbers)}
              >
                <Button.Label>{i18n._(WATER_COPY.clearGoal)}</Button.Label>
              </Button>
            </View>
            {goalError ? (
              <Text className="font-sans text-sm text-destructive" accessibilityLiveRegion="polite">
                {goalError}
              </Text>
            ) : null}
            <Text className="font-sans text-sm text-ink-3">{i18n._(WATER_COPY.goalNote)}</Text>
          </View>
        </View>
      </Details>
    </>
  );
}
