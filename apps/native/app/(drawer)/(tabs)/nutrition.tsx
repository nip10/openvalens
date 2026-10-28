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
import { NUTRITION_TEMPLATES_COPY } from "@openvalens/api/presenters/nutrition-templates";
import { CUSTOM_FOOD_COPY, nutrientFieldLabel } from "@openvalens/api/presenters/custom-foods";
import {
  BARCODE_COPY,
  candidateFromChoice,
  defaultFoodPortion,
  formatFoodCandidateSummaryLine,
  isSearchable,
  manualDraftFields,
  missingDataNote,
  searchCandidates,
  type BarcodeOutcome,
  type FoodCandidate,
} from "@openvalens/api/presenters/food-lookup";
import {
  DIARY_COPY,
  ENTRY_EDITOR_COPY,
  ADD_FOOD_COPY,
  addFoodToLabel,
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
  mealSlotForLocalTime,
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
import { type Href, Link, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, cn } from "heroui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

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
import { NutritionDatePicker } from "@/components/nutrition-date-picker";
import { NutritionMealActions } from "@/components/nutrition-meal-actions";
import { NutritionTemplatePanel } from "@/components/nutrition-template-panel";
import { PlainWaterSection } from "@/components/plain-water-section";
import { barcodeCacheKey, resolveBarcode } from "@/lib/nutrition/barcode";
import {
  cachedCopyDayInput,
  mergeDay,
  type DiaryRow,
  type QueuedChange,
} from "@/lib/nutrition/outbox";
import { DIARY_CACHE_PREFIX, useDiaryOutbox, type DiaryOutbox } from "@/lib/nutrition/sync";
import { completeAddFoodCreation, useAddFoodSaveLifecycle } from "@/lib/nutrition/save-intent";
import { FoodLoggerDismissal } from "@/lib/nutrition/logger-dismissal";
import { FoodLoggerCapture } from "@/components/food-logger-capture";
import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { canEditLoggerInput, visibleLoggerInput } from "@/lib/nutrition/logger-input";
import { readCache, writeCache } from "@/lib/offline/cache";
import {
  isOfflineWriteTicketCurrent,
  useCacheFirst,
  useOfflineWriteSessionKey,
} from "@/lib/offline/sync";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { NutritionEntryEditor } from "@/components/nutrition-entry-editor";

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
  return row.localEntry?.entry?.nutrients ?? row.change.preview?.nutrients ?? null;
}

export default function NutritionScreen() {
  /** `food` pre-fills the food search, e.g. from a voice draft (#73). Nothing is saved from it. */
  const { food: draftFood } = useLocalSearchParams<{ food?: string }>();
  const initialQuery = typeof draftFood === "string" ? draftFood.trim().slice(0, 200) : "";
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const { t, i18n } = useLingui();
  const [localDate, setLocalDate] = useState(() => localDateIn(timeZone));
  const outbox = useDiaryOutbox();
  const router = useRouter();
  const deepLinkHandled = useRef("");
  const day = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${localDate}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate } }),
  );
  const yesterday = shiftLocalDate(localDate, -1);
  const yesterdayDay = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${yesterday}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate: yesterday } }),
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
  useEffect(() => {
    if (!initialQuery) {
      deepLinkHandled.current = "";
      return;
    }
    if (deepLinkHandled.current === initialQuery) return;
    deepLinkHandled.current = initialQuery;
    router.setParams({ food: undefined });
    router.push({
      pathname: "/log-food",
      params: { food: initialQuery, localDate, timeZone, meal: mealSlotForLocalTime() },
    });
  }, [initialQuery, localDate, router, timeZone]);
  const [undo, setUndo] = useState<{
    entryId?: number;
    revision?: number;
    localMutationId?: string;
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
      const ref =
        row.localEntry?.ref ??
        (row.change.op.kind === "log"
          ? { kind: "pending" as const, mutationId: row.change.id }
          : null);
      const ticket = outbox.beginWrite();
      if (!ref || !ticket) return;
      const result = outbox.deleteEntry(ticket, ref, newClientMutationId());
      if (!result) return;
      const name = row.change.preview?.name ?? "";
      announce(t`Entry removed. ${name}`);
      return;
    }
    const ticket = outbox.beginWrite();
    if (!ticket) return;
    const queued = outbox.enqueueForIntent(ticket, {
      op: {
        kind: "delete",
        input: {
          clientMutationId: newClientMutationId(),
          entryId: row.entry.id,
          expectedRevision: row.entry.revision,
        },
      },
    });
    if (!queued) return;
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
    if (undo.localMutationId) {
      const ticket = outbox.beginWrite();
      if (
        !outbox.deleteEntry(
          ticket,
          { kind: "pending", mutationId: undo.localMutationId },
          newClientMutationId(),
        )
      )
        return;
      announce(t`Entry removed. ${undo.name}`);
      setUndo(null);
      return;
    }
    if (undo.entryId === undefined || undo.revision === undefined) return;
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
          : (row.localEntry?.slot ??
            (row.change.op.kind === "log" ? row.change.op.input.slot : null))) === slot,
    );

  const logUsual = (candidate: FoodCandidate, slot: MealSlot) => {
    const ticket = outbox.beginWrite();
    const mutationId = newClientMutationId();
    if (!ticket || !outbox.scope) return;
    const portion = defaultFoodPortion(candidate);
    const input: LogEntryInput = {
      clientMutationId: mutationId,
      localDate,
      timeZone,
      slot,
      food: candidate.ref,
      amount: portion.amount,
      unit: portion.unit,
      method: candidate.method,
    };
    const nutrients = previewNutrients(
      candidate.basis,
      candidate.nutrientsPerBasis,
      portion.amount,
      portion.unit,
    );
    const stored = outbox.enqueueForIntentWithHandle(ticket, {
      op: { kind: "log", input },
      preview: { name: candidate.name, source: candidate.source, nutrients },
    });
    if (!stored) return;
    setUndo({ localMutationId: mutationId, name: candidate.name });
    announce(t`Saved ${candidate.name} to ${i18n._(SLOT_LABELS[slot])} on ${localDate}`);
  };

  const copyMealEntries = (
    entries: readonly DiaryEntry[],
    fromDate: string,
    toDate: string,
    slot: MealSlot,
  ) => {
    const selected = entries.filter((entry) => entry.slot === slot && !entry.deleted);
    if (!selected.length || !outbox.scope) return;
    const ticket = outbox.beginWrite();
    if (!ticket) return;
    const input = cachedCopyDayInput({
      clientMutationId: newClientMutationId(),
      fromDate,
      toDate,
      timeZone,
      targetSlot: slot,
      entries: selected.map((entry, index) => ({
        itemKey: `meal-${entry.id}-${index}`,
        snapshotId: entry.food.snapshotId,
        amount: entry.amount,
        unit: entry.unit,
        slot,
        preview: { name: entry.food.name, source: entry.food.source, nutrients: entry.nutrients },
      })),
    });
    const result = outbox.enqueueForIntentWithHandle(ticket, input);
    if (result) announce(t`Copied ${i18n._(SLOT_LABELS[slot])} to ${toDate}`);
  };

  return (
    <Container>
      <Page>
        <ModuleHiddenNote module="food" />
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
              <View accessibilityRole="header">
                <NutritionDatePicker
                  value={localDate}
                  onChange={go}
                  label={i18n._(DIARY_COPY.title)}
                  compact
                  accessibilityLabel={t`Choose diary date`}
                />
              </View>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <View accessibilityLiveRegion="polite">
                  <StatusPill tone={status === "complete" ? "good" : "neutral"}>
                    {i18n._(statusText.label)}
                    {pendingStatus ? `, ${i18n._(SYNC_STATE_LABELS[pendingStatus.status])}` : ""}
                  </StatusPill>
                </View>
                <InfoTip title={i18n._(statusText.label)}>{i18n._(statusText.description)}</InfoTip>
                <Button size="sm" variant="outline" className="min-h-11" onPress={toggleStatus}>
                  <Icon icon={CircleCheck} size={16} color="ink-2" />
                  <Button.Label>
                    {i18n._(
                      status === "complete" ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete,
                    )}
                  </Button.Label>
                </Button>
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
            compact
          />

          <TargetsOnDay targets={targets.data?.targetsOn.targets ?? []} hideNumbers={hideNumbers} />
        </View>

        <View className="gap-2">
          {MEAL_SLOTS.map((slot) => {
            const rowsInSlot = slotRows(slot);
            return (
              <Sheet key={slot} className={rowsInSlot.length ? "gap-3" : "px-3 py-1"}>
                <View className="min-h-11 flex-row items-center gap-3">
                  <ToneIcon icon={SLOT_ICONS[slot]} tone="food" size="sm" />
                  <Text
                    className="font-display text-lg font-semibold text-ink"
                    accessibilityRole="header"
                  >
                    {i18n._(SLOT_LABELS[slot])}
                  </Text>
                  <Button
                    variant="outline"
                    isIconOnly
                    className="min-h-11 min-w-11"
                    accessibilityLabel={i18n._(addFoodToLabel(i18n._(SLOT_LABELS[slot])))}
                    onPress={() =>
                      router.push({
                        pathname: "/log-food",
                        params: { localDate, timeZone, meal: slot },
                      })
                    }
                  >
                    <Icon icon={Plus} size={18} color="food" />
                  </Button>
                  <NutritionMealActions
                    mealLabel={i18n._(SLOT_LABELS[slot])}
                    localDate={localDate}
                    hasEntries={rowsInSlot.length > 0}
                    onCopyYesterday={() =>
                      copyMealEntries(yesterdayDay.data?.entries ?? [], yesterday, localDate, slot)
                    }
                    onCopyToDate={(date) =>
                      copyMealEntries(day.data?.entries ?? [], localDate, date, slot)
                    }
                    onSaveAsMeal={() =>
                      router.push({
                        pathname: "/log-food",
                        params: {
                          mode: "templates",
                          localDate,
                          timeZone,
                          meal: slot,
                          seedDate: localDate,
                          seedSlot: slot,
                        },
                      })
                    }
                  />
                </View>
                {(foods.data?.recents ?? [])
                  .filter((food) => !food.lastSlot || food.lastSlot === slot)
                  .slice(0, 3)
                  .map((food) => {
                    const candidate = candidateFromChoice(food);
                    return (
                      <Button
                        key={`usual-${candidate.key}`}
                        variant="ghost"
                        className="min-h-11 self-start"
                        onPress={() => logUsual(candidate, slot)}
                      >
                        <Button.Label>{t`Add usual: ${food.name}`}</Button.Label>
                      </Button>
                    );
                  })}
                {rowsInSlot.length > 0
                  ? rowsInSlot.map((row, index) => (
                      <EntryCard
                        key={row.key}
                        row={row}
                        first={index === 0}
                        outbox={outbox}
                        onDelete={() => remove(row)}
                        hideNumbers={hideNumbers}
                        localDate={localDate}
                        timeZone={timeZone}
                        foods={foods.data}
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
                  : null}
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

        <LoggingStreakCard streak={streak.isSuccess ? streak.data : undefined} />

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
    case "logTemplate":
      return i18n._(msg`Log saved meal`);
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
  localDate,
  timeZone,
  foods,
}: {
  row: DiaryRow;
  first: boolean;
  outbox: DiaryOutbox;
  onDelete: () => void;
  hideNumbers: boolean;
  favorite: boolean;
  localDate: string;
  timeZone: string;
  foods: { recents: FoodChoice[]; favorites: FoodChoice[]; customFoods: FoodChoice[] } | undefined;
}) {
  const sessionKey = useOfflineWriteSessionKey();
  const { t, i18n } = useLingui();
  const name =
    row.kind === "server"
      ? row.entry.food.name
      : (row.localEntry?.entry?.food.name ?? row.change.preview?.name ?? t`Food`);
  const amount =
    row.kind === "server"
      ? row.entry.amount
      : (row.localEntry?.amount ??
        (row.change.op.kind === "log" ? row.change.op.input.amount : null));
  const localUnit = row.kind === "local" ? row.localEntry?.unit : undefined;
  const unit: AmountUnit =
    row.kind === "server"
      ? row.entry.unit
      : localUnit === "g" || localUnit === "ml" || localUnit === "serving"
        ? localUnit
        : row.change.op.kind === "log"
          ? row.change.op.input.unit
          : "g";
  const source =
    row.kind === "server"
      ? row.entry.food.source
      : (row.localEntry?.entry?.food.source ?? row.change.preview?.source ?? "manual");
  const nutrients = rowNutrients(row);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(amount));
  const [draftUnit, setDraftUnit] = useState<AmountUnit>(unit);
  const initialSlot =
    row.kind === "server"
      ? row.entry.slot
      : (row.localEntry?.slot ??
        (row.change.op.kind === "log" ? row.change.op.input.slot : "other"));
  const initialDate =
    row.kind === "server"
      ? row.entry.localDate
      : (row.localEntry?.localDate ??
        (row.change.op.kind === "log" ? row.change.op.input.localDate : localDate));
  const [draftSlot, setDraftSlot] = useState<MealSlot>(initialSlot);
  const [draftDate, setDraftDate] = useState(initialDate);
  const [generation, setGeneration] = useState(0);
  const liveGeneration = useRef(0);
  const liveSessionKey = useRef(sessionKey);
  const editorSessionKey = useRef<string | null>(null);
  liveSessionKey.current = sessionKey;
  useLayoutEffect(() => {
    return () => {
      liveGeneration.current += 1;
    };
  }, [outbox.scope, localDate, timeZone, row.key, sessionKey]);
  const queryClient = useQueryClient();
  const favoriteMutation = useMutation(orpc.nutritionDiary.setFavorite.mutationOptions());
  const cachedCandidate = foods
    ? [...foods.favorites, ...foods.recents, ...foods.customFoods]
        .map(candidateFromChoice)
        .find((candidate) => {
          if (row.kind === "server") {
            return (
              candidate.ref.kind === "snapshot" &&
              candidate.ref.snapshotId === row.entry.food.snapshotId
            );
          }
          return (
            row.change.op.kind === "log" &&
            row.change.op.input.food.kind !== "manual" &&
            JSON.stringify(candidate.ref) === JSON.stringify(row.change.op.input.food)
          );
        })
    : undefined;
  const basis =
    row.kind === "server"
      ? row.entry.food.basis
      : (row.localEntry?.entry?.food.basis ??
        (row.change.op.kind === "log" && row.change.op.input.food.kind === "manual"
          ? {
              nutrientBasisAmount: row.change.op.input.food.food.nutrientBasisAmount,
              nutrientBasisUnit: row.change.op.input.food.food.nutrientBasisUnit,
              servingSizeAmount: row.change.op.input.food.food.servingSizeAmount ?? null,
              servingSizeUnit: row.change.op.input.food.food.servingSizeUnit ?? null,
              servingLabel: row.change.op.input.food.food.servingLabel ?? null,
            }
          : cachedCandidate?.basis));
  const allowedUnits = basis ? unitsFor(basis) : [];
  const editorUnits = allowedUnits.length ? allowedUnits : [unit];
  const perBasis =
    row.kind === "server"
      ? row.entry.food.nutrientsPerBasis
      : (row.localEntry?.entry?.food.nutrientsPerBasis ??
        (row.change.op.kind === "log" && row.change.op.input.food.kind === "manual"
          ? row.change.op.input.food.food.nutrients
          : cachedCandidate?.nutrientsPerBasis));
  const editorNutrients =
    basis && perBasis && draft.trim() && Number.isFinite(Number(draft))
      ? previewNutrients(
          basis,
          Object.fromEntries(
            Object.keys(NUTRIENT_LABELS).map((key) => [key, perBasis[key as NutrientKey] ?? null]),
          ) as DiaryEntry["nutrients"],
          Number(draft),
          draftUnit,
        )
      : null;
  const editorPreview = formatNutrientSummaryLine(
    editorNutrients ?? emptyNutrients(),
    hideNumbers,
    i18n,
  );
  const openEditor = () => {
    liveGeneration.current += 1;
    setGeneration(liveGeneration.current);
    editorSessionKey.current = sessionKey;
    setDraft(String(amount));
    setDraftUnit(unit);
    setDraftSlot(initialSlot);
    setDraftDate(initialDate);
    setEditing(true);
  };
  const save = () => {
    if (
      !sessionKey ||
      sessionKey !== liveSessionKey.current ||
      sessionKey !== editorSessionKey.current ||
      generation !== liveGeneration.current
    )
      return;
    const value = Number(draft);
    if (amount === null || !Number.isFinite(value) || value <= 0) return;
    const ticket = outbox.beginWrite();
    const ref =
      row.kind === "server"
        ? { kind: "server" as const, entryId: row.entry.id, revision: row.entry.revision }
        : (row.localEntry?.ref ??
          (row.change.op.kind === "log"
            ? { kind: "pending" as const, mutationId: row.change.id }
            : null));
    if (!ref) return;
    const result = outbox.updateEntry(
      ticket,
      ref,
      {
        clientMutationId: newClientMutationId(),
        amount: value,
        unit: draftUnit,
        slot: draftSlot,
        localDate: draftDate,
        timeZone,
      },
      row.kind === "server" ? row.entry : undefined,
    );
    if (result) {
      setEditing(false);
      liveGeneration.current += 1;
      announce(t`Updated ${name}`);
    }
  };
  const closeEditor = () => {
    liveGeneration.current += 1;
    setEditing(false);
  };
  const editorFavorite =
    row.kind === "server"
      ? () => {
          if (
            !sessionKey ||
            sessionKey !== liveSessionKey.current ||
            sessionKey !== editorSessionKey.current ||
            generation !== liveGeneration.current ||
            !editing
          )
            return;
          favoriteMutation.mutate(
            { snapshotId: row.entry.food.snapshotId, favorite: !favorite },
            {
              onSuccess: () => {
                announce(favorite ? t`Removed from favourites` : t`Added to favourites`);
                void queryClient.invalidateQueries({
                  queryKey: orpc.nutritionDiary.listFoods.key(),
                });
              },
              onError: () => announce(i18n._(DIARY_COPY.networkError)),
            },
          );
        }
      : undefined;

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
            {hideNumbers
              ? i18n._(HIDDEN_VALUE)
              : amount === null
                ? ""
                : formatAmount(amount, unit, i18n)}
          </Text>
        </View>
        <View className="items-end gap-1">
          <ToneChip tone="food">{figure("energyKcal")}</ToneChip>
          <SyncBadge state={row.sync} />
        </View>
      </View>
      <NutritionEntryEditor
        visible={editing}
        name={name}
        amount={draft}
        unit={draftUnit}
        slot={draftSlot}
        localDate={draftDate}
        units={editorUnits}
        hideNumbers={hideNumbers}
        preview={editorPreview}
        labels={
          Object.fromEntries(
            Object.entries(ENTRY_EDITOR_COPY).map(([key, value]) => [key, i18n._(value)]),
          ) as Record<keyof typeof ENTRY_EDITOR_COPY, string>
        }
        slotLabels={
          Object.fromEntries(MEAL_SLOTS.map((slot) => [slot, i18n._(SLOT_LABELS[slot])])) as Record<
            MealSlot,
            string
          >
        }
        onAmount={setDraft}
        onUnit={setDraftUnit}
        onSlot={setDraftSlot}
        onDate={setDraftDate}
        onSave={save}
        onDelete={() => {
          if (
            !sessionKey ||
            sessionKey !== liveSessionKey.current ||
            sessionKey !== editorSessionKey.current ||
            generation !== liveGeneration.current ||
            !editing
          )
            return;
          closeEditor();
          onDelete();
        }}
        onFavorite={editorFavorite}
        onClose={closeEditor}
      />
      <View className="flex-row flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          onPress={openEditor}
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
  hideNumbers,
  onQuickLog,
  quickLogLabel,
}: {
  candidate: FoodCandidate;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  hideNumbers: boolean;
  onQuickLog?: () => void;
  quickLogLabel?: string;
}) {
  const { i18n } = useLingui();
  const summary = formatFoodCandidateSummaryLine(candidate, hideNumbers, i18n);
  const accessibleLabel = [candidate.name, candidate.brand, i18n._(candidate.sourceLabel), summary]
    .filter(Boolean)
    .join(", ");
  const row = (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      accessibilityState={{ selected }}
      className={cn(
        "min-h-11 flex-row items-center gap-2 rounded-xl px-3 py-2",
        selected ? "bg-sidebar-accent" : "active:bg-paper-3",
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans text-sm text-ink">
          {candidate.name}
          <Text className="text-ink-3">
            {candidate.brand ? `, ${candidate.brand}` : ""}, {i18n._(candidate.sourceLabel)}
          </Text>
        </Text>
        <Text className="font-sans text-xs text-ink-3">{summary}</Text>
      </View>
      {selected ? <Icon icon={CircleCheck} size={18} color="signal" /> : null}
    </Pressable>
  );
  if (!onQuickLog) return row;
  return (
    <View className="flex-row items-center gap-1">
      <View className="min-w-0 flex-1">{row}</View>
      <Pressable
        onPress={onQuickLog}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={quickLogLabel ?? `Add ${candidate.name}`}
        className={cn(
          "min-h-11 min-w-11 items-center justify-center rounded-full border border-rule bg-card",
          disabled && "opacity-55",
        )}
      >
        <Icon icon={Plus} size={18} color="food" />
      </Pressable>
    </View>
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

export type AddFoodLoggerProps = {
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
  initialMeal: MealSlot;
  initialMode?: "choose" | "describe" | "templates";
  recipeImportEnabled?: boolean;
  seedIngredients?: readonly (import("@openvalens/api/presenters/nutrition-templates").NutritionTemplateIngredientInput & {
    name?: string;
  })[];
  voiceDraftsEnabled?: boolean;
  photoDraftsEnabled?: boolean;
  onClose: () => void;
};

export function AddFood({
  initialQuery,
  contextKey,
  localDate,
  timeZone,
  foods,
  outbox,
  hideNumbers,
  initialMeal,
  initialMode = "choose",
  recipeImportEnabled = false,
  seedIngredients,
  voiceDraftsEnabled = false,
  photoDraftsEnabled = false,
  onClose,
}: AddFoodLoggerProps) {
  const [mode, setMode] = useState<
    "choose" | "barcode" | "quick" | "describe" | "photo" | "templates"
  >(initialMode);
  const [slot, setSlot] = useState<MealSlot>(initialMeal);
  const [query, setQuery] = useState(initialQuery);
  const [chosen, setChosen] = useState<FoodCandidate | null>(null);
  const searchInput = useRef<TextInput>(null);
  const dismissalState = useRef<FoodLoggerDismissal | null>(null);
  if (dismissalState.current === null) dismissalState.current = new FoodLoggerDismissal();
  const [amount, setAmount] = useState("100");
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [quick, setQuick] = useState<QuickAddFields>(EMPTY_QUICK);
  /** Set while the quick-add form is a manual draft started from a barcode. */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [saveAsFood, setSaveAsFood] = useState(false);
  const [quickUndo, setQuickUndo] = useState<{ mutationId: string; name: string } | null>(null);
  const [captureItems, setCaptureItems] = useState<FoodDraftCandidateWire[]>([]);
  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
  const [completedCaptureIds, setCompletedCaptureIds] = useState<string[]>([]);
  const [captureReturnMode, setCaptureReturnMode] = useState<"describe" | "photo">("describe");
  const lifecycle = useAddFoodSaveLifecycle(contextKey);
  const { editable } = lifecycle;
  const { t, i18n } = useLingui();
  const placeholder = usePlaceholderColor();

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
    enabled: mode === "choose" && searchable && outbox.online,
    staleTime: 60_000,
  });
  const found = useMemo(
    () => searchCandidates(search.data?.results ?? [], savedIds),
    [search.data, savedIds],
  );

  const select = (candidate: FoodCandidate) => {
    if (!lifecycle.canMutate()) return;
    Keyboard.dismiss();
    setChosen(candidate);
    const portion = defaultFoodPortion(candidate);
    setUnit(portion.unit);
    setAmount(String(portion.amount));
  };

  const switchMode = (next: typeof mode) => {
    if (!lifecycle.canMutate()) return;
    setMode(next);
    if (next === "describe" || next === "photo") setCaptureReturnMode(next);
    setChosen(null);
    if (next !== "quick") setDraftNote(null);
  };

  const selectCaptureItem = (item: FoodDraftCandidateWire) => {
    if (!lifecycle.canMutate()) return;
    setActiveCaptureId(item.id);
    setQuery(item.foodText);
    setChosen(null);
    setMode("choose");
  };

  const returnToCapture = () => {
    if (!activeCaptureId || !lifecycle.canMutate()) return;
    setCompletedCaptureIds((ids) =>
      ids.includes(activeCaptureId) ? ids : [...ids, activeCaptureId],
    );
    setActiveCaptureId(null);
    setChosen(null);
    setQuery("");
    setAmount("100");
    setUnit("g");
    setMode(captureReturnMode);
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
    Keyboard.dismiss();
    lifecycle.invalidate();
    setChosen(null);
    setQuick(EMPTY_QUICK);
    setDraftNote(null);
    setMode("choose");
    onClose();
  };
  const cancel = () => {
    const message = dismissalState.current!.dismiss();
    if (!message) return;
    close();
    announce(
      i18n._(
        message === "nothing_saved"
          ? ADD_FOOD_COPY.nothingSaved
          : ADD_FOOD_COPY.pendingFoodCreationCancelled,
      ),
    );
  };
  useEffect(() => {
    if (mode !== "choose") return;
    const timer = setTimeout(() => searchInput.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [mode]);
  useEffect(() => {
    return () => {
      lifecycle.controller.invalidate();
      const message = dismissalState.current?.dismiss();
      if (message) {
        const descriptor =
          message === "nothing_saved"
            ? ADD_FOOD_COPY.nothingSaved
            : ADD_FOOD_COPY.pendingFoodCreationCancelled;
        announce(i18n._(descriptor));
      }
    };
  }, [i18n, lifecycle.controller]);

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
      return t`Review: ${reviewName}, ${reviewAmount}, ${slotLabel}, ${localDate} (${source})`;
    if (source) return t`Review: ${reviewAmount}, ${slotLabel}, ${localDate} (${source})`;
    return t`Review: ${reviewAmount}, ${slotLabel}, ${localDate}`;
  };
  const savedText = (name: string) => {
    const meal = i18n._(SLOT_LABELS[slot]);
    return t`Saved ${name} to ${meal} on ${localDate}`;
  };

  const quickLog = (candidate: FoodCandidate) => {
    if (!lifecycle.canMutate() || activeCaptureId) return;
    const ticket = outbox.beginWrite();
    const ownerScope = outbox.scope;
    if (!ticket || !ownerScope || !isOfflineWriteTicketCurrent(ticket, ownerScope)) return;
    const portion = defaultFoodPortion(candidate);
    const intent = lifecycle.begin(
      ticket,
      JSON.stringify([candidate.ref, slot, localDate, portion]),
      newClientMutationId,
    );
    if (!intent) return;
    const mutationId = intent.diaryMutationId;
    const stored = outbox.enqueueForIntent(ticket, {
      op: {
        kind: "log",
        input: {
          clientMutationId: mutationId,
          localDate,
          timeZone,
          slot,
          food: candidate.ref,
          amount: portion.amount,
          unit: portion.unit,
          method: candidate.method,
        },
      },
      preview: {
        name: candidate.name,
        source: candidate.source,
        nutrients: previewNutrients(
          candidate.basis,
          candidate.nutrientsPerBasis,
          portion.amount,
          portion.unit,
        ),
      },
    });
    if (!stored || outbox.scope !== ownerScope || !lifecycle.controller.isCurrent(intent)) {
      lifecycle.release(intent);
      return;
    }
    lifecycle.finish(intent);
    dismissalState.current!.markSaved();
    setQuickUndo({ mutationId, name: candidate.name });
    announce(savedText(candidate.name));
  };
  const undoQuickLog = () => {
    if (!quickUndo || !lifecycle.canMutate()) return;
    const ticket = outbox.beginWrite();
    if (
      !ticket ||
      !outbox.deleteEntry(
        ticket,
        { kind: "pending", mutationId: quickUndo.mutationId },
        newClientMutationId(),
      )
    )
      return;
    announce(t`Entry removed. ${quickUndo.name}`);
    setQuickUndo(null);
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
        dismissalState.current!.markCreateDispatched();
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
            dismissalState.current!.markSaved();
            announce(savedText(name));
            if (activeCaptureId) returnToCapture();
            else close();
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
    dismissalState.current!.markSaved();
    lifecycle.finish(intent);
    if (activeCaptureId) returnToCapture();
    else close();
    return;
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1">
        <View className="min-h-12 flex-row items-center justify-between">
          <Text className="font-display text-xl font-semibold text-ink" accessibilityRole="header">
            {i18n._(DIARY_COPY.addFood)}
          </Text>
          <Button className="min-h-11" variant="ghost" onPress={cancel}>
            <Button.Label>{t`Cancel`}</Button.Label>
          </Button>
        </View>
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-3 pb-4"
        >
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
                icon={Bookmark}
                label={i18n._(NUTRITION_TEMPLATES_COPY.title)}
                selected={mode === "templates"}
                onPress={() => switchMode("templates")}
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
              {voiceDraftsEnabled ? (
                <Chip
                  icon={Search}
                  label={t`Describe`}
                  selected={mode === "describe"}
                  onPress={() => switchMode("describe")}
                  disabled={!editable}
                />
              ) : null}
              {photoDraftsEnabled ? (
                <Chip
                  icon={ScanBarcode}
                  label={t`Photo`}
                  selected={mode === "photo"}
                  onPress={() => switchMode("photo")}
                  disabled={!editable}
                />
              ) : null}
            </View>
            {mode === "templates" ? (
              <NutritionTemplatePanel
                localDate={localDate}
                timeZone={timeZone}
                slot={slot}
                hideNumbers={hideNumbers}
                ownerKey={contextKey}
                seedIngredients={seedIngredients}
                recipeImportEnabled={recipeImportEnabled}
                onLogged={() => dismissalState.current!.markSaved()}
              />
            ) : mode === "choose" ? (
              <View className="gap-2">
                {chosen ? (
                  <View className="flex-row items-center justify-between rounded-xl bg-food-soft p-3">
                    <View className="min-w-0 flex-1">
                      <Text className="font-sans text-sm font-semibold text-ink">
                        {chosen.name}
                      </Text>
                      <Text className="font-sans text-xs text-ink-3">
                        {i18n._(chosen.sourceLabel)}
                      </Text>
                    </View>
                    <Button
                      className="min-h-11"
                      variant="outline"
                      onPress={() => {
                        if (!lifecycle.canMutate()) return;
                        setChosen(null);
                        setTimeout(() => searchInput.current?.focus(), 100);
                      }}
                    >
                      <Button.Label>{t`Change`}</Button.Label>
                    </Button>
                  </View>
                ) : (
                  <>
                    <TextInput
                      ref={searchInput}
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
                            selected={false}
                            onPress={() => select(candidate)}
                            disabled={!editable}
                            hideNumbers={hideNumbers}
                            onQuickLog={activeCaptureId ? undefined : () => quickLog(candidate)}
                            quickLogLabel={t`Add ${candidate.name} to ${slotLabel}`}
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
                      <Text className="font-sans text-sm text-ink-3">
                        {i18n._(BARCODE_COPY.searchHint)}
                      </Text>
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
                      <Text
                        className="font-sans text-sm text-ink-3"
                        accessibilityLiveRegion="polite"
                      >
                        {i18n._(BARCODE_COPY.searchEmpty)}
                      </Text>
                    ) : (
                      <>
                        {found.slice(0, 20).map((candidate) => (
                          <CandidateRow
                            key={candidate.key}
                            candidate={candidate}
                            selected={false}
                            onPress={() => select(candidate)}
                            disabled={!editable}
                            hideNumbers={hideNumbers}
                          />
                        ))}
                        <AttributionNotes candidates={found.slice(0, 20)} />
                      </>
                    )}
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
                hideNumbers={hideNumbers}
              />
            ) : mode === "describe" || mode === "photo" ? (
              <View className="gap-3">
                <FoodLoggerCapture
                  mode={mode}
                  available={mode === "describe" ? voiceDraftsEnabled : photoDraftsEnabled}
                  canMutate={lifecycle.canMutate()}
                  hideNumbers={hideNumbers}
                  onCandidates={(items) => {
                    if (!lifecycle.canMutate()) return;
                    setCaptureItems(items);
                  }}
                />
                {captureItems.map((item) => {
                  const done = completedCaptureIds.includes(item.id);
                  return (
                    <Sheet key={item.id} className="flex-row flex-wrap items-center gap-2 p-3">
                      <View className="min-w-0 flex-1 gap-1">
                        <Text className="font-sans text-sm font-semibold text-ink">
                          {item.foodText}
                        </Text>
                        <Text className="font-sans text-xs text-ink-3">
                          {hideNumbers
                            ? i18n._(HIDDEN_VALUE)
                            : (item.quantityText ?? t`No quantity`)}
                          {item.unitText ? ` · ${item.unitText}` : ""}
                        </Text>
                      </View>
                      {done ? (
                        <Text className="font-sans text-sm text-ink-3">{t`Done`}</Text>
                      ) : (
                        <Button
                          className="min-h-11"
                          variant="outline"
                          isDisabled={!editable}
                          onPress={() => selectCaptureItem(item)}
                        >
                          <Button.Label>{t`Match food and review`}</Button.Label>
                        </Button>
                      )}
                    </Sheet>
                  );
                })}
              </View>
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
                    value={visibleLoggerInput(quick.basisAmount, hideNumbers)}
                    editable={editable && canEditLoggerInput(hideNumbers)}
                    placeholder={canEditLoggerInput(hideNumbers) ? undefined : i18n._(HIDDEN_VALUE)}
                    onChangeText={(basisAmount) => {
                      if (lifecycle.canMutate() && canEditLoggerInput(hideNumbers))
                        setQuick({ ...quick, basisAmount });
                    }}
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
                    value={visibleLoggerInput(quick.nutrients[key] ?? "", hideNumbers)}
                    editable={editable && canEditLoggerInput(hideNumbers)}
                    onChangeText={(text) => {
                      if (lifecycle.canMutate() && canEditLoggerInput(hideNumbers))
                        setQuick({
                          ...quick,
                          nutrients: { ...quick.nutrients, [key]: text },
                        });
                    }}
                    keyboardType="numeric"
                    placeholder={
                      canEditLoggerInput(hideNumbers)
                        ? i18n._(nutrientFieldLabel(key))
                        : i18n._(HIDDEN_VALUE)
                    }
                    accessibilityLabel={i18n._(nutrientFieldLabel(key))}
                    className={inputClass}
                    placeholderTextColor={placeholder}
                  />
                ))}
                {draftNote !== null ? (
                  <TextInput
                    value={quick.barcode ?? ""}
                    editable={editable}
                    onChangeText={lifecycle.bindMutation((barcode) =>
                      setQuick({ ...quick, barcode }),
                    )}
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

            {mode !== "templates" ? (
              <>
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
                    value={visibleLoggerInput(amount, hideNumbers)}
                    editable={editable && canEditLoggerInput(hideNumbers)}
                    placeholder={canEditLoggerInput(hideNumbers) ? undefined : i18n._(HIDDEN_VALUE)}
                    onChangeText={(value) => {
                      if (lifecycle.canMutate() && canEditLoggerInput(hideNumbers))
                        setAmount(value);
                    }}
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
                    {missingNote ? (
                      <Text className="font-sans text-sm text-ink-3">{missingNote}</Text>
                    ) : null}
                    {mode !== "quick" && chosen?.attribution ? (
                      <Text className="font-sans text-xs text-ink-3">{chosen.attribution}</Text>
                    ) : null}
                    {mode === "barcode" ? (
                      <Text className="font-sans text-xs text-ink-3">
                        {i18n._(BARCODE_COPY.verify)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {activeCaptureId ? (
                  <Button
                    variant="outline"
                    className="min-h-11 self-start"
                    isDisabled={!editable}
                    onPress={() => switchMode(captureReturnMode)}
                  >
                    <Button.Label>{t`Back to draft checklist`}</Button.Label>
                  </Button>
                ) : null}
              </>
            ) : null}
          </Section>
        </ScrollView>
        {mode !== "templates" ? (
          <View className="border-t border-rule bg-background py-3">
            {quickUndo ? (
              <View className="mb-2 flex-row items-center justify-between gap-3">
                <Text
                  className="flex-1 text-sm text-ink-2"
                  accessibilityLiveRegion="polite"
                >{t`Saved ${quickUndo.name}`}</Text>
                <Button size="sm" variant="outline" onPress={undoQuickLog}>
                  <Button.Label>{i18n._(DIARY_COPY.undo)}</Button.Label>
                </Button>
              </View>
            ) : null}
            <Button className="min-h-11" onPress={save} isDisabled={!preview || !editable}>
              <Button.Label>{t`Save to ${slotLabel}`}</Button.Label>
            </Button>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
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
  hideNumbers,
}: {
  outbox: DiaryOutbox;
  chosen: FoodCandidate | null;
  onSelect: (candidate: FoodCandidate) => void;
  onManualDraft: (barcode: string | null, note: string) => void;
  disabled: boolean;
  canMutate: () => boolean;
  hideNumbers: boolean;
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
              hideNumbers={hideNumbers}
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
  const [targetSlot, setTargetSlot] = useState<MealSlot | null>(null);
  const { t, i18n } = useLingui();
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
    if (!outbox.scope || (fromDate === localDate && !targetSlot)) return;
    const ticket = outbox.beginWrite();
    const queued = outbox.enqueueForIntentWithHandle(
      ticket,
      cachedCopyDayInput({
        clientMutationId: newClientMutationId(),
        fromDate,
        toDate: localDate,
        timeZone,
        entries: entries
          .filter((entry) => selected.has(entry.id))
          .map((entry) => ({
            itemKey: String(entry.id),
            snapshotId: entry.food.snapshotId,
            amount: entry.amount,
            unit: entry.unit,
            slot: targetSlot ?? entry.slot,
            preview: {
              name: entry.food.name,
              source: entry.food.source,
              nutrients: entry.nutrients,
            },
          })),
        ...(targetSlot ? { targetSlot } : {}),
      }),
    );
    if (!queued) return;
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
      <View className="flex-row flex-wrap gap-2">
        <Button
          className="min-h-11"
          variant="outline"
          onPress={() => {
            setFromDate(shiftLocalDate(localDate, -1));
            setSelected(new Set());
            setTargetSlot(null);
          }}
        >
          <Button.Label>{t`Yesterday`}</Button.Label>
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          onPress={() => {
            setFromDate(shiftLocalDate(localDate, -7));
            setSelected(new Set());
            setTargetSlot(null);
          }}
        >
          <Button.Label>{t`Same weekday last week`}</Button.Label>
        </Button>
      </View>
      <NutritionDatePicker
        value={fromDate}
        onChange={(value) => {
          setFromDate(value);
          setSelected(new Set());
          setTargetSlot(null);
        }}
        label={t`Copy from date`}
      />
      {fromDate === localDate ? (
        <Text className="font-sans text-sm text-ink-3">
          <Trans>Choose a different day.</Trans>
        </Text>
      ) : null}
      {entries.length === 0 ? (
        <Text className="font-sans text-sm text-ink-3">{i18n._(DIARY_COPY.empty)}</Text>
      ) : (
        MEAL_SLOTS.map((meal) => {
          const group = entries.filter(
            (entry) => entry.slot === meal && (fromDate !== localDate || targetSlot !== null),
          );
          if (!group.length) return null;
          const allSelected = group.every((entry) => selected.has(entry.id));
          return (
            <View key={meal} className="gap-1 border-t border-rule pt-2">
              <View className="min-h-11 flex-row items-center justify-between">
                <Text className="font-display text-base font-medium text-ink">
                  {i18n._(SLOT_LABELS[meal])}
                </Text>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onPress={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const entry of group) {
                        if (allSelected) next.delete(entry.id);
                        else next.add(entry.id);
                      }
                      return next;
                    })
                  }
                >
                  <Button.Label>{allSelected ? t`Clear meal` : t`Select all in meal`}</Button.Label>
                </Button>
              </View>
              {group.map((entry) => {
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
                      {hideNumbers
                        ? i18n._(HIDDEN_VALUE)
                        : formatAmount(entry.amount, entry.unit, i18n)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })
      )}
      {fromDate === localDate ? (
        <View className="flex-row flex-wrap gap-2">
          <Text className="w-full font-sans text-sm text-ink-2">{t`Copy into a different meal`}</Text>
          {MEAL_SLOTS.map((slot) => (
            <Button
              key={slot}
              className="min-h-11"
              variant={targetSlot === slot ? "secondary" : "outline"}
              onPress={() => {
                setTargetSlot(slot);
                setSelected(
                  new Set(entries.filter((entry) => entry.slot !== slot).map((entry) => entry.id)),
                );
              }}
            >
              <Button.Label>{i18n._(SLOT_LABELS[slot])}</Button.Label>
            </Button>
          ))}
        </View>
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
