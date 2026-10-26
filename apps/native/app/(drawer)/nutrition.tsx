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
import { CUSTOM_FOOD_COPY, nutrientFieldLabel } from "@openvalens/api/presenters/custom-foods";
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
  SYNC_STATE_LABELS,
  UNIT_LABELS,
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
  formatNutrientSummaryLine,
} from "@openvalens/api/presenters/nutrition-targets";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { type Href, Link, useLocalSearchParams } from "expo-router";
import { Button, Spinner, cn } from "heroui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Apple,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CloudOff,
  Coffee,
  Copy,
  type LucideIcon,
  Pencil,
  Plus,
  RefreshCw,
  Sandwich,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Soup,
  Square,
  SquareCheck,
  Star,
  Trash2,
  TriangleAlert,
  Utensils,
  UtensilsCrossed,
  Zap,
} from "lucide-react-native";
import { AccessibilityInfo, Alert, Pressable, Text, TextInput, View } from "react-native";

import { BarcodeScanner } from "@/components/barcode-scanner";
import {
  Details,
  ErrorState,
  Icon,
  InfoTip,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
  StatusPill,
  ToneChip,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { LoggingStreakCard } from "@/components/logging-streak-card";
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
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Meal diary (Issue #77) with food search and barcode scan/lookup (#75).
 * Every write goes through the durable outbox
 * (lib/nutrition), so logging works the same online and offline: changes are
 * saved on the device first, shown with their sync state, and replayed
 * idempotently. Copy is neutral and never judges food or completeness.
 */

const inputClass =
  "min-h-11 rounded-xl border border-rule bg-card px-3 font-sans text-base text-ink";

/** The same icon per meal as the web diary. */
const SLOT_ICONS: Record<MealSlot, LucideIcon> = {
  breakfast: Coffee,
  lunch: Sandwich,
  dinner: Soup,
  snack: Apple,
  other: Utensils,
};

/** Macros listed beside energy in each food's ⓘ, as on web. */
const LEDGER_MACROS = [
  "proteinG",
  "carbohydrateG",
  "fatG",
] as const satisfies readonly NutrientKey[];

/** The placeholder colour for text inputs, from the theme. */
function usePlaceholderColor() {
  return useThemeColor("ink-3");
}

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

function SyncBadge({ state }: { state: DiarySyncState }) {
  const { t, i18n } = useLingui();
  if (state === "synced") return null;
  const label = i18n._(SYNC_STATE_LABELS[state]);
  return (
    <View accessible accessibilityLabel={t`Sync state: ${label}`}>
      <StatusPill tone={state === "needs_attention" ? "warn" : "neutral"}>{label}</StatusPill>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-1.5 rounded-full border px-4",
        selected ? "border-signal bg-sidebar-accent" : "border-rule bg-card",
        disabled && "opacity-55",
      )}
    >
      {icon ? <Icon icon={icon} size={16} color={selected ? "signal" : "ink-3"} /> : null}
      <Text className={cn("font-sans text-sm text-ink", selected && "font-semibold")}>{label}</Text>
    </Pressable>
  );
}

function rowNutrients(row: DiaryRow) {
  if (row.kind === "server") return row.entry.nutrients;
  return row.change.preview?.nutrients ?? null;
}

export default function NutritionScreen() {
  /** `food` pre-fills the food search, e.g. from a voice draft (#73). Nothing is saved from it. */
  const { food: draftFood } = useLocalSearchParams<{ food?: string }>();
  const initialQuery = typeof draftFood === "string" ? draftFood.trim().slice(0, 200) : "";
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const { t, i18n } = useLingui();
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
  // Network only: offline or before the first answer the streak is not shown.
  // Pending outbox changes are part of the key, so a sync refreshes it.
  const streakOptions = orpc.nutritionTargets.loggingStreak.queryOptions({ input: { timeZone } });
  const streak = useQuery({
    ...streakOptions,
    queryKey: [
      ...streakOptions.queryKey,
      { offlineScope: outbox.scope, pending: outbox.items.length },
    ],
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
  const undoName = undo?.name ?? "";

  const go = (date: string) => {
    setLocalDate(date);
    announce(t`Showing ${date}`);
  };

  const toggleStatus = () => {
    const complete = status !== "complete";
    outbox.enqueue({
      op: {
        kind: "setDayStatus",
        input: { clientMutationId: newClientMutationId(), localDate, complete },
      },
    });
    const label = i18n._(dayStatusText(complete ? "complete" : "unmarked", 0).label);
    announce(`${localDate}: ${label}`);
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
      const name = row.change.preview?.name ?? "";
      announce(t`Entry removed. ${name}`);
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
    const name = row.entry.food.name;
    announce(t`Entry removed. ${name}`);
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
    const name = undo.name;
    announce(t`Entry restored. ${name}`);
    setUndo(null);
  };

  const clearDeviceData = () =>
    Alert.alert(
      i18n._(DIARY_COPY.clearCache),
      outbox.items.length > 0
        ? t`${plural(outbox.items.length, {
            one: "# unsynced change will be removed from this device.",
            other: "# unsynced changes will be removed from this device.",
          })}`
        : t`Cached diary data will be removed from this device. Saved entries stay on the server.`,
      [
        { text: t`Cancel`, style: "cancel" },
        {
          text: t`Clear`,
          style: "destructive",
          onPress: () => {
            outbox.clearDeviceData();
            announce(t`Diary data cleared from this device`);
          },
        },
      ],
    );

  const slotRows = (slot: MealSlot) =>
    visible.filter(
      (row) =>
        (row.kind === "server"
          ? row.entry.slot
          : row.change.op.kind === "log"
            ? row.change.op.input.slot
            : null) === slot,
    );

  return (
    <Container>
      <Page>
        <PageHeader
          title={i18n._(DIARY_COPY.title)}
          actions={
            <>
              <HeaderLink
                href="/foods"
                icon={Bookmark}
                label={i18n._(CUSTOM_FOOD_COPY.manageLink)}
              />
              <HeaderLink
                href="/nutrition-targets"
                icon={SlidersHorizontal}
                label={i18n._(TARGET_COPY.settingsLink)}
              />
            </>
          }
        />

        <OutboxBanner outbox={outbox} />

        {attention.map((item) => (
          <AttentionCard key={item.id} item={item} outbox={outbox} hideNumbers={hideNumbers} />
        ))}

        {undo ? (
          <Sheet className="flex-row items-center justify-between gap-3 p-4">
            <Text className="flex-1 font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
              {t`Entry removed. ${undoName}`}
            </Text>
            <Button size="sm" variant="outline" onPress={undoDelete}>
              <Button.Label>{i18n._(DIARY_COPY.undo)}</Button.Label>
            </Button>
          </Sheet>
        ) : null}

        <View className="gap-4">
          <View className="flex-row items-center gap-3">
            <ToneIcon icon={UtensilsCrossed} tone="food" size="lg" />
            <View className="min-w-0 flex-1 gap-1">
              <Text
                className="font-display text-2xl font-semibold text-ink"
                accessibilityRole="header"
              >
                {friendlyDate(i18n, localDate)}
              </Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <View accessibilityLiveRegion="polite">
                  <StatusPill tone={status === "complete" ? "good" : "neutral"}>
                    {i18n._(statusText.label)}
                    {pendingStatus ? ` · ${i18n._(SYNC_STATE_LABELS[pendingStatus.status])}` : ""}
                  </StatusPill>
                </View>
                <InfoTip title={i18n._(statusText.label)}>{i18n._(statusText.description)}</InfoTip>
              </View>
            </View>
            <Button
              size="sm"
              variant="outline"
              isIconOnly
              accessibilityLabel={t`Previous`}
              onPress={() => go(shiftLocalDate(localDate, -1))}
            >
              <Icon icon={ChevronLeft} size={18} color="ink-2" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              isIconOnly
              accessibilityLabel={t`Next`}
              onPress={() => go(shiftLocalDate(localDate, 1))}
            >
              <Icon icon={ChevronRight} size={18} color="ink-2" />
            </Button>
          </View>
          <Button size="sm" variant="outline" className="self-start" onPress={toggleStatus}>
            <Icon icon={CircleCheck} size={16} color="ink-2" />
            <Button.Label>
              {i18n._(status === "complete" ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete)}
            </Button.Label>
          </Button>

          {day.isPending && !day.data ? (
            <Sheet className="items-center">
              <Spinner />
            </Sheet>
          ) : day.isError && !day.data ? (
            <ErrorState
              title={i18n._(DIARY_COPY.networkError)}
              action={
                <Button size="sm" variant="outline" onPress={() => void day.refetch()}>
                  <Button.Label>{i18n._(DIARY_COPY.retry)}</Button.Label>
                </Button>
              }
            />
          ) : null}

          <NutritionDayTotals
            totals={summary.totals}
            sources={summarySources}
            pending={pendingRows}
            hideNumbers={hideNumbers}
            targets={targets.data?.targetsOn.targets ?? []}
          />

          <TargetsOnDay targets={targets.data?.targetsOn.targets ?? []} hideNumbers={hideNumbers} />
        </View>

        <LoggingStreakCard streak={streak.isSuccess ? streak.data : undefined} />

        <AddFood
          key={initialQuery}
          initialQuery={initialQuery}
          contextKey={`${outbox.scope ?? "signed-out"}\u001f${sessionKey ?? "signed-out"}\u001f${localDate}\u001f${timeZone}`}
          localDate={localDate}
          timeZone={timeZone}
          foods={foods.data}
          outbox={outbox}
          hideNumbers={hideNumbers}
        />

        <View className="gap-4">
          {MEAL_SLOTS.map((slot) => {
            const rowsInSlot = slotRows(slot);
            return (
              <Sheet key={slot} className="gap-3">
                <View className="flex-row items-center gap-3">
                  <ToneIcon icon={SLOT_ICONS[slot]} tone="food" size="sm" />
                  <Text
                    className="font-display text-xl font-semibold text-ink"
                    accessibilityRole="header"
                  >
                    {i18n._(SLOT_LABELS[slot])}
                  </Text>
                </View>
                {rowsInSlot.length === 0 ? (
                  <Text className="font-sans text-sm text-ink-3">
                    {i18n._(DIARY_COPY.emptySlot)}
                  </Text>
                ) : (
                  rowsInSlot.map((row, index) => (
                    <EntryCard
                      key={row.key}
                      row={row}
                      first={index === 0}
                      outbox={outbox}
                      onDelete={() => remove(row)}
                      hideNumbers={hideNumbers}
                      favorite={
                        row.kind === "server" &&
                        (foods.data?.favorites ?? []).some(
                          (food) =>
                            food.ref.kind === "snapshot" &&
                            food.ref.snapshotId === row.entry.food.snapshotId,
                        )
                      }
                    />
                  ))
                )}
              </Sheet>
            );
          })}

          <CopyDay
            localDate={localDate}
            timeZone={timeZone}
            outbox={outbox}
            hideNumbers={hideNumbers}
          />
        </View>

        <PlainWaterSection
          key={`${outbox.scope ?? "signed-out"}:${localDate}:${timeZone}`}
          localDate={localDate}
          timeZone={timeZone}
          hideNumbers={hideNumbers}
        />

        <Pressable
          onPress={clearDeviceData}
          accessibilityRole="button"
          className="min-h-11 flex-row items-center gap-2 self-start rounded-full px-1 active:opacity-70"
        >
          <Icon icon={Trash2} size={16} color="ink-3" />
          <Text className="font-sans text-sm text-ink-3 underline">
            {i18n._(DIARY_COPY.clearCache)}
          </Text>
        </Pressable>
      </Page>
    </Container>
  );
}

/** A quiet pill link under the page title (my foods, targets). */
function HeaderLink({ href, icon, label }: { href: Href; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        className="min-h-11 flex-row items-center gap-1.5 rounded-full border border-rule bg-card px-4 active:opacity-80"
      >
        <Icon icon={icon} size={16} color="food" />
        <Text className="font-sans text-sm font-medium text-ink-2">{label}</Text>
      </Pressable>
    </Link>
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
  const { i18n } = useLingui();
  if (targets.length === 0) return null;
  return (
    <Details summary={i18n._(TARGET_COPY.yourTargets)}>
      <Sheet className="gap-3" accessibilityLabel={i18n._(TARGET_COPY.yourTargets)}>
        {targets.map((target, index) => (
          <View key={target.id} className={cn("gap-0.5", index > 0 && "border-t border-rule pt-2")}>
            <View className="flex-row flex-wrap items-baseline justify-between gap-x-3">
              <Text className="font-sans text-sm font-semibold text-ink">
                {i18n._(NUTRIENT_LABELS[target.nutrient].label)}
              </Text>
              <Text
                className="font-sans text-sm text-ink"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {formatTarget(target, hideNumbers, i18n)}
              </Text>
            </View>
            <Text className="font-sans text-xs text-ink-3">
              {i18n._(describeTargetSource(target))}
            </Text>
          </View>
        ))}
        <Text className="font-sans text-sm text-ink-3">{i18n._(TARGET_COPY.targetsNote)}</Text>
        <Link href="/nutrition-targets" asChild>
          <Pressable accessibilityRole="link" className="min-h-11 justify-center">
            <Text className="font-sans text-sm text-ink-2 underline">
              {i18n._(TARGET_COPY.settingsLink)}
            </Text>
          </Pressable>
        </Link>
      </Sheet>
    </Details>
  );
}

function OutboxBanner({ outbox }: { outbox: DiaryOutbox }) {
  const { t } = useLingui();
  const { queued, syncing, needs_attention } = outbox.counts;
  if (queued + syncing + needs_attention === 0) return null;
  const parts = [
    queued ? t`${plural(queued, { one: "# queued", other: "# queued" })}` : null,
    syncing ? t`${plural(syncing, { one: "# syncing", other: "# syncing" })}` : null,
    needs_attention
      ? t`${plural(needs_attention, { one: "# needs attention", other: "# need attention" })}`
      : null,
  ].filter(Boolean);
  const partsText = parts.join(", ");
  return (
    <Sheet className="flex-row items-center gap-3 p-4">
      <ToneIcon icon={outbox.online ? RefreshCw : CloudOff} tone="neutral" size="sm" />
      <Text className="flex-1 font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
        {outbox.online
          ? t`Diary changes: ${partsText}`
          : t`Offline. Changes are saved on this device: ${partsText}`}
      </Text>
      <Button size="sm" variant="outline" onPress={() => void outbox.syncNow()}>
        <Button.Label>
          <Trans>Sync now</Trans>
        </Button.Label>
      </Button>
    </Sheet>
  );
}

function describeOp(item: QueuedChange, hideNumbers: boolean, i18n: I18n): string {
  switch (item.op.kind) {
    case "log": {
      const amount = hideNumbers
        ? i18n._(HIDDEN_VALUE)
        : formatAmount(item.op.input.amount, item.op.input.unit, i18n);
      const name = item.preview?.name;
      return name ? i18n._(msg`Log ${name} (${amount})`) : i18n._(msg`Log food (${amount})`);
    }
    case "update": {
      const amount = hideNumbers
        ? i18n._(HIDDEN_VALUE)
        : formatAmount(item.op.input.amount, item.op.input.unit, i18n);
      return i18n._(msg`Change to ${amount}`);
    }
    case "delete":
      return i18n._(msg`Delete entry`);
    case "restore":
      return i18n._(msg`Restore entry`);
    case "setDayStatus": {
      const date = item.op.input.localDate;
      return i18n._(msg`Day marker for ${date}`);
    }
    case "copyDay": {
      const date = item.op.input.toDate;
      return i18n._(msg`Copy into ${date}`);
    }
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
  const { t, i18n } = useLingui();
  const server = item.conflict;
  const change = describeOp(item, hideNumbers, i18n);
  const otherName = server?.food.name ?? "";
  const otherAmount = server
    ? hideNumbers
      ? i18n._(HIDDEN_VALUE)
      : formatAmount(server.amount, server.unit, i18n)
    : "";
  const otherSlot = server ? i18n._(SLOT_LABELS[server.slot]) : "";
  const errorCode = item.lastErrorCode ?? t`unknown`;
  return (
    <Sheet className="gap-3 border-warning/40" accessibilityRole="alert">
      <View className="flex-row items-start gap-3">
        <Icon icon={TriangleAlert} size={20} color="warning" />
        <Text className="flex-1 font-sans text-base font-semibold text-ink">
          {server ? i18n._(DIARY_COPY.conflictTitle) : t`Needs attention: ${change}`}
        </Text>
      </View>
      {server ? (
        <Text className="font-sans text-sm text-ink-2">
          {server.deleted
            ? t`Other version: ${otherName}, deleted. Your change: ${change}.`
            : t`Other version: ${otherName}, ${otherAmount}, ${otherSlot}. Your change: ${change}.`}
        </Text>
      ) : (
        <Text className="font-sans text-sm text-ink-2">
          {t`The server did not accept this change (${errorCode}). It stays on this device until you retry or discard it.`}
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {server ? (
          <>
            <Button size="sm" variant="outline" onPress={() => outbox.keepMine(item.id)}>
              <Button.Label>{i18n._(DIARY_COPY.keepMine)}</Button.Label>
            </Button>
            <Button size="sm" variant="ghost" onPress={() => outbox.discard(item.id)}>
              <Button.Label>{i18n._(DIARY_COPY.keepServer)}</Button.Label>
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onPress={() => outbox.retry(item.id)}>
              <Button.Label>{i18n._(DIARY_COPY.retry)}</Button.Label>
            </Button>
            <Button size="sm" variant="ghost" onPress={() => outbox.discard(item.id)}>
              <Button.Label>
                <Trans>Discard change</Trans>
              </Button.Label>
            </Button>
          </>
        )}
      </View>
    </Sheet>
  );
}

/**
 * Marks a logged food as a favourite (#88 parity with web). Needs the server:
 * a queued offline entry has no stored food yet, so it has no button.
 */
function FavoriteButton({
  snapshotId,
  name,
  favorite,
}: {
  snapshotId: number;
  name: string;
  favorite: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation(orpc.nutritionDiary.setFavorite.mutationOptions());
  const { t, i18n } = useLingui();
  const food = useThemeColor("food");
  const ink3 = useThemeColor("ink-3");
  return (
    <Button
      size="sm"
      variant="ghost"
      isIconOnly
      isDisabled={mutation.isPending}
      accessibilityLabel={
        favorite ? t`Remove from favourites: ${name}` : t`Add to favourites: ${name}`
      }
      accessibilityState={{ selected: favorite }}
      onPress={() =>
        mutation.mutate(
          { snapshotId, favorite: !favorite },
          {
            onSuccess: () => {
              announce(favorite ? t`Removed from favourites` : t`Added to favourites`);
              void queryClient.invalidateQueries({
                queryKey: orpc.nutritionDiary.listFoods.key(),
              });
            },
            onError: () => announce(i18n._(DIARY_COPY.networkError)),
          },
        )
      }
    >
      <Star
        size={18}
        color={favorite ? food : ink3}
        fill={favorite ? food : "transparent"}
        strokeWidth={2}
        aria-hidden
      />
    </Button>
  );
}

function EntryCard({
  row,
  first,
  outbox,
  onDelete,
  hideNumbers,
  favorite,
}: {
  row: DiaryRow;
  first: boolean;
  outbox: DiaryOutbox;
  onDelete: () => void;
  hideNumbers: boolean;
  favorite: boolean;
}) {
  const { t, i18n } = useLingui();
  const name = row.kind === "server" ? row.entry.food.name : (row.change.preview?.name ?? t`Food`);
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
    announce(t`Updated ${name}`);
  };

  const attribution =
    row.kind === "server" && row.entry.food.source === "off" ? row.entry.food.attribution : null;
  const brand = row.kind === "server" ? row.entry.food.brand : null;
  const figure = (key: NutrientKey) =>
    hideNumbers ? i18n._(HIDDEN_VALUE) : formatNutrientValue(key, nutrients?.[key] ?? null, i18n);

  return (
    <View className={cn("gap-2", !first && "border-t border-rule pt-3")}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-1">
            <Text className="shrink font-sans text-base font-semibold text-ink">{name}</Text>
            <InfoTip label={t`Nutrients and source`} title={name}>
              {LEDGER_MACROS.map((key) => (
                <View key={key} className="flex-row justify-between gap-4">
                  <Prose>{i18n._(NUTRIENT_LABELS[key].label)}</Prose>
                  <Prose className="text-ink">{figure(key)}</Prose>
                </View>
              ))}
              <Prose className="text-ink-3">
                {i18n._(foodSourceLabel(source))}
                {brand ? `, ${brand}` : ""}
              </Prose>
              {attribution ? <Prose className="text-ink-3">{attribution}</Prose> : null}
            </InfoTip>
          </View>
          <Text className="font-sans text-sm text-ink-3" style={{ fontVariant: ["tabular-nums"] }}>
            {hideNumbers ? i18n._(HIDDEN_VALUE) : formatAmount(amount, unit, i18n)}
          </Text>
        </View>
        <View className="items-end gap-1">
          <ToneChip tone="food">{figure("energyKcal")}</ToneChip>
          <SyncBadge state={row.sync} />
        </View>
      </View>
      {editing ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            keyboardType="numeric"
            accessibilityLabel={unit === "serving" ? t`Amount in servings` : t`Amount in ${unit}`}
            className={`${inputClass} flex-1`}
          />
          <Button size="sm" onPress={save}>
            <Button.Label>
              <Trans>Save</Trans>
            </Button.Label>
          </Button>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          onPress={() =>
            setEditing((value) => {
              const next = !value;
              if (next) setDraft(hideNumbers ? "" : String(amount));
              return next;
            })
          }
          accessibilityLabel={t`Edit ${name}`}
        >
          <Icon icon={Pencil} size={18} color="ink-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          onPress={onDelete}
          accessibilityLabel={t`Delete ${name}`}
        >
          <Icon icon={Trash2} size={18} color="ink-3" />
        </Button>
        {row.kind === "server" ? (
          <FavoriteButton snapshotId={row.entry.food.snapshotId} name={name} favorite={favorite} />
        ) : null}
      </View>
    </View>
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
  const { i18n } = useLingui();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={cn(
        "min-h-11 flex-row items-center gap-2 rounded-xl px-3 py-2",
        selected ? "bg-sidebar-accent" : "active:bg-paper-3",
      )}
    >
      <Text className="flex-1 font-sans text-sm text-ink">
        {candidate.name}
        <Text className="text-ink-3">
          {candidate.brand ? ` · ${candidate.brand}` : ""} · {i18n._(candidate.sourceLabel)}
        </Text>
      </Text>
      {selected ? <Icon icon={CircleCheck} size={18} color="signal" /> : null}
    </Pressable>
  );
}

function AttributionNotes({ candidates }: { candidates: readonly FoodCandidate[] }) {
  const notices = [...new Set(candidates.flatMap((c) => (c.attribution ? [c.attribution] : [])))];
  return (
    <>
      {notices.map((notice) => (
        <Text key={notice} className="font-sans text-xs text-ink-3">
          {notice}
        </Text>
      ))}
    </>
  );
}

function AddFood({
  initialQuery,
  contextKey,
  localDate,
  timeZone,
  foods,
  outbox,
  hideNumbers,
}: {
  initialQuery: string;
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
  const [open, setOpen] = useState(Boolean(initialQuery));
  const [mode, setMode] = useState<"choose" | "barcode" | "quick">("choose");
  const [slot, setSlot] = useState<MealSlot>("breakfast");
  const [query, setQuery] = useState(initialQuery);
  const [chosen, setChosen] = useState<FoodCandidate | null>(null);
  const [amount, setAmount] = useState("100");
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [quick, setQuick] = useState<QuickAddFields>(EMPTY_QUICK);
  /** Set while the quick-add form is a manual draft started from a barcode. */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [saveAsFood, setSaveAsFood] = useState(false);
  const lifecycle = useAddFoodSaveLifecycle(contextKey);
  const { editable } = lifecycle;
  const { t, i18n } = useLingui();
  const placeholder = usePlaceholderColor();
  const accentForeground = useThemeColor("accent-foreground");

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

  if (!open)
    return (
      <Button onPress={() => setOpen(true)}>
        <Plus size={18} color={accentForeground} strokeWidth={2} aria-hidden />
        <Button.Label>{i18n._(DIARY_COPY.addFood)}</Button.Label>
      </Button>
    );

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
    announce(i18n._(BARCODE_COPY.enterManually));
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
  const missingNote = mode !== "quick" && chosen ? missingDataNote(chosen, i18n) : null;
  const slotLabel = i18n._(SLOT_LABELS[slot]);
  const reviewLine = () => {
    const reviewAmount = hideNumbers
      ? i18n._(HIDDEN_VALUE)
      : formatAmount(Number(amount), unit, i18n);
    const reviewName = mode !== "quick" && chosen ? chosen.name : null;
    const source =
      mode !== "quick" && chosen
        ? i18n._(chosen.sourceLabel)
        : draftNote !== null
          ? t`Entered by you`
          : null;
    if (reviewName && source)
      return t`Review: ${reviewName}, ${reviewAmount}, ${slotLabel}, ${localDate} · ${source}`;
    if (source) return t`Review: ${reviewAmount}, ${slotLabel}, ${localDate} · ${source}`;
    return t`Review: ${reviewAmount}, ${slotLabel}, ${localDate}`;
  };
  const savedText = (name: string) => {
    const meal = i18n._(SLOT_LABELS[slot]);
    return t`Saved ${name} to ${meal} on ${localDate}`;
  };

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
            t`Connect to the internet to save this food. Your diary entry has not been queued.`,
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
          onError: () => announce(i18n._(CUSTOM_FOOD_COPY.networkError)),
          onStored: () => {
            announce(savedText(name));
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
    announce(savedText(name));
    lifecycle.finish(intent);
    close();
    return;
  };

  return (
    <Section title={i18n._(DIARY_COPY.addFood)} icon={Plus} tone="food" sheet>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          icon={Search}
          label={t`Search and recents`}
          selected={mode === "choose"}
          onPress={() => switchMode("choose")}
          disabled={!editable}
        />
        <Chip
          icon={ScanBarcode}
          label={i18n._(BARCODE_COPY.mode)}
          selected={mode === "barcode"}
          onPress={() => switchMode("barcode")}
          disabled={!editable}
        />
        <Chip
          icon={Zap}
          label={t`Quick add`}
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
            placeholder={i18n._(BARCODE_COPY.searchLabel)}
            accessibilityLabel={i18n._(BARCODE_COPY.searchLabel)}
            accessibilityHint={i18n._(BARCODE_COPY.searchHint)}
            className={inputClass}
            placeholderTextColor={placeholder}
          />
          <Text
            className="pt-1 font-sans text-sm font-semibold text-ink-2"
            accessibilityRole="header"
          >
            {i18n._(BARCODE_COPY.savedFoods)}
          </Text>
          {saved.length === 0 ? (
            <Text className="font-sans text-sm text-ink-3">
              {query.trim()
                ? i18n._(BARCODE_COPY.searchEmpty)
                : t`No saved or recent foods yet. Search, scan a barcode or use quick add.`}
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
          <Text
            className="pt-1 font-sans text-sm font-semibold text-ink-2"
            accessibilityRole="header"
          >
            {i18n._(BARCODE_COPY.searchResults)}
          </Text>
          {!outbox.online ? (
            <Text className="font-sans text-sm text-ink-3">
              {i18n._(BARCODE_COPY.searchOffline)}
            </Text>
          ) : !searchable ? (
            <Text className="font-sans text-sm text-ink-3">{i18n._(BARCODE_COPY.searchHint)}</Text>
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
              <Text
                className="font-sans text-sm text-ink-2 underline"
                accessibilityLiveRegion="polite"
              >
                {i18n._(BARCODE_COPY.searchFailed)} {i18n._(DIARY_COPY.retry)}
              </Text>
            </Pressable>
          ) : found.length === 0 ? (
            <Text className="font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
              {i18n._(BARCODE_COPY.searchEmpty)}
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
            <View className="gap-1 rounded-2xl bg-paper-2 p-3">
              <Text className="font-sans text-sm text-ink-2">{draftNote}</Text>
              <Text className="font-sans text-sm text-ink-3">
                {i18n._(BARCODE_COPY.manualNote)}
              </Text>
            </View>
          ) : null}
          <TextInput
            value={quick.name}
            editable={editable}
            onChangeText={lifecycle.bindMutation((name) => setQuick({ ...quick, name }))}
            placeholder={t`Food name`}
            accessibilityLabel={t`Food name`}
            className={inputClass}
            placeholderTextColor={placeholder}
          />
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="font-sans text-sm text-ink-3">
              <Trans>Values per</Trans>
            </Text>
            <TextInput
              value={quick.basisAmount}
              editable={editable}
              onChangeText={lifecycle.bindMutation((basisAmount) =>
                setQuick({ ...quick, basisAmount }),
              )}
              keyboardType="numeric"
              accessibilityLabel={t`Values per amount`}
              className={`${inputClass} w-20`}
            />
            {(["g", "ml", "serving"] as AmountUnit[]).map((option) => (
              <Chip
                key={option}
                label={i18n._(UNIT_LABELS[option])}
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
              placeholder={i18n._(nutrientFieldLabel(key))}
              accessibilityLabel={i18n._(nutrientFieldLabel(key))}
              className={inputClass}
              placeholderTextColor={placeholder}
            />
          ))}
          {draftNote !== null ? (
            <TextInput
              value={quick.barcode ?? ""}
              editable={editable}
              onChangeText={lifecycle.bindMutation((barcode) => setQuick({ ...quick, barcode }))}
              keyboardType="number-pad"
              placeholder={t`Barcode (kept with this food), optional`}
              accessibilityLabel={t`Barcode (kept with this food), optional`}
              className={inputClass}
              placeholderTextColor={placeholder}
            />
          ) : null}
          {!parsed.ok && quick.name ? (
            <Text className="font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
              {i18n._(parsed.error)}
            </Text>
          ) : null}
        </View>
      )}

      <Text className="pt-1 font-sans text-sm text-ink-3">{t`Meal`}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityLabel={t`Meal`}>
        {MEAL_SLOTS.map((option) => (
          <Chip
            key={option}
            icon={SLOT_ICONS[option]}
            label={i18n._(SLOT_LABELS[option])}
            selected={slot === option}
            onPress={() => {
              if (lifecycle.canMutate()) setSlot(option);
            }}
            disabled={!editable}
          />
        ))}
      </View>
      <Text className="pt-1 font-sans text-sm text-ink-3">{t`Amount`}</Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <TextInput
          value={amount}
          editable={editable}
          onChangeText={lifecycle.bindMutation(setAmount)}
          keyboardType="numeric"
          accessibilityLabel={t`Amount`}
          className={`${inputClass} w-24`}
        />
        {units.map((option) => (
          <Chip
            key={option}
            label={i18n._(UNIT_LABELS[option])}
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
          <Icon
            icon={saveAsFood ? SquareCheck : Square}
            size={20}
            color={saveAsFood ? "signal" : "ink-3"}
          />
          <Text className="font-sans text-sm text-ink-2">
            <Trans>Save to my foods for next time</Trans>
          </Text>
        </Pressable>
      ) : null}

      {preview ? (
        <View
          className="gap-1 rounded-2xl bg-food-soft p-3"
          accessibilityLabel={t`Review before saving`}
        >
          <Text className="font-sans text-sm font-semibold text-ink">{reviewLine()}</Text>
          <Text className="font-sans text-sm text-ink-2">
            {formatNutrientSummaryLine(preview, hideNumbers, i18n)}
          </Text>
          {missingNote ? <Text className="font-sans text-sm text-ink-3">{missingNote}</Text> : null}
          {mode !== "quick" && chosen?.attribution ? (
            <Text className="font-sans text-xs text-ink-3">{chosen.attribution}</Text>
          ) : null}
          {mode === "barcode" ? (
            <Text className="font-sans text-xs text-ink-3">{i18n._(BARCODE_COPY.verify)}</Text>
          ) : null}
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={save} isDisabled={!preview || !editable}>
          <Button.Label>{t`Save to ${slotLabel}`}</Button.Label>
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            const wasSaving = !lifecycle.canMutate();
            close();
            announce(
              wasSaving
                ? t`Save cancelled. A food creation already sent may still complete.`
                : t`Nothing saved`,
            );
          }}
        >
          <Trans>Cancel</Trans>
        </Button>
      </View>
    </Section>
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
  const { t, i18n } = useLingui();
  const placeholder = usePlaceholderColor();

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
      setMessage(i18n._(resolution.message));
      announce(i18n._(resolution.message));
      return;
    }
    setLast(raw);
    setOutcome(resolution.outcome);
    announce(i18n._(resolution.outcome.message));
  };

  return (
    <View className="gap-2">
      {scanning ? (
        <BarcodeScanner
          onScanned={(barcode) => {
            if (!canMutate()) return;
            setScanning(false);
            setDigits(barcode);
            announce(i18n._(BARCODE_COPY.scanned(barcode)));
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
          variant="outline"
          onPress={() => {
            if (canMutate()) setScanning(true);
          }}
        >
          <Icon icon={ScanBarcode} size={18} color="food" />
          <Button.Label>{i18n._(BARCODE_COPY.scan)}</Button.Label>
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
          placeholder={i18n._(BARCODE_COPY.digitsLabel)}
          accessibilityLabel={i18n._(BARCODE_COPY.digitsLabel)}
          className={`${inputClass} flex-1`}
          placeholderTextColor={placeholder}
          onSubmitEditing={() => {
            if (canMutate()) void run(digits);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onPress={() => {
            if (canMutate()) void run(digits);
          }}
          isDisabled={busy || disabled}
        >
          {i18n._(busy ? BARCODE_COPY.lookingUp : BARCODE_COPY.lookUp)}
        </Button>
      </View>
      {message ? (
        <Text className="font-sans text-sm text-ink" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {outcome?.kind === "matches" ? (
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink" accessibilityLiveRegion="polite">
            {i18n._(outcome.message)}
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
            variant="ghost"
            isDisabled={disabled}
            onPress={() => {
              if (canMutate()) onManualDraft(outcome.barcode, i18n._(BARCODE_COPY.notThisProduct));
            }}
          >
            {t`Not this product? Enter food manually`}
          </Button>
        </View>
      ) : outcome?.kind === "manual" ? (
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink" accessibilityLiveRegion="polite">
            {i18n._(outcome.message)}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              isDisabled={disabled}
              onPress={() => {
                if (canMutate()) onManualDraft(outcome.barcode, i18n._(outcome.message));
              }}
            >
              {i18n._(BARCODE_COPY.enterManually)}
            </Button>
            {outcome.canRetry && last ? (
              <Button
                size="sm"
                variant="ghost"
                isDisabled={disabled}
                onPress={() => {
                  if (canMutate()) void run(last);
                }}
              >
                {i18n._(BARCODE_COPY.retry)}
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
  const { t, i18n } = useLingui();
  const placeholder = usePlaceholderColor();
  const source = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${fromDate}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate: fromDate } }),
  );
  if (!open)
    return (
      <Button variant="outline" size="sm" className="self-start" onPress={() => setOpen(true)}>
        <Icon icon={Copy} size={16} color="ink-2" />
        <Button.Label>{t`Copy from ${fromDate}`}</Button.Label>
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
    announce(
      t`Copying ${plural(selected.size, { one: "# item", other: "# items" })} to ${localDate}`,
    );
    setSelected(new Set());
    setOpen(false);
  };
  return (
    <Sheet className="gap-3">
      <View className="flex-row items-center gap-3">
        <ToneIcon icon={Copy} tone="food" size="sm" />
        <Text className="font-display text-lg font-semibold text-ink" accessibilityRole="header">
          <Trans>Copy from</Trans>
        </Text>
      </View>
      <TextInput
        value={fromDate}
        onChangeText={(value) => {
          setFromDate(value);
          setSelected(new Set());
        }}
        accessibilityLabel={t`Copy from date`}
        placeholder="YYYY-MM-DD"
        className={inputClass}
        placeholderTextColor={placeholder}
      />
      {fromDate === localDate ? (
        <Text className="font-sans text-sm text-ink-3">
          <Trans>Choose a different day.</Trans>
        </Text>
      ) : null}
      {fromDate !== localDate && entries.length === 0 ? (
        <Text className="font-sans text-sm text-ink-3">{i18n._(DIARY_COPY.empty)}</Text>
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
              <Icon
                icon={checked ? SquareCheck : Square}
                size={20}
                color={checked ? "signal" : "ink-3"}
              />
              <Text className="flex-1 font-sans text-sm text-ink-2">
                {i18n._(SLOT_LABELS[entry.slot])}: {entry.food.name},{" "}
                {hideNumbers ? i18n._(HIDDEN_VALUE) : formatAmount(entry.amount, entry.unit, i18n)}
              </Text>
            </Pressable>
          );
        })
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button size="sm" variant="outline" onPress={confirm} isDisabled={selected.size === 0}>
          <Button.Label>{t`Copy ${selected.size} to ${localDate}`}</Button.Label>
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
          <Trans>Cancel</Trans>
        </Button>
      </View>
    </Sheet>
  );
}
