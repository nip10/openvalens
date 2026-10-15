import {
  MEAL_SLOTS,
  type AmountUnit,
  type DiaryEntry,
  type FoodChoice,
  type FoodRef,
  type MealSlot,
  type NutrientKey,
} from "@openvalens/api/contracts/nutrition-diary";
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
  formatNutrientTotal,
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
import { useMemo, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { mergeDay, type DiaryRow, type QueuedChange } from "@/lib/nutrition/outbox";
import { DIARY_CACHE_PREFIX, useDiaryOutbox, type DiaryOutbox } from "@/lib/nutrition/sync";
import { useCacheFirst } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";

/**
 * Meal diary (Issue #77). Every write goes through the durable outbox
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
  const summary = summarizeDay(totalsInput);
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
          <View className="flex-row flex-wrap gap-4">
            {SUMMARY_NUTRIENTS.map((key) => (
              <View key={key} className="gap-0.5">
                <Text className="text-xs text-muted-foreground">{NUTRIENT_LABELS[key].label}</Text>
                <Text className="font-mono text-sm text-foreground">
                  {formatNutrientTotal(key, summary.totals[key])}
                </Text>
              </View>
            ))}
          </View>
          <Text className="text-xs text-muted-foreground">{DIARY_COPY.unknownNote}</Text>
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
  const [mode, setMode] = useState<"choose" | "quick">("choose");
  const [slot, setSlot] = useState<MealSlot>("breakfast");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<FoodChoice | null>(null);
  const [amount, setAmount] = useState("100");
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [quick, setQuick] = useState<QuickAddFields>({
    name: "",
    basisAmount: "100",
    basisUnit: "g",
    nutrients: {},
  });

  // Cached foods stay searchable offline: filtering is local.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const needle = query.trim().toLowerCase();
    return [
      ...(foods?.favorites ?? []),
      ...(foods?.recents ?? []),
      ...(foods?.customFoods ?? []),
    ].filter((food) => {
      const key = JSON.stringify(food.ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle);
    });
  }, [foods, query]);

  if (!open) return <Button onPress={() => setOpen(true)}>{DIARY_COPY.addFood}</Button>;

  const parsed = parseQuickAdd(quick);
  const basis =
    mode === "choose"
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
    mode === "choose"
      ? chosen?.nutrientsPerBasis
      : parsed.ok
        ? ({ ...emptyNutrients(), ...parsed.food.nutrients } as DiaryEntry["nutrients"])
        : undefined;
  const preview =
    basis && perBasis ? previewNutrients(basis, perBasis, Number(amount), unit) : null;
  const units = basis ? unitsFor(basis) : (["g", "ml", "serving"] as AmountUnit[]);

  const save = () => {
    if (!preview) return;
    let food: FoodRef;
    let name: string;
    let source: DiaryEntry["food"]["source"];
    if (mode === "choose" && chosen) {
      food = chosen.ref;
      name = chosen.name;
      source = chosen.source;
    } else if (parsed.ok) {
      food = { kind: "manual", food: parsed.food };
      name = parsed.food.name;
      source = "manual";
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
          method: mode === "quick" ? "quick_add" : "manual",
        },
      },
      preview: { name, source, nutrients: preview },
    });
    announce(`Saved ${name} to ${SLOT_LABELS[slot]} on ${localDate}`);
    setChosen(null);
    setOpen(false);
  };

  return (
    <Card variant="secondary" className="gap-3 p-4">
      <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
        {DIARY_COPY.addFood}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label="My foods and recents"
          selected={mode === "choose"}
          onPress={() => setMode("choose")}
        />
        <Chip label="Quick add" selected={mode === "quick"} onPress={() => setMode("quick")} />
      </View>
      {mode === "choose" ? (
        <View className="gap-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search my foods"
            accessibilityLabel="Search my foods"
            className={inputClass}
            placeholderTextColor="#9ca3af"
          />
          {options.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              No saved or recent foods yet. Use quick add to record one.
            </Text>
          ) : (
            options.slice(0, 15).map((food) => {
              const selected =
                chosen !== null && JSON.stringify(chosen.ref) === JSON.stringify(food.ref);
              return (
                <Pressable
                  key={JSON.stringify(food.ref)}
                  onPress={() => {
                    setChosen(food);
                    const first = unitsFor(food.basis)[0] ?? "g";
                    setUnit(first);
                    setAmount(first === "serving" ? "1" : String(food.basis.nutrientBasisAmount));
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={`min-h-11 justify-center rounded-lg px-3 ${selected ? "bg-accent" : ""}`}
                >
                  <Text className="text-sm text-foreground">
                    {food.name}
                    {food.brand ? ` · ${food.brand}` : ""} · {foodSourceLabel(food.source)}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      ) : (
        <View className="gap-2">
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
            Review: {formatAmount(Number(amount), unit)}, {SLOT_LABELS[slot]}, {localDate}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {SUMMARY_NUTRIENTS.map(
              (key) => `${NUTRIENT_LABELS[key].label} ${formatNutrientValue(key, preview[key])}`,
            ).join(" · ")}
          </Text>
          {mode === "choose" && chosen?.attribution ? (
            <Text className="text-xs text-muted-foreground">{chosen.attribution}</Text>
          ) : null}
        </View>
      ) : null}

      <View className="flex-row gap-2">
        <Button onPress={save} isDisabled={!preview}>
          {`Save to ${SLOT_LABELS[slot]}`}
        </Button>
        <Button variant="secondary" onPress={() => setOpen(false)}>
          Cancel
        </Button>
      </View>
    </Card>
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
