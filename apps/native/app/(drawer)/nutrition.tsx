import {
  MEAL_SLOTS,
  type AmountUnit,
  type DiaryEntry,
  type FoodChoice,
  type FoodRef,
  type LogEntryInput,
  type MealSlot,
  type NutrientKey,
} from "@openvalens/api/contracts/nutrition-diary";
import type { BarcodeLookup } from "@openvalens/api/contracts/nutrition-foods";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import { CUSTOM_FOOD_COPY } from "@openvalens/api/presenters/custom-foods";
import {
  BARCODE_COPY,
  candidateFromChoice,
  isSearchable,
  manualDraftFields,
  missingDataNote,
  searchCandidates,
  type BarcodeOutcome,
  type FoodCandidate,
} from "@openvalens/api/presenters/food-lookup";
import {
  DIARY_COPY,
  NUTRIENT_LABELS,
  SLOT_LABELS,
  SUMMARY_NUTRIENTS,
  SYNC_STATE_LABELS,
  dayStatusText,
  deviceTimeZone,
  foodSourceLabel,
  formatAmount,
  formatNutrientValue,
  localDateIn,
  newClientMutationId,
  parseQuickAdd,
  previewNutrients,
  shiftLocalDate,
  summarizeDay,
  unitsFor,
  type DiarySyncState,
  type QuickAddFields,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  HIDDEN_VALUE,
  TARGET_COPY,
  describeTargetSource,
  formatTarget,
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import { Link } from "expo-router";
import { Button, Card, Spinner } from "heroui-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, Text, TextInput, View } from "react-native";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { Container } from "@/components/container";
import { NutritionDayTotals } from "@/components/nutrition-day-totals";
import { PlainWaterSection } from "@/components/plain-water-section";
import { barcodeCacheKey, resolveBarcode } from "@/lib/nutrition/barcode";
import { mergeDay, type DiaryRow, type QueuedChange } from "@/lib/nutrition/outbox";
import { DIARY_CACHE_PREFIX, useDiaryOutbox, type DiaryOutbox } from "@/lib/nutrition/sync";
import { completeAddFoodCreation, useAddFoodSaveLifecycle } from "@/lib/nutrition/save-intent";
import { readCache, writeCache } from "@/lib/offline/cache";
import {
  isOfflineWriteTicketCurrent,
  useCacheFirst,
  useOfflineWriteSessionKey,
} from "@/lib/offline/sync";
import { client, orpc } from "@/utils/orpc";

/**
 * Meal diary (Issue #77) with food search and barcode scan/lookup (#75).
 * Every write goes through the durable outbox
 * (lib/nutrition), so logging works the same online and offline: changes are
 * saved on the device first, shown with their sync state, and replayed
 * idempotently. Copy is neutral and never judges food or completeness.
 */

const inputClass =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

function SyncBadge({ state }: { state: DiarySyncState }) {
  if (state === "synced") return null;
  return (
    <Text
      className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
      accessibilityLabel={`Sync state: ${SYNC_STATE_LABELS[state]}`}
    >
      {SYNC_STATE_LABELS[state]}
    </Text>
  );
}

function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-lg border px-3 ${selected ? "border-foreground bg-accent" : "border-border"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

function rowNutrients(row: DiaryRow) {
  if (row.kind === "server") return row.entry.nutrients;
  return row.change.preview?.nutrients ?? null;
}

export default function NutritionScreen() {
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const [localDate, setLocalDate] = useState(() => localDateIn(timeZone));
  const outbox = useDiaryOutbox();
  const sessionKey = useOfflineWriteSessionKey();
  const day = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${localDate}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate } }),
  );
  const foods = useCacheFirst(
    `${DIARY_CACHE_PREFIX}foods`,
    orpc.nutritionDiary.listFoods.queryOptions({ input: {} }),
  );
  const targetOptions = orpc.nutritionTargets.get.queryOptions({
    input: { localDate },
  });
  const targets = useQuery({
    ...targetOptions,
    queryKey: [...targetOptions.queryKey, { offlineScope: outbox.scope }],
    enabled: Boolean(outbox.scope),
  });
  const cachedDisplayPreference = outbox.scope
    ? readCache<{ hideNumbers: boolean }>(outbox.scope, "nutrition-display-preference")?.data
        .hideNumbers
    : undefined;
  useEffect(() => {
    if (outbox.scope && targets.data?.settings) {
      writeCache(outbox.scope, "nutrition-display-preference", {
        hideNumbers: targets.data.settings.hideNumbers,
      });
    }
  }, [outbox.scope, targets.data?.settings]);
  // Until this member's preference is known (including offline and date changes),
  // don't render numeric diary data.
  const hideNumbers = resolveHideNumbers(
    targets.isSuccess ? targets.data.settings.hideNumbers : undefined,
    cachedDisplayPreference,
  );
  const [undo, setUndo] = useState<{
    entryId: number;
    revision: number;
    name: string;
  } | null>(null);

  const rows = mergeDay(day.data?.entries ?? [], outbox.items, localDate);
  const visible = rows.filter((row) => !(row.kind === "server" && row.pendingKind === "delete"));
  const totalsInput = visible.map((row) => ({
    nutrients: rowNutrients(row) ?? emptyNutrients(),
  }));
  // Server totals (#79) unless queued changes touch this day; then a local
  // preview with the same domain summary, labelled as pending.
  const pendingRows = rows.some((row) => row.kind === "local" || row.pendingKind !== null);
  const serverSummary = day.data?.summary;
  const summary = serverSummary && !pendingRows ? serverSummary : summarizeDay(totalsInput);
  const summarySources = serverSummary && !pendingRows ? serverSummary.sources : null;
  const pendingStatus = outbox.items.find(
    (item) => item.op.kind === "setDayStatus" && item.op.input.localDate === localDate,
  );
  const status =
    pendingStatus?.op.kind === "setDayStatus"
      ? pendingStatus.op.input.complete
        ? "complete"
        : "unmarked"
      : (day.data?.status ?? "unmarked");
  const statusText = dayStatusText(status, visible.length);
  const attention = outbox.items.filter((item) => item.status === "needs_attention");

  const go = (date: string) => {
    setLocalDate(date);
    announce(`Showing ${date}`);
  };

  const toggleStatus = () => {
    const complete = status !== "complete";
    outbox.enqueue({
      op: {
        kind: "setDayStatus",
        input: { clientMutationId: newClientMutationId(), localDate, complete },
      },
    });
    announce(`${localDate}: ${dayStatusText(complete ? "complete" : "unmarked", 0).label}`);
  };

  const remove = (row: DiaryRow) => {
    if (row.kind === "local") {
      outbox.enqueue({
        op: {
          kind: "delete",
          input: {
            clientMutationId: newClientMutationId(),
            entryId: row.key as never,
          },
        },
      });
      announce(`${DIARY_COPY.deleted} ${row.change.preview?.name ?? ""}`);
      return;
    }
    outbox.enqueue({
      op: {
        kind: "delete",
        input: {
          clientMutationId: newClientMutationId(),
          entryId: row.entry.id,
          expectedRevision: row.entry.revision,
        },
      },
    });
    setUndo({
      entryId: row.entry.id,
      revision: row.entry.revision + 1,
      name: row.entry.food.name,
    });
    announce(`${DIARY_COPY.deleted} ${row.entry.food.name}`);
  };

  const undoDelete = () => {
    if (!undo) return;
    outbox.enqueue({
      op: {
        kind: "restore",
        input: {
          clientMutationId: newClientMutationId(),
          entryId: undo.entryId,
          expectedRevision: undo.revision,
        },
      },
    });
    announce(`${DIARY_COPY.restored} ${undo.name}`);
    setUndo(null);
  };

  const clearDeviceData = () =>
    Alert.alert(
      DIARY_COPY.clearCache,
      outbox.items.length > 0
        ? `${outbox.items.length} unsynced changes will be removed from this device.`
        : "Cached diary data will be removed from this device. Saved entries stay on the server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            outbox.clearDeviceData();
            announce("Diary data cleared from this device");
          },
        },
      ],
    );

  return (
    <Container>
      <View className="gap-5 p-4">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Chip
            label="Previous"
            selected={false}
            onPress={() => go(shiftLocalDate(localDate, -1))}
          />
          <Text className="font-mono text-lg text-foreground" accessibilityRole="header">
            {localDate}
          </Text>
          <Chip label="Next" selected={false} onPress={() => go(shiftLocalDate(localDate, 1))} />
        </View>

        <Link href="/foods" asChild>
          <Pressable accessibilityRole="link" className="min-h-11 justify-center">
            <Text className="text-sm text-foreground underline">{CUSTOM_FOOD_COPY.manageLink}</Text>
          </Pressable>
        </Link>
        <Link href="/nutrition-targets" asChild>
          <Pressable accessibilityRole="link" className="min-h-11 justify-center">
            <Text className="text-sm text-foreground underline">{TARGET_COPY.settingsLink}</Text>
          </Pressable>
        </Link>

        <OutboxBanner outbox={outbox} />

        {attention.map((item) => (
          <AttentionCard key={item.id} item={item} outbox={outbox} hideNumbers={hideNumbers} />
        ))}

        {undo ? (
          <Card variant="secondary" className="flex-row items-center justify-between p-3">
            <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
              {DIARY_COPY.deleted} {undo.name}
            </Text>
            <Button size="sm" variant="secondary" onPress={undoDelete}>
              {DIARY_COPY.undo}
            </Button>
          </Card>
        ) : null}

        {day.isPending && !day.data ? (
          <Spinner />
        ) : day.isError && !day.data ? (
          <Pressable onPress={() => void day.refetch()} accessibilityRole="button">
            <Text className="text-sm text-muted-foreground">
              {DIARY_COPY.networkError} {DIARY_COPY.retry}
            </Text>
          </Pressable>
        ) : null}

        <Card variant="secondary" className="gap-3 p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="font-medium text-foreground" accessibilityLiveRegion="polite">
                {statusText.label}
                {pendingStatus ? ` · ${SYNC_STATE_LABELS[pendingStatus.status]}` : ""}
              </Text>
              <Text className="text-sm text-muted-foreground">{statusText.description}</Text>
            </View>
            <Button size="sm" variant="secondary" onPress={toggleStatus}>
              {status === "complete" ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete}
            </Button>
          </View>
          <NutritionDayTotals
            totals={summary.totals}
            sources={summarySources}
            pending={pendingRows}
            hideNumbers={hideNumbers}
          />
        </Card>

        <TargetsOnDay targets={targets.data?.targetsOn.targets ?? []} hideNumbers={hideNumbers} />

        <PlainWaterSection
          key={`${outbox.scope ?? "signed-out"}:${localDate}:${timeZone}`}
          localDate={localDate}
          timeZone={timeZone}
          hideNumbers={hideNumbers}
        />

        <AddFood
          contextKey={`${outbox.scope ?? "signed-out"}\u001f${sessionKey ?? "signed-out"}\u001f${localDate}\u001f${timeZone}`}
          localDate={localDate}
          timeZone={timeZone}
          foods={foods.data}
          outbox={outbox}
          hideNumbers={hideNumbers}
        />

        {MEAL_SLOTS.map((slot) => {
          const slotRows = visible.filter(
            (row) =>
              (row.kind === "server"
                ? row.entry.slot
                : row.change.op.kind === "log"
                  ? row.change.op.input.slot
                  : null) === slot,
          );
          return (
            <View key={slot} className="gap-2">
              <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
                {SLOT_LABELS[slot]}
              </Text>
              {slotRows.length === 0 ? (
                <Text className="text-sm text-muted-foreground">{DIARY_COPY.emptySlot}</Text>
              ) : (
                slotRows.map((row) => (
                  <EntryCard
                    key={row.key}
                    row={row}
                    outbox={outbox}
                    onDelete={() => remove(row)}
                    hideNumbers={hideNumbers}
                  />
                ))
              )}
            </View>
          );
        })}

        <CopyDay
          localDate={localDate}
          timeZone={timeZone}
          outbox={outbox}
          hideNumbers={hideNumbers}
        />

        <Pressable
          onPress={clearDeviceData}
          accessibilityRole="button"
          className="min-h-11 justify-center"
        >
          <Text className="text-sm text-muted-foreground underline">{DIARY_COPY.clearCache}</Text>
        </Pressable>
      </View>
    </Container>
  );
}

function emptyNutrients() {
  return Object.fromEntries(
    Object.keys(NUTRIENT_LABELS).map((key) => [key, null]),
  ) as DiaryEntry["nutrients"];
}

/**
 * The member's targets that applied on the selected day (Issue #80), shown
 * separately from the totals and never as a verdict. Hidden entirely when no
 * target applies; in hide-numbers mode the amounts are replaced but the card
 * stays.
 */
function TargetsOnDay({
  targets,
  hideNumbers,
}: {
  targets: NutritionTargetWire[];
  hideNumbers: boolean;
}) {
  if (targets.length === 0) return null;
  return (
    <Card variant="secondary" className="gap-2 p-4">
      <Text className="font-medium text-foreground" accessibilityRole="header">
        {TARGET_COPY.yourTargets}
      </Text>
      {targets.map((target) => (
        <View key={target.id} className="gap-0.5">
          <Text className="text-sm text-foreground">
            {NUTRIENT_LABELS[target.nutrient].label}: {formatTarget(target, hideNumbers)}
          </Text>
          <Text className="text-xs text-muted-foreground">{describeTargetSource(target)}</Text>
        </View>
      ))}
      <Text className="text-xs text-muted-foreground">{TARGET_COPY.targetsNote}</Text>
      <Link href="/nutrition-targets" asChild>
        <Pressable accessibilityRole="link" className="min-h-11 justify-center">
          <Text className="text-sm text-foreground underline">{TARGET_COPY.settingsLink}</Text>
        </Pressable>
      </Link>
    </Card>
  );
}

function OutboxBanner({ outbox }: { outbox: DiaryOutbox }) {
  const { queued, syncing, needs_attention } = outbox.counts;
  if (queued + syncing + needs_attention === 0) return null;
  const parts = [
    queued ? `${queued} queued` : null,
    syncing ? `${syncing} syncing` : null,
    needs_attention ? `${needs_attention} need attention` : null,
  ].filter(Boolean);
  return (
    <Card variant="secondary" className="flex-row items-center justify-between gap-3 p-3">
      <Text className="flex-1 text-sm text-foreground" accessibilityLiveRegion="polite">
        {outbox.online ? "Diary changes: " : "Offline. Changes are saved on this device: "}
        {parts.join(", ")}
      </Text>
      <Button size="sm" variant="secondary" onPress={() => void outbox.syncNow()}>
        Sync now
      </Button>
    </Card>
  );
}

function describeOp(item: QueuedChange, hideNumbers: boolean): string {
  switch (item.op.kind) {
    case "log":
      return `Log ${item.preview?.name ?? "food"} (${hideNumbers ? HIDDEN_VALUE : formatAmount(item.op.input.amount, item.op.input.unit)})`;
    case "update":
      return `Change to ${hideNumbers ? HIDDEN_VALUE : formatAmount(item.op.input.amount, item.op.input.unit)}`;
    case "delete":
      return "Delete entry";
    case "restore":
      return "Restore entry";
    case "setDayStatus":
      return `Day marker for ${item.op.input.localDate}`;
    case "copyDay":
      return `Copy into ${item.op.input.toDate}`;
  }
}

function AttentionCard({
  item,
  outbox,
  hideNumbers,
}: {
  item: QueuedChange;
  outbox: DiaryOutbox;
  hideNumbers: boolean;
}) {
  const server = item.conflict;
  return (
    <Card variant="secondary" className="gap-2 p-4" accessibilityRole="alert">
      <Text className="font-medium text-foreground">
        {server
          ? DIARY_COPY.conflictTitle
          : `${SYNC_STATE_LABELS.needs_attention}: ${describeOp(item, hideNumbers)}`}
      </Text>
      {server ? (
        <Text className="text-sm text-muted-foreground">
          Other version: {server.food.name},{" "}
          {server.deleted
            ? "deleted"
            : `${hideNumbers ? HIDDEN_VALUE : formatAmount(server.amount, server.unit)}, ${SLOT_LABELS[server.slot]}`}
          . Your change: {describeOp(item, hideNumbers)}.
        </Text>
      ) : (
        <Text className="text-sm text-muted-foreground">
          The server did not accept this change ({item.lastErrorCode ?? "unknown"}). It stays on
          this device until you retry or discard it.
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {server ? (
          <>
            <Button size="sm" onPress={() => outbox.keepMine(item.id)}>
              {DIARY_COPY.keepMine}
            </Button>
            <Button size="sm" variant="secondary" onPress={() => outbox.discard(item.id)}>
              {DIARY_COPY.keepServer}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onPress={() => outbox.retry(item.id)}>
              {DIARY_COPY.retry}
            </Button>
            <Button size="sm" variant="secondary" onPress={() => outbox.discard(item.id)}>
              Discard change
            </Button>
          </>
        )}
      </View>
    </Card>
  );
}

function EntryCard({
  row,
  outbox,
  onDelete,
  hideNumbers,
}: {
  row: DiaryRow;
  outbox: DiaryOutbox;
  onDelete: () => void;
  hideNumbers: boolean;
}) {
  const name = row.kind === "server" ? row.entry.food.name : (row.change.preview?.name ?? "Food");
  const amount =
    row.kind === "server"
      ? row.entry.amount
      : row.change.op.kind === "log"
        ? row.change.op.input.amount
        : 0;
  const unit: AmountUnit =
    row.kind === "server"
      ? row.entry.unit
      : row.change.op.kind === "log"
        ? row.change.op.input.unit
        : "g";
  const source =
    row.kind === "server" ? row.entry.food.source : (row.change.preview?.source ?? "manual");
  const nutrients = rowNutrients(row);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hideNumbers ? "" : String(amount));

  useEffect(() => {
    if (hideNumbers) setDraft("");
  }, [hideNumbers]);

  const save = () => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) return;
    if (row.kind === "local") {
      outbox.enqueue({
        op: {
          kind: "update",
          input: {
            clientMutationId: newClientMutationId(),
            entryId: row.key as never,
            amount: value,
            unit,
          },
        },
        preview: row.change.preview
          ? {
              ...row.change.preview,
              nutrients: scale(row.change.preview.nutrients, value / amount),
            }
          : null,
      });
    } else {
      outbox.enqueue({
        op: {
          kind: "update",
          input: {
            clientMutationId: newClientMutationId(),
            entryId: row.entry.id,
            expectedRevision: row.entry.revision,
            amount: value,
            unit,
          },
        },
      });
    }
    setEditing(false);
    announce(`Updated ${name}`);
  };

  return (
    <Card variant="secondary" className="gap-2 p-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-0.5">
          <Text className="font-medium text-foreground">{name}</Text>
          <Text className="text-xs text-muted-foreground">
            {hideNumbers ? HIDDEN_VALUE : formatAmount(amount, unit)} · {foodSourceLabel(source)}
          </Text>
          {row.kind === "server" &&
          row.entry.food.source === "off" &&
          row.entry.food.attribution ? (
            <Text className="text-xs text-muted-foreground">{row.entry.food.attribution}</Text>
          ) : null}
          <Text className="font-mono text-sm text-foreground">
            {hideNumbers
              ? HIDDEN_VALUE
              : formatNutrientValue("energyKcal", nutrients?.energyKcal ?? null)}
          </Text>
        </View>
        <SyncBadge state={row.sync} />
      </View>
      {editing ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            keyboardType="numeric"
            accessibilityLabel={`Amount in ${unit}`}
            className={`${inputClass} flex-1`}
          />
          <Button size="sm" onPress={save}>
            Save
          </Button>
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <Button
          size="sm"
          variant="secondary"
          onPress={() =>
            setEditing((value) => {
              const next = !value;
              if (next) setDraft(hideNumbers ? "" : String(amount));
              return next;
            })
          }
          accessibilityLabel={`Edit ${name}`}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={onDelete}
          accessibilityLabel={`Delete ${name}`}
        >
          Delete
        </Button>
      </View>
    </Card>
  );
}

function scale(values: DiaryEntry["nutrients"] | null, factor: number) {
  if (!values || !Number.isFinite(factor)) return null;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === null ? null : value * factor]),
  ) as DiaryEntry["nutrients"];
}

const QUICK_NUTRIENTS: NutrientKey[] = ["energyKcal", "proteinG", "carbohydrateG", "fatG"];

const EMPTY_QUICK: QuickAddFields = {
  name: "",
  basisAmount: "100",
  basisUnit: "g",
  nutrients: {},
};

/** `value`, settled for `ms` (one search request per pause in typing). */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function CandidateRow({
  candidate,
  selected,
  onPress,
  disabled = false,
}: {
  candidate: FoodCandidate;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-lg px-3 ${selected ? "bg-accent" : ""}`}
    >
      <Text className="text-sm text-foreground">
        {candidate.name}
        {candidate.brand ? ` · ${candidate.brand}` : ""} · {candidate.sourceLabel}
      </Text>
    </Pressable>
  );
}

function AttributionNotes({ candidates }: { candidates: readonly FoodCandidate[] }) {
  const notices = [...new Set(candidates.flatMap((c) => (c.attribution ? [c.attribution] : [])))];
  return (
    <>
      {notices.map((notice) => (
        <Text key={notice} className="text-xs text-muted-foreground">
          {notice}
        </Text>
      ))}
    </>
  );
}

function AddFood({
  contextKey,
  localDate,
  timeZone,
  foods,
  outbox,
  hideNumbers,
}: {
  contextKey: string;
  localDate: string;
  timeZone: string;
  foods:
    | {
        recents: FoodChoice[];
        favorites: FoodChoice[];
        customFoods: FoodChoice[];
      }
    | undefined;
  outbox: DiaryOutbox;
  hideNumbers: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "barcode" | "quick">("choose");
  const [slot, setSlot] = useState<MealSlot>("breakfast");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<FoodCandidate | null>(null);
  const [amount, setAmount] = useState("100");
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [quick, setQuick] = useState<QuickAddFields>(EMPTY_QUICK);
  /** Set while the quick-add form is a manual draft started from a barcode. */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [saveAsFood, setSaveAsFood] = useState(false);
  const lifecycle = useAddFoodSaveLifecycle(contextKey);
  const { editable } = lifecycle;

  // Cached foods stay searchable offline: filtering is local.
  const saved = useMemo(() => {
    const seen = new Set<string>();
    const needle = query.trim().toLowerCase();
    return [...(foods?.favorites ?? []), ...(foods?.recents ?? []), ...(foods?.customFoods ?? [])]
      .filter((food) => {
        const key = JSON.stringify(food.ref);
        if (seen.has(key)) return false;
        seen.add(key);
        return !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle);
      })
      .map(candidateFromChoice);
  }, [foods, query]);
  const savedIds = useMemo(
    () => new Set((foods?.customFoods ?? []).flatMap((food) => food.sourceQualifiedId ?? [])),
    [foods],
  );

  // Food databases need the network; results are not cached on the device.
  const debounced = useDebounced(query.trim());
  const searchable = isSearchable(debounced);
  const search = useQuery({
    ...orpc.nutritionFoods.search.queryOptions({ input: { query: debounced } }),
    enabled: open && mode === "choose" && searchable && outbox.online,
    staleTime: 60_000,
  });
  const found = useMemo(
    () => searchCandidates(search.data?.results ?? [], savedIds),
    [search.data, savedIds],
  );

  if (!open) return <Button onPress={() => setOpen(true)}>{DIARY_COPY.addFood}</Button>;

  const select = (candidate: FoodCandidate) => {
    if (!lifecycle.canMutate()) return;
    setChosen(candidate);
    const first = unitsFor(candidate.basis)[0] ?? "g";
    setUnit(first);
    setAmount(first === "serving" ? "1" : String(candidate.basis.nutrientBasisAmount));
  };

  const switchMode = (next: typeof mode) => {
    if (!lifecycle.canMutate()) return;
    setMode(next);
    setChosen(null);
    if (next !== "quick") setDraftNote(null);
  };

  const startManualDraft = (barcode: string | null, note: string) => {
    if (!lifecycle.canMutate()) return;
    setQuick(manualDraftFields(barcode));
    setDraftNote(note);
    setChosen(null);
    setMode("quick");
    setUnit("g");
    setAmount("100");
    announce(BARCODE_COPY.enterManually);
  };

  const close = () => {
    lifecycle.invalidate();
    setChosen(null);
    setQuick(EMPTY_QUICK);
    setDraftNote(null);
    setMode("choose");
    setOpen(false);
  };

  const parsed = parseQuickAdd(quick);
  const basis =
    mode !== "quick"
      ? chosen?.basis
      : parsed.ok
        ? {
            nutrientBasisAmount: parsed.food.nutrientBasisAmount,
            nutrientBasisUnit: parsed.food.nutrientBasisUnit,
            servingSizeAmount: null,
            servingSizeUnit: null,
            servingLabel: null,
          }
        : undefined;
  const perBasis =
    mode !== "quick"
      ? chosen?.nutrientsPerBasis
      : parsed.ok
        ? ({
            ...emptyNutrients(),
            ...parsed.food.nutrients,
          } as DiaryEntry["nutrients"])
        : undefined;
  const preview =
    basis && perBasis ? previewNutrients(basis, perBasis, Number(amount), unit) : null;
  const units = basis ? unitsFor(basis) : (["g", "ml", "serving"] as AmountUnit[]);
  const missingNote = mode !== "quick" && chosen ? missingDataNote(chosen) : null;

  const save = async () => {
    if (!preview) return;
    if (!lifecycle.canMutate()) return;
    const ticket = outbox.beginWrite();
    const ownerScope = outbox.scope;
    const fingerprint = JSON.stringify({
      parsed: parsed.ok ? parsed.food : null,
      chosen: chosen?.ref,
      amount,
      unit,
      slot,
    });
    const intent = lifecycle.begin(ticket, fingerprint, newClientMutationId);
    if (!intent) return;
    const isCurrent = () =>
      lifecycle.controller.isCurrent(intent) &&
      lifecycle.contextKey === contextKey &&
      outbox.scope === ownerScope &&
      !!ticket &&
      isOfflineWriteTicketCurrent(ticket, ownerScope ?? "");
    const release = () => {
      lifecycle.release(intent);
    };
    if (!ticket || !isOfflineWriteTicketCurrent(ticket, ownerScope ?? "")) {
      release();
      return;
    }
    let food: FoodRef;
    let name: string;
    let source: DiaryEntry["food"]["source"];
    let method: LogEntryInput["method"];
    if (mode !== "quick" && chosen) {
      food = chosen.ref;
      name = chosen.name;
      source = chosen.source;
      method = chosen.method;
    } else if (mode === "quick" && parsed.ok) {
      name = parsed.food.name;
      source = "manual";
      method = draftNote !== null ? "barcode" : "quick_add";
      if (saveAsFood) {
        if (!outbox.online) {
          announce(
            "Connect to the internet to save this food. Your diary entry has not been queued.",
          );
          release();
          return;
        }
        await completeAddFoodCreation({
          intent,
          isCurrent,
          create: (clientMutationId) =>
            client.nutritionDiary.createFood({ ...parsed.food, clientMutationId }),
          enqueue: (created) =>
            outbox.enqueueForIntent(ticket, {
              op: {
                kind: "log",
                input: {
                  clientMutationId: intent.diaryMutationId,
                  localDate,
                  timeZone,
                  slot,
                  food: created.ref,
                  amount: Number(amount),
                  unit,
                  method,
                },
              },
              preview: { name, source, nutrients: preview },
            }),
          finish: lifecycle.finish,
          release: lifecycle.release,
          onError: () => announce(CUSTOM_FOOD_COPY.networkError),
          onStored: () => {
            announce(`Saved ${name} to ${SLOT_LABELS[slot]} on ${localDate}`);
            close();
          },
        });
        return;
      } else food = { kind: "manual", food: parsed.food };
    } else {
      release();
      return;
    }
    if (
      !isCurrent() ||
      outbox.scope !== ownerScope ||
      !ticket ||
      !isOfflineWriteTicketCurrent(ticket, ownerScope ?? "")
    ) {
      release();
      return;
    }
    const stored = outbox.enqueueForIntent(ticket, {
      op: {
        kind: "log",
        input: {
          clientMutationId: intent.diaryMutationId,
          localDate,
          timeZone,
          slot,
          food,
          amount: Number(amount),
          unit,
          method,
        },
      },
      preview: { name, source, nutrients: preview },
    });
    if (!stored) {
      release();
      return;
    }
    announce(`Saved ${name} to ${SLOT_LABELS[slot]} on ${localDate}`);
    lifecycle.finish(intent);
    close();
    return;
  };

  return (
    <Card variant="secondary" className="gap-3 p-4">
      <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
        {DIARY_COPY.addFood}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label="Search and recents"
          selected={mode === "choose"}
          onPress={() => switchMode("choose")}
          disabled={!editable}
        />
        <Chip
          label={BARCODE_COPY.mode}
          selected={mode === "barcode"}
          onPress={() => switchMode("barcode")}
          disabled={!editable}
        />
        <Chip
          label="Quick add"
          selected={mode === "quick"}
          onPress={() => switchMode("quick")}
          disabled={!editable}
        />
      </View>
      {mode === "choose" ? (
        <View className="gap-2">
          <TextInput
            value={query}
            editable={editable}
            onChangeText={lifecycle.bindMutation(setQuery)}
            placeholder={BARCODE_COPY.searchLabel}
            accessibilityLabel={BARCODE_COPY.searchLabel}
            accessibilityHint={BARCODE_COPY.searchHint}
            className={inputClass}
            placeholderTextColor="#9ca3af"
          />
          <Text className="text-sm font-medium text-foreground" accessibilityRole="header">
            {BARCODE_COPY.savedFoods}
          </Text>
          {saved.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              {query.trim()
                ? BARCODE_COPY.searchEmpty
                : "No saved or recent foods yet. Search, scan a barcode or use quick add."}
            </Text>
          ) : (
            saved
              .slice(0, 15)
              .map((candidate) => (
                <CandidateRow
                  key={candidate.key}
                  candidate={candidate}
                  selected={chosen?.key === candidate.key}
                  onPress={() => select(candidate)}
                  disabled={!editable}
                />
              ))
          )}
          <Text className="text-sm font-medium text-foreground" accessibilityRole="header">
            {BARCODE_COPY.searchResults}
          </Text>
          {!outbox.online ? (
            <Text className="text-sm text-muted-foreground">{BARCODE_COPY.searchOffline}</Text>
          ) : !searchable ? (
            <Text className="text-sm text-muted-foreground">{BARCODE_COPY.searchHint}</Text>
          ) : search.isPending ? (
            <Spinner />
          ) : search.isError ? (
            <Pressable
              disabled={!editable}
              onPress={() => {
                if (lifecycle.canMutate()) void search.refetch();
              }}
              accessibilityRole="button"
            >
              <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
                {BARCODE_COPY.searchFailed} {DIARY_COPY.retry}
              </Text>
            </Pressable>
          ) : found.length === 0 ? (
            <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
              {BARCODE_COPY.searchEmpty}
            </Text>
          ) : (
            <>
              {found.slice(0, 20).map((candidate) => (
                <CandidateRow
                  key={candidate.key}
                  candidate={candidate}
                  selected={chosen?.key === candidate.key}
                  onPress={() => select(candidate)}
                  disabled={!editable}
                />
              ))}
              <AttributionNotes candidates={found.slice(0, 20)} />
            </>
          )}
        </View>
      ) : mode === "barcode" ? (
        <BarcodePanel
          outbox={outbox}
          chosen={chosen}
          onSelect={select}
          onManualDraft={startManualDraft}
          disabled={!editable}
          canMutate={lifecycle.canMutate}
        />
      ) : (
        <View className="gap-2">
          {draftNote ? (
            <View className="gap-1 rounded-lg border border-border p-3">
              <Text className="text-sm text-foreground">{draftNote}</Text>
              <Text className="text-sm text-muted-foreground">{BARCODE_COPY.manualNote}</Text>
            </View>
          ) : null}
          <TextInput
            value={quick.name}
            editable={editable}
            onChangeText={lifecycle.bindMutation((name) => setQuick({ ...quick, name }))}
            placeholder="Food name"
            accessibilityLabel="Food name"
            className={inputClass}
            placeholderTextColor="#9ca3af"
          />
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-sm text-foreground">Values per</Text>
            <TextInput
              value={quick.basisAmount}
              editable={editable}
              onChangeText={lifecycle.bindMutation((basisAmount) =>
                setQuick({ ...quick, basisAmount }),
              )}
              keyboardType="numeric"
              accessibilityLabel="Values per amount"
              className={`${inputClass} w-20`}
            />
            {(["g", "ml", "serving"] as AmountUnit[]).map((option) => (
              <Chip
                key={option}
                label={option}
                selected={quick.basisUnit === option}
                disabled={!editable}
                onPress={() => {
                  if (!lifecycle.canMutate()) return;
                  setQuick({ ...quick, basisUnit: option });
                  setUnit(option);
                }}
              />
            ))}
          </View>
          {QUICK_NUTRIENTS.map((key) => (
            <TextInput
              key={key}
              value={quick.nutrients[key] ?? ""}
              editable={editable}
              onChangeText={lifecycle.bindMutation((text) =>
                setQuick({
                  ...quick,
                  nutrients: { ...quick.nutrients, [key]: text },
                }),
              )}
              keyboardType="numeric"
              placeholder={`${NUTRIENT_LABELS[key].label} (${NUTRIENT_LABELS[key].unit}, optional)`}
              accessibilityLabel={`${NUTRIENT_LABELS[key].label} in ${NUTRIENT_LABELS[key].unit}, optional`}
              className={inputClass}
              placeholderTextColor="#9ca3af"
            />
          ))}
          {draftNote !== null ? (
            <TextInput
              value={quick.barcode ?? ""}
              editable={editable}
              onChangeText={lifecycle.bindMutation((barcode) => setQuick({ ...quick, barcode }))}
              keyboardType="number-pad"
              placeholder={`${BARCODE_COPY.barcodeOnDraft}, optional`}
              accessibilityLabel={`${BARCODE_COPY.barcodeOnDraft}, optional`}
              className={inputClass}
              placeholderTextColor="#9ca3af"
            />
          ) : null}
          {!parsed.ok && quick.name ? (
            <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
              {parsed.error}
            </Text>
          ) : null}
        </View>
      )}

      <View className="flex-row flex-wrap gap-2" accessibilityLabel="Meal">
        {MEAL_SLOTS.map((option) => (
          <Chip
            key={option}
            label={SLOT_LABELS[option]}
            selected={slot === option}
            onPress={() => {
              if (lifecycle.canMutate()) setSlot(option);
            }}
            disabled={!editable}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <TextInput
          value={amount}
          editable={editable}
          onChangeText={lifecycle.bindMutation(setAmount)}
          keyboardType="numeric"
          accessibilityLabel="Amount"
          className={`${inputClass} w-24`}
        />
        {units.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={unit === option}
            onPress={() => {
              if (lifecycle.canMutate()) setUnit(option);
            }}
            disabled={!editable}
          />
        ))}
      </View>

      {mode === "quick" ? (
        <Pressable
          disabled={!editable}
          onPress={() => {
            if (lifecycle.canMutate()) setSaveAsFood((value) => !value);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: saveAsFood }}
          className="min-h-11 flex-row items-center gap-2"
        >
          <Text className="text-foreground">{saveAsFood ? "☑" : "□"}</Text>
          <Text className="text-sm text-foreground">Save to my foods for next time</Text>
        </Pressable>
      ) : null}

      {preview ? (
        <View className="gap-1" accessibilityLabel="Review before saving">
          <Text className="text-sm font-medium text-foreground">
            Review: {mode !== "quick" && chosen ? `${chosen.name}, ` : ""}
            {hideNumbers ? HIDDEN_VALUE : formatAmount(Number(amount), unit)}, {SLOT_LABELS[slot]},{" "}
            {localDate}
            {mode !== "quick" && chosen
              ? ` · ${chosen.sourceLabel}`
              : draftNote !== null
                ? " · Entered by you"
                : ""}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {hideNumbers
              ? HIDDEN_VALUE
              : SUMMARY_NUTRIENTS.map(
                  (key) =>
                    `${NUTRIENT_LABELS[key].label} ${formatNutrientValue(key, preview[key])}`,
                ).join(" · ")}
          </Text>
          {missingNote ? (
            <Text className="text-sm text-muted-foreground">{missingNote}</Text>
          ) : null}
          {mode !== "quick" && chosen?.attribution ? (
            <Text className="text-xs text-muted-foreground">{chosen.attribution}</Text>
          ) : null}
          {mode === "barcode" ? (
            <Text className="text-xs text-muted-foreground">{BARCODE_COPY.verify}</Text>
          ) : null}
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={save} isDisabled={!preview || !editable}>
          {`Save to ${SLOT_LABELS[slot]}`}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            const wasSaving = !lifecycle.canMutate();
            close();
            announce(
              wasSaving
                ? "Save cancelled. A food creation already sent may still complete."
                : "Nothing saved",
            );
          }}
        >
          Cancel
        </Button>
      </View>
    </Card>
  );
}

/**
 * Scan or type a barcode (Issue #75). A hit lists the matches for review; a
 * miss, store code, nameless product, unreachable source or offline cache
 * miss opens a manual draft. Nothing is saved from here.
 */
function BarcodePanel({
  outbox,
  chosen,
  onSelect,
  onManualDraft,
  disabled,
  canMutate,
}: {
  outbox: DiaryOutbox;
  chosen: FoodCandidate | null;
  onSelect: (candidate: FoodCandidate) => void;
  onManualDraft: (barcode: string | null, note: string) => void;
  disabled: boolean;
  canMutate: () => boolean;
}) {
  const [digits, setDigits] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BarcodeOutcome | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const run = async (raw: string) => {
    if (!canMutate()) return;
    setBusy(true);
    setOutcome(null);
    setMessage(null);
    const scope = outbox.scope;
    const resolution = await resolveBarcode(raw, {
      online: outbox.online,
      lookup: (barcode) => client.nutritionFoods.lookupBarcode({ barcode }),
      readCached: (barcode) =>
        scope ? readCache<BarcodeLookup>(scope, barcodeCacheKey(barcode)) : null,
      writeCached: (barcode, result) => {
        if (scope && canMutate()) writeCache(scope, barcodeCacheKey(barcode), result);
      },
    });
    if (!canMutate()) return;
    setBusy(false);
    if (resolution.kind === "invalid") {
      setMessage(resolution.message);
      announce(resolution.message);
      return;
    }
    setLast(raw);
    setOutcome(resolution.outcome);
    announce(resolution.outcome.message);
  };

  return (
    <View className="gap-2">
      {scanning ? (
        <BarcodeScanner
          onScanned={(barcode) => {
            if (!canMutate()) return;
            setScanning(false);
            setDigits(barcode);
            announce(BARCODE_COPY.scanned(barcode));
            void run(barcode);
          }}
          onClose={(note) => {
            if (!canMutate()) return;
            setScanning(false);
            setMessage(note);
          }}
        />
      ) : (
        <Button
          isDisabled={disabled}
          variant="secondary"
          onPress={() => {
            if (canMutate()) setScanning(true);
          }}
        >
          {BARCODE_COPY.scan}
        </Button>
      )}
      <View className="flex-row flex-wrap items-center gap-2">
        <TextInput
          value={digits}
          editable={!disabled}
          onChangeText={(value) => {
            if (canMutate()) setDigits(value);
          }}
          keyboardType="number-pad"
          placeholder={BARCODE_COPY.digitsLabel}
          accessibilityLabel={BARCODE_COPY.digitsLabel}
          className={`${inputClass} flex-1`}
          placeholderTextColor="#9ca3af"
          onSubmitEditing={() => {
            if (canMutate()) void run(digits);
          }}
        />
        <Button
          size="sm"
          onPress={() => {
            if (canMutate()) void run(digits);
          }}
          isDisabled={busy || disabled}
        >
          {busy ? BARCODE_COPY.lookingUp : BARCODE_COPY.lookUp}
        </Button>
      </View>
      {message ? (
        <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {outcome?.kind === "matches" ? (
        <View className="gap-2">
          <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
            {outcome.message}
          </Text>
          {outcome.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.key}
              candidate={candidate}
              selected={chosen?.key === candidate.key}
              onPress={() => onSelect(candidate)}
              disabled={disabled}
            />
          ))}
          <AttributionNotes candidates={outcome.candidates} />
          <Button
            size="sm"
            variant="secondary"
            isDisabled={disabled}
            onPress={() => {
              if (canMutate()) onManualDraft(outcome.barcode, BARCODE_COPY.notThisProduct);
            }}
          >
            {`Not this product? ${BARCODE_COPY.enterManually}`}
          </Button>
        </View>
      ) : outcome?.kind === "manual" ? (
        <View className="gap-2">
          <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
            {outcome.message}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              isDisabled={disabled}
              onPress={() => {
                if (canMutate()) onManualDraft(outcome.barcode, outcome.message);
              }}
            >
              {BARCODE_COPY.enterManually}
            </Button>
            {outcome.canRetry && last ? (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={disabled}
                onPress={() => {
                  if (canMutate()) void run(last);
                }}
              >
                {BARCODE_COPY.retry}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CopyDay({
  localDate,
  timeZone,
  outbox,
  hideNumbers,
}: {
  localDate: string;
  timeZone: string;
  outbox: DiaryOutbox;
  hideNumbers: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(() => shiftLocalDate(localDate, -1));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const source = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${fromDate}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate: fromDate } }),
  );
  if (!open)
    return (
      <Button variant="secondary" onPress={() => setOpen(true)}>
        {`Copy from ${fromDate}`}
      </Button>
    );
  const entries = source.data?.entries ?? [];
  const confirm = () => {
    outbox.enqueue({
      op: {
        kind: "copyDay",
        input: {
          clientMutationId: newClientMutationId(),
          fromDate,
          toDate: localDate,
          timeZone,
          entryIds: [...selected],
        },
      },
    });
    announce(`Copying ${selected.size} items to ${localDate}`);
    setSelected(new Set());
    setOpen(false);
  };
  return (
    <Card variant="secondary" className="gap-2 p-4">
      <Text className="font-medium text-foreground">Copy from</Text>
      <TextInput
        value={fromDate}
        onChangeText={(value) => {
          setFromDate(value);
          setSelected(new Set());
        }}
        accessibilityLabel="Copy from date"
        placeholder="YYYY-MM-DD"
        className={inputClass}
      />
      {fromDate === localDate ? (
        <Text className="text-sm text-muted-foreground">Choose a different day.</Text>
      ) : null}
      {fromDate !== localDate && entries.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{DIARY_COPY.empty}</Text>
      ) : fromDate !== localDate ? (
        entries.map((entry) => {
          const checked = selected.has(entry.id);
          return (
            <Pressable
              key={entry.id}
              onPress={() => {
                const next = new Set(selected);
                if (checked) next.delete(entry.id);
                else next.add(entry.id);
                setSelected(next);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              className="min-h-11 flex-row items-center gap-2"
            >
              <Text className="text-foreground">{checked ? "[x]" : "[ ]"}</Text>
              <Text className="text-sm text-foreground">
                {SLOT_LABELS[entry.slot]}: {entry.food.name},{" "}
                {hideNumbers ? HIDDEN_VALUE : formatAmount(entry.amount, entry.unit)}
              </Text>
            </Pressable>
          );
        })
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={confirm} isDisabled={selected.size === 0}>
          {`Copy ${selected.size} to ${localDate}`}
        </Button>
        <Button variant="secondary" onPress={() => setOpen(false)}>
          Cancel
        </Button>
      </View>
    </Card>
  );
}
