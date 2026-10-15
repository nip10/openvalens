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
import { Button, Card, Spinner } from "heroui-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, Text, TextInput, View } from "react-native";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { Container } from "@/components/container";
import { NutritionDayTotals } from "@/components/nutrition-day-totals";
import { barcodeCacheKey, resolveBarcode } from "@/lib/nutrition/barcode";
import { mergeDay, type DiaryRow, type QueuedChange } from "@/lib/nutrition/outbox";
import { DIARY_CACHE_PREFIX, useDiaryOutbox, type DiaryOutbox } from "@/lib/nutrition/sync";
import { readCache, writeCache } from "@/lib/offline/cache";
import { useCacheFirst } from "@/lib/offline/sync";
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

function rowNutrients(row: DiaryRow) {
  if (row.kind === "server") return row.entry.nutrients;
  return row.change.preview?.nutrients ?? null;
}

export default function NutritionScreen() {
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const [localDate, setLocalDate] = useState(() => localDateIn(timeZone));
  const outbox = useDiaryOutbox();
  const day = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${localDate}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate } }),
  );
  const foods = useCacheFirst(
    `${DIARY_CACHE_PREFIX}foods`,
    orpc.nutritionDiary.listFoods.queryOptions({ input: {} }),
  );
  const [undo, setUndo] = useState<{ entryId: number; revision: number; name: string } | null>(
    null,
  );

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
          input: { clientMutationId: newClientMutationId(), entryId: row.key as never },
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
    setUndo({ entryId: row.entry.id, revision: row.entry.revision + 1, name: row.entry.food.name });
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
        <View className="flex-row items-center justify-between gap-2">
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

        <OutboxBanner outbox={outbox} />

        {attention.map((item) => (
          <AttentionCard key={item.id} item={item} outbox={outbox} />
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
          />
        </Card>

        <AddFood localDate={localDate} timeZone={timeZone} foods={foods.data} outbox={outbox} />

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
                  <EntryCard key={row.key} row={row} outbox={outbox} onDelete={() => remove(row)} />
                ))
              )}
            </View>
          );
        })}

        <CopyDay localDate={localDate} timeZone={timeZone} outbox={outbox} />

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

function describeOp(item: QueuedChange): string {
  switch (item.op.kind) {
    case "log":
      return `Log ${item.preview?.name ?? "food"} (${formatAmount(item.op.input.amount, item.op.input.unit)})`;
    case "update":
      return `Change to ${formatAmount(item.op.input.amount, item.op.input.unit)}`;
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

function AttentionCard({ item, outbox }: { item: QueuedChange; outbox: DiaryOutbox }) {
  const server = item.conflict;
  return (
    <Card variant="secondary" className="gap-2 p-4" accessibilityRole="alert">
      <Text className="font-medium text-foreground">
        {server
          ? DIARY_COPY.conflictTitle
          : `${SYNC_STATE_LABELS.needs_attention}: ${describeOp(item)}`}
      </Text>
      {server ? (
        <Text className="text-sm text-muted-foreground">
          Other version: {server.food.name},{" "}
          {server.deleted
            ? "deleted"
            : `${formatAmount(server.amount, server.unit)}, ${SLOT_LABELS[server.slot]}`}
          . Your change: {describeOp(item)}.
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
}: {
  row: DiaryRow;
  outbox: DiaryOutbox;
  onDelete: () => void;
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
  const [draft, setDraft] = useState(String(amount));

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
            {formatAmount(amount, unit)} · {foodSourceLabel(source)}
          </Text>
          {row.kind === "server" &&
          row.entry.food.source === "off" &&
          row.entry.food.attribution ? (
            <Text className="text-xs text-muted-foreground">{row.entry.food.attribution}</Text>
          ) : null}
          <Text className="font-mono text-sm text-foreground">
            {formatNutrientValue("energyKcal", nutrients?.energyKcal ?? null)}
          </Text>
        </View>
        <SyncBadge state={row.sync} />
      </View>
      {editing ? (
        <View className="flex-row items-center gap-2">
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
          onPress={() => setEditing((value) => !value)}
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

const EMPTY_QUICK: QuickAddFields = { name: "", basisAmount: "100", basisUnit: "g", nutrients: {} };

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
}: {
  candidate: FoodCandidate;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
  localDate,
  timeZone,
  foods,
  outbox,
}: {
  localDate: string;
  timeZone: string;
  foods: { recents: FoodChoice[]; favorites: FoodChoice[]; customFoods: FoodChoice[] } | undefined;
  outbox: DiaryOutbox;
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
    setChosen(candidate);
    const first = unitsFor(candidate.basis)[0] ?? "g";
    setUnit(first);
    setAmount(first === "serving" ? "1" : String(candidate.basis.nutrientBasisAmount));
  };

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setChosen(null);
    if (next !== "quick") setDraftNote(null);
  };

  const startManualDraft = (barcode: string | null, note: string) => {
    setQuick(manualDraftFields(barcode));
    setDraftNote(note);
    setChosen(null);
    setMode("quick");
    setUnit("g");
    setAmount("100");
    announce(BARCODE_COPY.enterManually);
  };

  const close = () => {
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
        ? ({ ...emptyNutrients(), ...parsed.food.nutrients } as DiaryEntry["nutrients"])
        : undefined;
  const preview =
    basis && perBasis ? previewNutrients(basis, perBasis, Number(amount), unit) : null;
  const units = basis ? unitsFor(basis) : (["g", "ml", "serving"] as AmountUnit[]);
  const missingNote = mode !== "quick" && chosen ? missingDataNote(chosen) : null;

  const save = () => {
    if (!preview) return;
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
      food = { kind: "manual", food: parsed.food };
      name = parsed.food.name;
      source = "manual";
      method = draftNote !== null ? "barcode" : "quick_add";
    } else return;
    outbox.enqueue({
      op: {
        kind: "log",
        input: {
          clientMutationId: newClientMutationId(),
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
    announce(`Saved ${name} to ${SLOT_LABELS[slot]} on ${localDate}`);
    close();
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
        />
        <Chip
          label={BARCODE_COPY.mode}
          selected={mode === "barcode"}
          onPress={() => switchMode("barcode")}
        />
        <Chip label="Quick add" selected={mode === "quick"} onPress={() => switchMode("quick")} />
      </View>
      {mode === "choose" ? (
        <View className="gap-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
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
            <Pressable onPress={() => void search.refetch()} accessibilityRole="button">
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
            onChangeText={(name) => setQuick({ ...quick, name })}
            placeholder="Food name"
            accessibilityLabel="Food name"
            className={inputClass}
            placeholderTextColor="#9ca3af"
          />
          <View className="flex-row items-center gap-2">
            <Text className="text-sm text-foreground">Values per</Text>
            <TextInput
              value={quick.basisAmount}
              onChangeText={(basisAmount) => setQuick({ ...quick, basisAmount })}
              keyboardType="numeric"
              accessibilityLabel="Values per amount"
              className={`${inputClass} w-20`}
            />
            {(["g", "ml", "serving"] as AmountUnit[]).map((option) => (
              <Chip
                key={option}
                label={option}
                selected={quick.basisUnit === option}
                onPress={() => {
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
              onChangeText={(text) =>
                setQuick({ ...quick, nutrients: { ...quick.nutrients, [key]: text } })
              }
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
              onChangeText={(barcode) => setQuick({ ...quick, barcode })}
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
            onPress={() => setSlot(option)}
          />
        ))}
      </View>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          accessibilityLabel="Amount"
          className={`${inputClass} w-24`}
        />
        {units.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={unit === option}
            onPress={() => setUnit(option)}
          />
        ))}
      </View>

      {preview ? (
        <View className="gap-1" accessibilityLabel="Review before saving">
          <Text className="text-sm font-medium text-foreground">
            Review: {mode !== "quick" && chosen ? `${chosen.name}, ` : ""}
            {formatAmount(Number(amount), unit)}, {SLOT_LABELS[slot]}, {localDate}
            {mode !== "quick" && chosen
              ? ` · ${chosen.sourceLabel}`
              : draftNote !== null
                ? " · Entered by you"
                : ""}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {SUMMARY_NUTRIENTS.map(
              (key) => `${NUTRIENT_LABELS[key].label} ${formatNutrientValue(key, preview[key])}`,
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

      <View className="flex-row gap-2">
        <Button onPress={save} isDisabled={!preview}>
          {`Save to ${SLOT_LABELS[slot]}`}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            close();
            announce("Nothing saved");
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
}: {
  outbox: DiaryOutbox;
  chosen: FoodCandidate | null;
  onSelect: (candidate: FoodCandidate) => void;
  onManualDraft: (barcode: string | null, note: string) => void;
}) {
  const [digits, setDigits] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BarcodeOutcome | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const run = async (raw: string) => {
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
        if (scope) writeCache(scope, barcodeCacheKey(barcode), result);
      },
    });
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
            setScanning(false);
            setDigits(barcode);
            announce(BARCODE_COPY.scanned(barcode));
            void run(barcode);
          }}
          onClose={(note) => {
            setScanning(false);
            setMessage(note);
          }}
        />
      ) : (
        <Button variant="secondary" onPress={() => setScanning(true)}>
          {BARCODE_COPY.scan}
        </Button>
      )}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={digits}
          onChangeText={setDigits}
          keyboardType="number-pad"
          placeholder={BARCODE_COPY.digitsLabel}
          accessibilityLabel={BARCODE_COPY.digitsLabel}
          className={`${inputClass} flex-1`}
          placeholderTextColor="#9ca3af"
          onSubmitEditing={() => void run(digits)}
        />
        <Button size="sm" onPress={() => void run(digits)} isDisabled={busy}>
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
            />
          ))}
          <AttributionNotes candidates={outcome.candidates} />
          <Button
            size="sm"
            variant="secondary"
            onPress={() => onManualDraft(outcome.barcode, BARCODE_COPY.notThisProduct)}
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
            <Button size="sm" onPress={() => onManualDraft(outcome.barcode, outcome.message)}>
              {BARCODE_COPY.enterManually}
            </Button>
            {outcome.canRetry && last ? (
              <Button size="sm" variant="secondary" onPress={() => void run(last)}>
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
}: {
  localDate: string;
  timeZone: string;
  outbox: DiaryOutbox;
}) {
  const [open, setOpen] = useState(false);
  const fromDate = shiftLocalDate(localDate, -1);
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
      <Text className="font-medium text-foreground">Copy from {fromDate}</Text>
      {entries.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{DIARY_COPY.empty}</Text>
      ) : (
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
                {formatAmount(entry.amount, entry.unit)}
              </Text>
            </Pressable>
          );
        })
      )}
      <View className="flex-row gap-2">
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
