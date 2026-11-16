import {
  MEAL_SLOTS,
  type AmountUnit,
  type DiaryEntry,
  type EntryOutcome,
  type MealSlot,
  type NutrientKey,
} from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import { offlineScope } from "@openvalens/api/presenters/offline";
import {
  DIARY_COPY,
  DRINK_NUTRIENTS,
  NUTRIENT_LABELS,
  SLOT_LABELS,
  UNIT_LABELS,
  addFoodToLabel,
  dayStatusText,
  deviceTimeZone,
  foodSourceLabel,
  formatAmount,
  formatNutrientValue,
  groupBySlot,
  localDateIn,
  mealSlotForLocalTime,
  newClientMutationId,
  previewNutrients,
  shiftLocalDate,
  unitsFor,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  HIDDEN_VALUE,
  TARGET_COPY,
  formatTarget,
  describeTargetSource,
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openvalens/ui/components/dropdown-menu";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Apple,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Copy,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Sandwich,
  Settings2,
  Soup,
  Star,
  Target,
  Trash2,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { nativeSelectClass, textLinkClass } from "@/components/food-classes";
import { LoggingStreakCard } from "@/components/logging-streak-card";
import { LogDialog } from "@/components/log-dialog";
import { LogFoodSheet, type LogFoodRequest, type LogFoodTab } from "@/components/log-food-sheet";
import { NutritionDayTotals } from "@/components/nutrition-day-totals";
import { Details, ErrorState, InfoTip, Page, PageHeader, ToneIcon } from "@/components/page";
import { DecimalHint } from "@/components/decimal-hint";
import { DrinksSection } from "@/components/drinks-section";
import { PlainWaterSection } from "@/components/plain-water-section";
import { useLogDialog, useLogTarget, useOpenLog } from "@/components/quick-log/log-launcher";
import type { LogTarget } from "@/components/quick-log/log-targets";
import { friendlyDate } from "@/utils/friendly";
import { diaryDayLabel } from "@/utils/food-display";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { parseDecimal } from "@openvalens/i18n/numbers";

const LOG_TABS: readonly LogFoodTab[] = ["search", "describe", "quick", "barcode", "photo"];

type DiarySearch = {
  /** Pre-fills Log food's search, e.g. from a palette one-liner. Nothing is saved from it. */
  food?: string;
  /** Opens Log food on Describe with these words (the old /food-draft, #73). */
  describe?: string;
  /** Opens Log food on this tab. */
  log?: LogFoodTab;
};

/**
 * Meal diary (Issue #77): the day's totals and meals. Food is logged from the
 * Log food sheet (nutrition#0), opened by the log "+" and each meal's "+ Add";
 * describing a meal is its Describe tab (food-draft#0). Online-only on web:
 * every change goes straight to `nutritionDiary.*`, and a network failure
 * leaves saved data untouched and offers a retry (the durable offline outbox
 * is mobile-only). Copy is neutral: it records, it never judges.
 */
export const Route = createFileRoute("/_auth/nutrition")({
  component: NutritionPage,
  validateSearch: (search: Record<string, unknown>): DiarySearch => ({
    ...(typeof search.food === "string" && search.food.trim()
      ? { food: search.food.trim().slice(0, 200) }
      : {}),
    ...(typeof search.describe === "string" && search.describe.trim()
      ? { describe: search.describe.trim().slice(0, 2_000) }
      : {}),
    ...(typeof search.log === "string" && (LOG_TABS as readonly string[]).includes(search.log)
      ? { log: search.log as LogFoodTab }
      : {}),
  }),
});

const HEADER_COPY = Object.freeze({
  more: msg`More for the meal diary`,
  myFoods: msg`My foods`,
  targets: msg`Nutrition targets`,
  settings: msg`Nutrition settings`,
  chooseDay: msg`Choose day`,
  diaryDate: msg`Diary date`,
});

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
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

/** Announces a change to screen readers (date, saves, undo, errors). */
function useAnnouncer() {
  const [message, setMessage] = useState("");
  const region = (
    <p className="sr-only" role="status" aria-live="polite">
      {message}
    </p>
  );
  return { announce: setMessage, region };
}

function networkFailure(retry: () => void, announce: (text: string) => void, i18n: I18n) {
  const message = i18n._(DIARY_COPY.networkError);
  announce(message);
  toast.error(message, { action: { label: i18n._(DIARY_COPY.retry), onClick: retry } });
}

function NutritionPage() {
  const { food: draftFood, describe, log: logTab } = Route.useSearch();
  const navigate = useNavigate({ from: "/nutrition" });
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const { data: session } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [localDate, setLocalDate] = useState(() => localDateIn(timeZone));
  const [sheet, setSheet] = useState<LogFoodRequest | null>(null);
  const { announce, region } = useAnnouncer();
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const openLog = useOpenLog();

  // The log "+" and each meal's "+ Add" open Log food for the day on screen (nutrition#0).
  useLogTarget({ kind: "food", date: localDate });
  const openSheet = useCallback(
    (target: LogTarget, extra?: Partial<Omit<LogFoodRequest, "id">>) => {
      const food = target.kind === "food" ? target : null;
      if (food?.date) setLocalDate(food.date);
      setSheet({
        id: Date.now(),
        meal: food?.meal ?? mealSlotForLocalTime(),
        tab: "search",
        ...extra,
      });
    },
    [],
  );
  useLogDialog("food", openSheet);

  // A link with words (a palette one-liner, the old Describe a meal page) opens the sheet once.
  useEffect(() => {
    if (draftFood === undefined && describe === undefined && logTab === undefined) return;
    openSheet(
      { kind: "food" },
      {
        tab: describe !== undefined ? "describe" : (logTab ?? "search"),
        query: draftFood,
        text: describe,
      },
    );
  }, [draftFood, describe, logTab, openSheet]);

  const dayQuery = useQuery(orpc.nutritionDiary.getDay.queryOptions({ input: { localDate } }));
  const foodsQuery = useQuery(orpc.nutritionDiary.listFoods.queryOptions({ input: {} }));
  const targetOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const targetsQuery = useQuery({
    ...targetOptions,
    queryKey: [...targetOptions.queryKey, { offlineScope: scope }],
    enabled: Boolean(scope),
  });
  const streakOptions = orpc.nutritionTargets.loggingStreak.queryOptions({ input: { timeZone } });
  const streakQuery = useQuery({
    ...streakOptions,
    queryKey: [...streakOptions.queryKey, { offlineScope: scope }],
    enabled: Boolean(scope),
  });
  // Unknown preferences fail closed, including first render, date changes and
  // query errors. A successful response is the only authority to show values.
  const hideNumbers = targetsQuery.isSuccess
    ? resolveHideNumbers(targetsQuery.data?.settings.hideNumbers)
    : true;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nutritionDiary.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.loggingStreak.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nutritionDrinks.key() }),
    ]);

  const go = (date: string) => {
    setLocalDate(date);
    announce(t`Showing ${date}`);
  };

  const day = dayQuery.data;
  const entryCount = day?.summary.entryCount ?? 0;
  const status = dayStatusText(day?.status ?? "unmarked", entryCount);
  const complete = day?.status === "complete";

  const setStatus = useMutation(
    orpc.nutritionDiary.setDayStatus.mutationOptions({
      onSuccess: (result) => {
        const label = i18n._(dayStatusText(result.status, entryCount).label);
        announce(`${result.localDate}: ${label}`);
        void refresh();
      },
    }),
  );
  const toggleStatus = () => {
    const input = { localDate, complete: !complete };
    setStatus.mutate(input, {
      onError: () => networkFailure(() => setStatus.mutate(input), announce, i18n),
    });
  };

  const favoriteSnapshot = (entry: DiaryEntry) =>
    foodsQuery.data?.favorites.some(
      (food) => food.ref.kind === "snapshot" && food.ref.snapshotId === entry.food.snapshotId,
    ) ?? false;

  const onSaved = (name: string, slot: MealSlot) => {
    const meal = i18n._(SLOT_LABELS[slot]);
    announce(t`Saved ${name} to ${meal} on ${localDate}`);
    void refresh();
  };
  const markLabel = i18n._(complete ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete);

  return (
    <Page>
      <ModuleHiddenNote module="food" />
      {region}
      {/* nutrition#1: the title with a ⋯ menu, then the day switcher with its check. */}
      <div className="grid gap-2">
        <PageHeader
          title={i18n._(DIARY_COPY.title)}
          className="flex-nowrap items-center"
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={i18n._(HEADER_COPY.more)}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52 rounded-2xl bg-card">
                <DropdownMenuItem asChild>
                  <Link to="/foods">
                    <Bookmark aria-hidden="true" />
                    {i18n._(HEADER_COPY.myFoods)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/nutrition-targets">
                    <Target aria-hidden="true" />
                    {i18n._(HEADER_COPY.targets)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/nutrition">
                    <Settings2 aria-hidden="true" />
                    {i18n._(HEADER_COPY.settings)}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />

        <nav
          className="-ml-2 flex min-w-0 items-center gap-1"
          aria-label={i18n._(HEADER_COPY.chooseDay)}
        >
          <Button variant="ghost" size="icon" onClick={() => go(shiftLocalDate(localDate, -1))}>
            <ChevronLeft aria-hidden="true" />
            <span className="sr-only">
              <Trans>Previous day</Trans>
            </span>
          </Button>
          {/* The day's name; a press opens the date picker under it. */}
          <label className="relative flex min-w-0 cursor-pointer items-center rounded-full px-2 py-1 font-display text-xl font-medium text-ink transition-colors duration-[var(--dur-short)] hover:bg-paper-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            <span className="truncate" aria-hidden="true">
              {diaryDayLabel(i18n, localDate)}
            </span>
            <Input
              type="date"
              aria-label={i18n._(HEADER_COPY.diaryDate)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={localDate}
              onClick={(event) => {
                try {
                  event.currentTarget.showPicker?.();
                } catch {
                  // Older browsers open it on their own.
                }
              }}
              onChange={(event) => event.target.value && go(event.target.value)}
            />
          </label>
          <Button variant="ghost" size="icon" onClick={() => go(shiftLocalDate(localDate, 1))}>
            <ChevronRight aria-hidden="true" />
            <span className="sr-only">
              <Trans>Next day</Trans>
            </span>
          </Button>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-pressed={complete}
              aria-label={markLabel}
              title={`${i18n._(status.label)}. ${i18n._(status.description)}`}
              className="aria-pressed:border-transparent aria-pressed:bg-food-soft aria-pressed:text-ink"
              onClick={toggleStatus}
              disabled={setStatus.isPending || dayQuery.isPending}
            >
              <Check aria-hidden="true" />
            </Button>
            <span className="sr-only" role="status">
              {i18n._(status.label)}
            </span>
          </span>
        </nav>
      </div>

      {dayQuery.isPending ? (
        <div className="grid gap-8" aria-hidden="true">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-5">
            {SUMMARY_SKELETON.map((key) => (
              <Skeleton
                key={key}
                className="h-36 w-full rounded-3xl first:col-span-2 sm:first:col-span-4 xl:first:col-span-1"
              />
            ))}
          </div>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid gap-4">
              {SUMMARY_SKELETON.map((key) => (
                <Skeleton key={key} className="h-24 w-full rounded-3xl" />
              ))}
            </div>
            <Skeleton className="h-80 w-full rounded-3xl" />
          </div>
        </div>
      ) : dayQuery.isError ? (
        <ErrorState
          title={i18n._(DIARY_COPY.networkError)}
          action={
            <Button variant="outline" onClick={() => void dayQuery.refetch()}>
              {i18n._(DIARY_COPY.retry)}
            </Button>
          }
        />
      ) : (
        <>
          <section className="grid min-w-0 gap-4" aria-label={diaryDayLabel(i18n, localDate)}>
            {day ? (
              <NutritionDayTotals
                totals={day.summary.totals}
                sources={day.summary.sources}
                hideNumbers={hideNumbers}
                targets={targetsQuery.data?.targetsOn.targets ?? []}
              />
            ) : null}
            <TargetsOnDay
              targets={targetsQuery.data?.targetsOn.targets ?? []}
              hideNumbers={hideNumbers}
            />
          </section>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid min-w-0 content-start gap-4">
              {groupBySlot(day?.entries ?? []).map((group) => {
                const meal = i18n._(group.label);
                return (
                  <section
                    key={group.slot}
                    aria-labelledby={`slot-${group.slot}`}
                    className="sheet grid min-w-0 gap-3 p-5"
                  >
                    <div className="flex items-center gap-3">
                      <ToneIcon icon={SLOT_ICONS[group.slot]} tone="food" size="sm" />
                      <h2
                        id={`slot-${group.slot}`}
                        className="min-w-0 flex-1 text-xl leading-tight text-ink"
                      >
                        {meal}
                      </h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-mr-2 text-ink-2"
                        aria-label={i18n._(addFoodToLabel(meal))}
                        onClick={() => openLog({ kind: "food", meal: group.slot, date: localDate })}
                      >
                        <Plus aria-hidden="true" />
                        <Trans>Add</Trans>
                      </Button>
                    </div>
                    {group.entries.length === 0 ? (
                      <p className="text-sm text-ink-3">{i18n._(DIARY_COPY.emptySlot)}</p>
                    ) : (
                      <ul className="grid divide-y divide-rule" aria-label={meal}>
                        {group.entries.map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            favorite={favoriteSnapshot(entry)}
                            onChanged={() => void refresh()}
                            announce={announce}
                            hideNumbers={hideNumbers}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}

              <CopyDay
                localDate={localDate}
                timeZone={timeZone}
                onCopied={() => void refresh()}
                announce={announce}
              />
            </div>

            {/* nutrition#9: the streak, drinks and water share the right column, so neither runs long. */}
            <div className="grid min-w-0 content-start gap-8">
              <LoggingStreakCard streak={streakQuery.isSuccess ? streakQuery.data : undefined} />

              <DrinksSection
                localDate={localDate}
                timeZone={timeZone}
                hideNumbers={hideNumbers}
                onSaved={onSaved}
                announce={announce}
              />

              <PlainWaterSection
                key={`${scope ?? "signed-out"}:${localDate}:${timeZone}`}
                localDate={localDate}
                timeZone={timeZone}
                hideNumbers={hideNumbers}
                announce={announce}
                trustedScope={scope}
              />
            </div>
          </div>
        </>
      )}

      <LogFoodSheet
        request={sheet}
        onClose={() => {
          setSheet(null);
          // The words were for this one opening; a reload should not open it again.
          if (draftFood !== undefined || describe !== undefined || logTab !== undefined)
            void navigate({ search: {}, replace: true });
        }}
        localDate={localDate}
        timeZone={timeZone}
        foods={foodsQuery.data}
        hideNumbers={hideNumbers}
        onSaved={onSaved}
        announce={announce}
      />
    </Page>
  );
}

/** Macros listed beside energy in each food's detail, then caffeine and alcohol (#443). */
const LEDGER_MACROS = [
  "proteinG",
  "carbohydrateG",
  "fatG",
  ...DRINK_NUTRIENTS,
] as const satisfies readonly NutrientKey[];
const SUMMARY_SKELETON = ["a", "b", "c", "d", "e"] as const;
const SLOT_ICONS: Record<MealSlot, LucideIcon> = {
  breakfast: Coffee,
  lunch: Sandwich,
  dinner: Soup,
  snack: Apple,
  other: Utensils,
};

function EntryRow({
  entry,
  favorite,
  onChanged,
  announce,
  hideNumbers,
}: {
  entry: DiaryEntry;
  favorite: boolean;
  onChanged: () => void;
  announce: (text: string) => void;
  hideNumbers: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(entry.amount));
  const [unit, setUnit] = useState<AmountUnit>(entry.unit);
  const [slot, setSlot] = useState<MealSlot>(entry.slot);
  const [conflict, setConflict] = useState<DiaryEntry | null>(null);

  const update = useMutation(orpc.nutritionDiary.updateEntry.mutationOptions());
  const remove = useMutation(orpc.nutritionDiary.deleteEntry.mutationOptions());
  const restore = useMutation(orpc.nutritionDiary.restoreEntry.mutationOptions());
  const favoriteMutation = useMutation(orpc.nutritionDiary.setFavorite.mutationOptions());
  const { t, i18n } = useLingui();
  const amountValue = parseDecimal(amount, i18n.locale) ?? Number.NaN;
  const foodName = entry.food.name;

  const handle = (result: EntryOutcome, done: string) => {
    if (result.outcome === "conflict") {
      setConflict(result.server);
      announce(i18n._(DIARY_COPY.conflictTitle));
      return false;
    }
    announce(done);
    onChanged();
    return true;
  };

  const save = (expectedRevision = entry.revision) => {
    const input = {
      clientMutationId: newClientMutationId(),
      entryId: entry.id,
      expectedRevision,
      amount: amountValue,
      unit,
      slot,
    };
    update.mutate(input, {
      onSuccess: (result) => {
        if (handle(result, t`Updated ${foodName}`)) {
          setEditing(false);
          setConflict(null);
        }
      },
      onError: () => networkFailure(() => update.mutate(input), announce, i18n),
    });
  };

  const undo = (revision: number) => {
    const input = {
      clientMutationId: newClientMutationId(),
      entryId: entry.id,
      expectedRevision: revision,
    };
    restore.mutate(input, {
      onSuccess: (result) => handle(result, i18n._(DIARY_COPY.restored)),
      onError: () => networkFailure(() => restore.mutate(input), announce, i18n),
    });
  };

  const del = () => {
    const input = {
      clientMutationId: newClientMutationId(),
      entryId: entry.id,
      expectedRevision: entry.revision,
    };
    remove.mutate(input, {
      onSuccess: (result) => {
        if (result.outcome === "conflict") return void handle(result, "");
        const removed = t`Entry removed. ${foodName}`;
        handle(result, removed);
        toast(removed, {
          action: { label: i18n._(DIARY_COPY.undo), onClick: () => undo(result.entry.revision) },
        });
      },
      onError: () => networkFailure(() => remove.mutate(input), announce, i18n),
    });
  };

  const units = unitsFor(entry.food.basis);
  const mineAmount = formatAmount(amountValue, unit, i18n);
  const mineSlot = i18n._(SLOT_LABELS[slot]);
  const otherAmount = conflict ? formatAmount(conflict.amount, conflict.unit, i18n) : "";
  const otherSlot = conflict ? i18n._(SLOT_LABELS[conflict.slot]) : "";
  const preview = previewNutrients(
    entry.food.basis,
    entry.food.nutrientsPerBasis,
    amountValue,
    unit,
  );

  const figure = (key: NutrientKey) =>
    hideNumbers ? i18n._(HIDDEN_VALUE) : formatNutrientValue(key, entry.nutrients[key], i18n);

  return (
    <li className="grid min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-x-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 items-center gap-1">
            <span className="font-semibold break-words text-ink">{entry.food.name}</span>
            <InfoTip label={t`Nutrients and source`}>
              <ul className="grid gap-0.5">
                {LEDGER_MACROS.map((key) => (
                  <li key={key} className="flex justify-between gap-4">
                    <span>{i18n._(NUTRIENT_LABELS[key].label)}</span>
                    <span className="text-ink tabular-nums">{figure(key)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-3">
                {i18n._(foodSourceLabel(entry.food.source))}
                {entry.food.brand ? `, ${entry.food.brand}` : ""}
              </p>
              {entry.food.source === "off" && entry.food.attribution ? (
                <p className="text-ink-3">{entry.food.attribution}</p>
              ) : null}
            </InfoTip>
          </div>
          <span className="text-sm text-ink-3 tabular-nums">
            <span className="sr-only">
              <Trans>Amount</Trans>:{" "}
            </span>
            {formatAmount(entry.amount, entry.unit, i18n)}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink tabular-nums">
          <span className="sr-only">{i18n._(NUTRIENT_LABELS.energyKcal.label)}: </span>
          {figure("energyKcal")}
        </span>
        <span className="-mr-1 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-ink-3 hover:text-ink aria-pressed:text-food"
            aria-pressed={favorite}
            onClick={() =>
              favoriteMutation.mutate(
                { snapshotId: entry.food.snapshotId, favorite: !favorite },
                {
                  onSuccess: () => {
                    announce(favorite ? t`Removed from favourites` : t`Added to favourites`);
                    onChanged();
                  },
                  onError: () => announce(i18n._(DIARY_COPY.networkError)),
                },
              )
            }
          >
            <Star className={favorite ? "fill-current" : undefined} aria-hidden="true" />
            <span className="sr-only">
              {favorite ? (
                <Trans>
                  Unfavourite <span className="sr-only">{foodName}</span>
                </Trans>
              ) : (
                <Trans>
                  Favourite <span className="sr-only">{foodName}</span>
                </Trans>
              )}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-ink-3 hover:text-ink">
                <MoreHorizontal aria-hidden="true" />
                <span className="sr-only">{t`More for ${foodName}`}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl bg-card">
              <DropdownMenuItem onSelect={() => setEditing((value) => !value)}>
                <Pencil aria-hidden="true" />
                <Trans>Edit</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={remove.isPending} onSelect={del}>
                <Trash2 aria-hidden="true" />
                <Trans>Delete</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {conflict ? (
        <div className="grid gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm" role="alert">
          <p className="font-display font-medium text-ink">{i18n._(DIARY_COPY.conflictTitle)}</p>
          <p className="text-ink-2">
            {conflict.deleted
              ? t`Other version: deleted. Your change: ${mineAmount}, ${mineSlot}.`
              : t`Other version: ${otherAmount}, ${otherSlot}. Your change: ${mineAmount}, ${mineSlot}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {conflict.deleted ? null : (
              <Button size="sm" variant="outline" onClick={() => save(conflict.revision)}>
                {i18n._(DIARY_COPY.keepMine)}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setConflict(null);
                setEditing(false);
                onChanged();
              }}
            >
              {i18n._(DIARY_COPY.keepServer)}
            </Button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="rounded-2xl bg-paper-2 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label={t`Amount`}>
              {(id) => (
                <>
                  <Input
                    id={id}
                    inputMode="decimal"
                    className="num"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                  <DecimalHint value={amount} />
                </>
              )}
            </Field>
            <Field label={t`Unit`}>
              {(id) => (
                <select
                  id={id}
                  className={nativeSelectClass}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as AmountUnit)}
                >
                  {units.map((option) => (
                    <option key={option} value={option}>
                      {i18n._(UNIT_LABELS[option])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t`Meal`}>
              {(id) => (
                <select
                  id={id}
                  className={nativeSelectClass}
                  value={slot}
                  onChange={(event) => setSlot(event.target.value as MealSlot)}
                >
                  {MEAL_SLOTS.map((option) => (
                    <option key={option} value={option}>
                      {i18n._(SLOT_LABELS[option])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              variant="outline"
              onClick={() => save()}
              disabled={preview === null || update.isPending}
            >
              {update.isPending ? t`Saving…` : t`Save`}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The member's targets that applied on the selected day (Issue #80), shown
 * separately from the totals and never as a verdict. Hidden entirely when no
 * target applies; in hide-numbers mode the amounts are replaced but the card
 * stays so a member can still see a target exists.
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
    <Details summary={<h3 className="text-sm">{i18n._(TARGET_COPY.yourTargets)}</h3>}>
      <div className="sheet grid min-w-0 gap-3 px-5 py-4">
        <ul className="divide-y divide-rule text-sm" aria-label={i18n._(TARGET_COPY.yourTargets)}>
          {targets.map((target) => (
            <li
              key={target.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]"
            >
              <span className="font-semibold text-ink">
                {i18n._(NUTRIENT_LABELS[target.nutrient].label)}
              </span>
              <span className="text-right text-ink tabular-nums sm:text-left">
                {formatTarget(target, hideNumbers, i18n)}
              </span>
              <span className="col-span-2 text-ink-3 sm:col-span-1 sm:text-right">
                {i18n._(describeTargetSource(target))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-3">
          {i18n._(TARGET_COPY.targetsNote)}{" "}
          <Link to="/nutrition-targets" className={textLinkClass}>
            {i18n._(HEADER_COPY.targets)}
          </Link>
        </p>
      </div>
    </Details>
  );
}

function CopyDay({
  localDate,
  timeZone,
  onCopied,
  announce,
}: {
  localDate: string;
  timeZone: string;
  onCopied: () => void;
  announce: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(() => shiftLocalDate(localDate, -1));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const source = useQuery({
    ...orpc.nutritionDiary.getDay.queryOptions({ input: { localDate: fromDate } }),
    enabled: open && fromDate !== localDate,
  });
  const copy = useMutation(orpc.nutritionDiary.copyDay.mutationOptions());
  const { t, i18n } = useLingui();

  const entries = source.data?.entries ?? [];
  const submit = () => {
    const input = {
      clientMutationId: newClientMutationId(),
      fromDate,
      toDate: localDate,
      timeZone,
      entryIds: [...selected],
    };
    const send = () =>
      copy.mutate(input, {
        onSuccess: (result) => {
          announce(
            t`Copied ${plural(result.created, { one: "# item", other: "# items" })} to ${localDate}`,
          );
          setOpen(false);
          setSelected(new Set());
          onCopied();
        },
        onError: () => networkFailure(send, announce, i18n),
      });
    send();
  };

  return (
    <>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Copy aria-hidden="true" />
          {i18n._(DIARY_COPY.copyFrom)}
        </Button>
      </div>
      <LogDialog
        open={open}
        onOpenChange={setOpen}
        title={i18n._(DIARY_COPY.copyFrom)}
        description={friendlyDate(i18n, localDate)}
      >
        <div className="grid gap-3">
          <Field label={t`Copy from`}>
            {(id) => (
              <Input
                id={id}
                type="date"
                className="num w-44"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setSelected(new Set());
                }}
              />
            )}
          </Field>
          {fromDate === localDate ? (
            <p className="text-sm text-ink-3">
              <Trans>Choose a different day.</Trans>
            </p>
          ) : source.isPending ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-ink-3">{i18n._(DIARY_COPY.empty)}</p>
          ) : (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-semibold text-ink-3">
                <Trans>Items to copy</Trans>
              </legend>
              {entries.map((entry) => (
                <label
                  key={entry.id}
                  className="flex cursor-pointer items-center gap-2 text-sm text-ink-2"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selected.has(entry.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(entry.id);
                      else next.delete(entry.id);
                      setSelected(next);
                    }}
                  />
                  {i18n._(SLOT_LABELS[entry.slot])}: {entry.food.name},{" "}
                  {formatAmount(entry.amount, entry.unit, i18n)}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button
              variant="outline"
              onClick={submit}
              disabled={selected.size === 0 || copy.isPending}
            >
              {t`Copy ${plural(selected.size, { one: "# item", other: "# items" })} to ${localDate}`}
            </Button>
            <Button className="w-full sm:w-auto" variant="ghost" onClick={() => setOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      </LogDialog>
    </>
  );
}
