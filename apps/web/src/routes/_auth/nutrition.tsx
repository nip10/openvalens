import {
  AMOUNT_UNITS,
  MEAL_SLOTS,
  type AmountUnit,
  type DiaryEntry,
  type EntryOutcome,
  type FoodChoice,
  type FoodRef,
  type LogEntryInput,
  type MealSlot,
  type NutrientKey,
} from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import { CUSTOM_FOOD_COPY, nutrientFieldLabel } from "@openvalens/api/presenters/custom-foods";
import { offlineScope } from "@openvalens/api/presenters/offline";
import {
  BARCODE_COPY,
  candidateFromChoice,
  describeBarcodeLookup,
  isSearchable,
  manualDraftFields,
  missingDataNote,
  parseBarcode,
  searchCandidates,
  type BarcodeOutcome,
  type FoodCandidate,
} from "@openvalens/api/presenters/food-lookup";
import {
  DIARY_COPY,
  NUTRIENT_LABELS,
  SLOT_LABELS,
  UNIT_LABELS,
  dayStatusText,
  deviceTimeZone,
  foodSourceLabel,
  formatAmount,
  formatNutrientValue,
  groupBySlot,
  localDateIn,
  newClientMutationId,
  parseQuickAdd,
  previewNutrients,
  shiftLocalDate,
  unitsFor,
  type QuickAddFields,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  HIDDEN_VALUE,
  TARGET_COPY,
  formatTarget,
  describeTargetSource,
  resolveHideNumbers,
  formatNutrientSummaryLine,
} from "@openvalens/api/presenters/nutrition-targets";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Apple,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Coffee,
  Copy,
  type LucideIcon,
  Pencil,
  Plus,
  Sandwich,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Soup,
  Star,
  Trash2,
  Utensils,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import {
  controlLinkClass,
  inlineButtonClass,
  nativeSelectClass,
  textLinkClass,
} from "@/components/food-classes";
import { LoggingStreakCard } from "@/components/logging-streak-card";
import { NutritionDayTotals } from "@/components/nutrition-day-totals";
import {
  Details,
  ErrorState,
  InfoTip,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { PlainWaterSection } from "@/components/plain-water-section";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

/**
 * Meal diary (Issue #77) with food search and typed barcode lookup (#75). Online-only on web: every change goes straight to
 * `nutritionDiary.*`, and a network failure leaves saved data untouched and
 * offers a retry (the durable offline outbox is mobile-only). Copy is neutral:
 * it records, it never judges.
 */
export const Route = createFileRoute("/_auth/nutrition")({
  component: NutritionPage,
  /** `food` pre-fills the food search, e.g. from a voice draft (#73). Nothing is saved from it. */
  validateSearch: (search: Record<string, unknown>): { food?: string } =>
    typeof search.food === "string" && search.food.trim()
      ? { food: search.food.trim().slice(0, 200) }
      : {},
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
  const { food: draftFood } = Route.useSearch();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const { data: session } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [localDate, setLocalDate] = useState(() => localDateIn(timeZone));
  const { announce, region } = useAnnouncer();
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();

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
    ]);

  const go = (date: string) => {
    setLocalDate(date);
    announce(t`Showing ${date}`);
  };

  const day = dayQuery.data;
  const entryCount = day?.summary.entryCount ?? 0;
  const status = dayStatusText(day?.status ?? "unmarked", entryCount);

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
    const input = { localDate, complete: day?.status !== "complete" };
    setStatus.mutate(input, {
      onError: () => networkFailure(() => setStatus.mutate(input), announce, i18n),
    });
  };

  const favoriteSnapshot = (entry: DiaryEntry) =>
    foodsQuery.data?.favorites.some(
      (food) => food.ref.kind === "snapshot" && food.ref.snapshotId === entry.food.snapshotId,
    ) ?? false;

  return (
    <Page>
      <ModuleHiddenNote module="food" />
      {region}
      <PageHeader
        title={i18n._(DIARY_COPY.title)}
        description={
          <span className="flex flex-wrap gap-x-5 gap-y-1">
            <Link to="/foods" className={`inline-flex items-center gap-1.5 ${controlLinkClass}`}>
              <Bookmark className="size-4 text-food" aria-hidden="true" />
              {i18n._(CUSTOM_FOOD_COPY.manageLink)}
            </Link>
            <Link
              to="/nutrition-targets"
              className={`inline-flex items-center gap-1.5 ${controlLinkClass}`}
            >
              <SlidersHorizontal className="size-4 text-food" aria-hidden="true" />
              {i18n._(TARGET_COPY.settingsLink)}
            </Link>
          </span>
        }
        actions={
          <nav
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
            aria-label={t`Choose day`}
          >
            <Button variant="outline" size="icon" onClick={() => go(shiftLocalDate(localDate, -1))}>
              <ChevronLeft aria-hidden="true" />
              <span className="sr-only">
                <Trans>Previous day</Trans>
              </span>
            </Button>
            <Input
              type="date"
              aria-label={t`Diary date`}
              className="num min-w-0 flex-1 sm:w-40 sm:flex-none"
              value={localDate}
              onChange={(event) => event.target.value && go(event.target.value)}
            />
            <Button variant="outline" size="icon" onClick={() => go(shiftLocalDate(localDate, 1))}>
              <ChevronRight aria-hidden="true" />
              <span className="sr-only">
                <Trans>Next day</Trans>
              </span>
            </Button>
          </nav>
        }
      />

      {dayQuery.isPending ? (
        <div className="grid gap-8" aria-hidden="true">
          <Skeleton className="h-10 w-56 rounded-full" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {SUMMARY_SKELETON.map((key) => (
              <Skeleton key={key} className="h-36 w-full rounded-3xl" />
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
          <section className="grid min-w-0 gap-4" aria-labelledby="diary-day">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 items-center gap-3">
                <ToneIcon icon={UtensilsCrossed} tone="food" size="lg" />
                <div className="grid min-w-0 gap-1">
                  <h2 id="diary-day" className="text-2xl leading-tight text-ink">
                    {friendlyDate(i18n, localDate)}
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <StatusPill tone={day?.status === "complete" ? "good" : "neutral"}>
                      {i18n._(status.label)}
                    </StatusPill>
                    <InfoTip>{i18n._(status.description)}</InfoTip>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleStatus}
                disabled={setStatus.isPending}
              >
                <CircleCheck aria-hidden="true" />
                {i18n._(
                  day?.status === "complete" ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete,
                )}
              </Button>
            </div>
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

          <LoggingStreakCard streak={streakQuery.isSuccess ? streakQuery.data : undefined} />

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid min-w-0 content-start gap-4">
              {groupBySlot(day?.entries ?? []).map((group) => (
                <section
                  key={group.slot}
                  aria-labelledby={`slot-${group.slot}`}
                  className="sheet grid min-w-0 gap-3 p-5"
                >
                  <div className="flex items-center gap-3">
                    <ToneIcon icon={SLOT_ICONS[group.slot]} tone="food" size="sm" />
                    <h2 id={`slot-${group.slot}`} className="text-xl leading-tight text-ink">
                      {i18n._(group.label)}
                    </h2>
                  </div>
                  {group.entries.length === 0 ? (
                    <p className="text-sm text-ink-3">{i18n._(DIARY_COPY.emptySlot)}</p>
                  ) : (
                    <ul className="grid divide-y divide-rule" aria-label={i18n._(group.label)}>
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
              ))}

              <CopyDay
                localDate={localDate}
                timeZone={timeZone}
                onCopied={() => void refresh()}
                announce={announce}
              />
            </div>

            <div className="grid min-w-0 content-start gap-8">
              <AddFood
                key={draftFood ?? ""}
                initialQuery={draftFood ?? ""}
                localDate={localDate}
                timeZone={timeZone}
                foods={foodsQuery.data}
                hideNumbers={hideNumbers}
                onSaved={(name, slot) => {
                  const meal = i18n._(SLOT_LABELS[slot]);
                  announce(t`Saved ${name} to ${meal} on ${localDate}`);
                  void refresh();
                }}
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
    </Page>
  );
}

/** Macros listed beside energy in each food's detail. */
const LEDGER_MACROS = [
  "proteinG",
  "carbohydrateG",
  "fatG",
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
      amount: Number(amount),
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
  const mineAmount = formatAmount(Number(amount), unit, i18n);
  const mineSlot = i18n._(SLOT_LABELS[slot]);
  const otherAmount = conflict ? formatAmount(conflict.amount, conflict.unit, i18n) : "";
  const otherSlot = conflict ? i18n._(SLOT_LABELS[conflict.slot]) : "";
  const preview = previewNutrients(
    entry.food.basis,
    entry.food.nutrientsPerBasis,
    Number(amount),
    unit,
  );

  const figure = (key: NutrientKey) =>
    hideNumbers ? i18n._(HIDDEN_VALUE) : formatNutrientValue(key, entry.nutrients[key], i18n);

  return (
    <li className="grid min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 basis-40 gap-0.5">
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
            className="text-ink-3 hover:text-ink"
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
          >
            <Pencil aria-hidden="true" />
            <span className="sr-only">
              <Trans>
                Edit <span className="sr-only">{foodName}</span>
              </Trans>
            </span>
          </Button>
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-ink-3 hover:text-destructive"
            onClick={del}
            disabled={remove.isPending}
          >
            <Trash2 aria-hidden="true" />
            <span className="sr-only">
              <Trans>
                Delete <span className="sr-only">{foodName}</span>
              </Trans>
            </span>
          </Button>
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
                <Input
                  id={id}
                  inputMode="decimal"
                  className="num"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
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
            {i18n._(TARGET_COPY.settingsLink)}
          </Link>
        </p>
      </div>
    </Details>
  );
}

const QUICK_ADD_NUTRIENTS: NutrientKey[] = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "fiberG",
];
const EMPTY_QUICK: QuickAddFields = { name: "", basisAmount: "100", basisUnit: "g", nutrients: {} };

/** `value`, settled for `ms` (keeps search requests to one per pause in typing). */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function CandidateButton({
  candidate,
  selected,
  onSelect,
}: {
  candidate: FoodCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const { i18n } = useLingui();
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        className={`flex w-full cursor-pointer justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors duration-[var(--dur-short)] hover:bg-paper-2 active:bg-paper-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-food-soft aria-pressed:text-ink ${selected ? "font-semibold text-ink" : "text-ink-2"}`}
        onClick={onSelect}
      >
        <span className="min-w-0 break-words">
          {candidate.name}
          {candidate.brand ? <span className="text-ink-3">, {candidate.brand}</span> : null}
        </span>
        <span className="shrink-0 text-ink-3">{i18n._(candidate.sourceLabel)}</span>
      </button>
    </li>
  );
}

/** Source notice for a list that includes catalog results (shown with every OFF result list). */
function AttributionNotes({ candidates }: { candidates: readonly FoodCandidate[] }) {
  const notices = [...new Set(candidates.flatMap((c) => (c.attribution ? [c.attribution] : [])))];
  if (notices.length === 0) return null;
  return (
    <div className="grid gap-1">
      {notices.map((notice) => (
        <p key={notice} className="text-xs text-ink-3">
          {notice}
        </p>
      ))}
    </div>
  );
}

function AddFood({
  initialQuery,
  localDate,
  timeZone,
  foods,
  hideNumbers,
  onSaved,
  announce,
}: {
  initialQuery: string;
  localDate: string;
  timeZone: string;
  foods: { recents: FoodChoice[]; favorites: FoodChoice[]; customFoods: FoodChoice[] } | undefined;
  hideNumbers: boolean;
  onSaved: (name: string, slot: MealSlot) => void;
  announce: (text: string) => void;
}) {
  const [slot, setSlot] = useState<MealSlot>("breakfast");
  const [mode, setMode] = useState<"choose" | "barcode" | "quick">("choose");
  const [query, setQuery] = useState(initialQuery);
  const [chosen, setChosen] = useState<FoodCandidate | null>(null);
  const [amount, setAmount] = useState("100");
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [quick, setQuick] = useState<QuickAddFields>(EMPTY_QUICK);
  /** Set while the quick-add form is a manual draft started from a barcode. */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [saveAsFood, setSaveAsFood] = useState(false);
  const [barcodeReset, setBarcodeReset] = useState(0);
  const log = useMutation(orpc.nutritionDiary.logEntry.mutationOptions());
  const createFood = useMutation(orpc.nutritionDiary.createFood.mutationOptions());
  // Kept across retries of one save so a lost response cannot save the food twice (#81).
  const [saveFoodMutationId, setSaveFoodMutationId] = useState(newClientMutationId);
  const { t, i18n } = useLingui();

  const saved = useMemo(() => {
    const seen = new Set<string>();
    const all = [
      ...(foods?.favorites ?? []),
      ...(foods?.recents ?? []),
      ...(foods?.customFoods ?? []),
    ];
    const needle = query.trim().toLowerCase();
    return all
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

  // Food databases (#69). The query goes in the POST body only; it is never logged.
  const debounced = useDebounced(query.trim());
  const search = useQuery({
    ...orpc.nutritionFoods.search.queryOptions({ input: { query: debounced } }),
    enabled: mode === "choose" && isSearchable(debounced),
    staleTime: 60_000,
  });
  const found = useMemo(
    () => searchCandidates(search.data?.results ?? [], savedIds),
    [search.data, savedIds],
  );

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
    announce(i18n._(BARCODE_COPY.enterManually));
  };

  const reset = () => {
    setChosen(null);
    setQuick(EMPTY_QUICK);
    setDraftNote(null);
    setSaveAsFood(false);
    setSaveFoodMutationId(newClientMutationId());
    setBarcodeReset((value) => value + 1);
  };

  const parsedQuick = parseQuickAdd(quick);
  const basis =
    mode !== "quick"
      ? chosen?.basis
      : parsedQuick.ok
        ? {
            nutrientBasisAmount: parsedQuick.food.nutrientBasisAmount,
            nutrientBasisUnit: parsedQuick.food.nutrientBasisUnit,
            servingSizeAmount: null,
            servingSizeUnit: null,
            servingLabel: null,
          }
        : undefined;
  const perBasis =
    mode !== "quick"
      ? chosen?.nutrientsPerBasis
      : parsedQuick.ok
        ? (Object.fromEntries(
            Object.keys(NUTRIENT_LABELS).map((key) => [
              key,
              parsedQuick.food.nutrients?.[key as NutrientKey] ?? null,
            ]),
          ) as FoodChoice["nutrientsPerBasis"])
        : undefined;
  const preview =
    basis && perBasis ? previewNutrients(basis, perBasis, Number(amount), unit) : null;
  const allowedUnits = basis ? unitsFor(basis) : [...AMOUNT_UNITS];
  const missingNote = mode !== "quick" && chosen ? missingDataNote(chosen, i18n) : null;
  const slotLabel = i18n._(SLOT_LABELS[slot]);
  const reviewAmount = formatAmount(Number(amount), unit, i18n);
  const reviewSource =
    mode !== "quick" && chosen
      ? i18n._(chosen.sourceLabel)
      : draftNote !== null
        ? t`Entered by you`
        : t`Quick add`;
  const reviewName = mode !== "quick" && chosen ? chosen.name : null;
  const reviewLine = reviewName
    ? t`Review: ${reviewName}, ${reviewAmount} on ${localDate} (${reviewSource})`
    : t`Review: ${reviewAmount} on ${localDate} (${reviewSource})`;

  const submit = async () => {
    if (!preview) return;
    let food: FoodRef;
    let name: string;
    let method: LogEntryInput["method"];
    try {
      if (mode !== "quick" && chosen) {
        food = chosen.ref;
        name = chosen.name;
        method = chosen.method;
      } else if (mode === "quick" && parsedQuick.ok) {
        name = parsedQuick.food.name;
        method = draftNote !== null ? "barcode" : "quick_add";
        if (saveAsFood) {
          const created = await createFood.mutateAsync({
            ...parsedQuick.food,
            clientMutationId: saveFoodMutationId,
          });
          food = created.ref;
        } else {
          food = { kind: "manual", food: parsedQuick.food };
        }
      } else return;
    } catch {
      networkFailure(() => void submit(), announce, i18n);
      return;
    }
    const input = {
      clientMutationId: newClientMutationId(),
      localDate,
      timeZone,
      slot,
      food,
      amount: Number(amount),
      unit,
      method,
    };
    // The same client mutation id is reused on retry, so a lost response cannot duplicate the meal.
    const send = () =>
      log.mutate(input, {
        onSuccess: () => {
          onSaved(name, slot);
          reset();
        },
        onError: () => networkFailure(send, announce, i18n),
      });
    send();
  };

  const modes = [
    ["choose", t`Search and recents`, Search],
    ["barcode", i18n._(BARCODE_COPY.mode), ScanBarcode],
    ["quick", t`Quick add`, Zap],
  ] as const;

  return (
    <Section
      icon={Plus}
      tone="food"
      sheet
      aria-labelledby="add-food-heading"
      title={<span id="add-food-heading">{i18n._(DIARY_COPY.addFood)}</span>}
    >
      <div className="grid min-w-0 gap-4">
        <div
          className="flex flex-wrap gap-1 rounded-3xl bg-paper-2 p-1"
          role="group"
          aria-label={t`How to add`}
        >
          {modes.map(([value, label, Icon]) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              className="text-ink-3 aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-sm"
              aria-pressed={mode === value}
              onClick={() => switchMode(value)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>

        {mode === "choose" ? (
          <div className="grid gap-3">
            <Field label={i18n._(BARCODE_COPY.searchLabel)}>
              {(id) => (
                <Input
                  id={id}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-describedby="food-search-hint"
                />
              )}
            </Field>
            <p id="food-search-hint" className="sr-only">
              {i18n._(BARCODE_COPY.searchHint)}
            </p>
            <section className="grid gap-1" aria-label={i18n._(BARCODE_COPY.savedFoods)}>
              <h3 className="text-sm font-semibold text-ink-3">
                {i18n._(BARCODE_COPY.savedFoods)}
              </h3>
              {saved.length === 0 ? (
                <p className="text-sm text-ink-3">
                  {query.trim()
                    ? i18n._(BARCODE_COPY.searchEmpty)
                    : t`No saved or recent foods yet. Search, scan a barcode or use quick add.`}
                </p>
              ) : (
                <ul
                  className="max-h-56 divide-y divide-rule overflow-y-auto rounded-2xl border border-rule"
                  aria-label={t`Saved foods`}
                >
                  {saved.map((candidate) => (
                    <CandidateButton
                      key={candidate.key}
                      candidate={candidate}
                      selected={chosen?.key === candidate.key}
                      onSelect={() => select(candidate)}
                    />
                  ))}
                </ul>
              )}
            </section>
            <section className="grid gap-1" aria-label={i18n._(BARCODE_COPY.searchResults)}>
              <h3 className="text-sm font-semibold text-ink-3">
                {i18n._(BARCODE_COPY.searchResults)}
              </h3>
              {!isSearchable(debounced) ? (
                <p className="text-sm text-ink-3">{i18n._(BARCODE_COPY.searchHint)}</p>
              ) : search.isPending ? (
                <p className="text-sm text-ink-3" role="status">
                  <Trans>Searching…</Trans>
                </p>
              ) : search.isError ? (
                <p className="text-sm text-ink-2" role="alert">
                  {i18n._(BARCODE_COPY.searchFailed)}{" "}
                  <button className={inlineButtonClass} onClick={() => void search.refetch()}>
                    {i18n._(DIARY_COPY.retry)}
                  </button>
                </p>
              ) : found.length === 0 ? (
                <p className="text-sm text-ink-3" role="status">
                  {i18n._(BARCODE_COPY.searchEmpty)}
                </p>
              ) : (
                <>
                  <p className="sr-only" role="status">
                    {t`${plural(found.length, { one: "# food found", other: "# foods found" })}`}
                  </p>
                  <ul
                    className="max-h-72 divide-y divide-rule overflow-y-auto rounded-2xl border border-rule"
                    aria-label={t`Food database results`}
                  >
                    {found.map((candidate) => (
                      <CandidateButton
                        key={candidate.key}
                        candidate={candidate}
                        selected={chosen?.key === candidate.key}
                        onSelect={() => select(candidate)}
                      />
                    ))}
                  </ul>
                  <AttributionNotes candidates={found} />
                </>
              )}
            </section>
          </div>
        ) : mode === "barcode" ? (
          <BarcodeLookupPanel
            key={barcodeReset}
            chosen={chosen}
            onSelect={select}
            onManualDraft={startManualDraft}
            announce={announce}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {draftNote ? (
              <div className="grid gap-1 rounded-2xl bg-paper-2 px-4 py-3 text-sm sm:col-span-2">
                <p className="text-ink">{draftNote}</p>
                <p className="text-ink-3">{i18n._(BARCODE_COPY.manualNote)}</p>
              </div>
            ) : null}
            <Field label={t`Food name`}>
              {(id) => (
                <Input
                  id={id}
                  value={quick.name}
                  onChange={(event) => setQuick({ ...quick, name: event.target.value })}
                />
              )}
            </Field>
            <Field label={t`Values per`}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={quick.basisAmount}
                  onChange={(event) => setQuick({ ...quick, basisAmount: event.target.value })}
                />
              )}
            </Field>
            <Field label={t`Per unit`}>
              {(id) => (
                <select
                  id={id}
                  className={nativeSelectClass}
                  value={quick.basisUnit}
                  onChange={(event) => {
                    const next = event.target.value as AmountUnit;
                    setQuick({ ...quick, basisUnit: next });
                    setUnit(next);
                  }}
                >
                  {AMOUNT_UNITS.map((option) => (
                    <option key={option} value={option}>
                      {i18n._(UNIT_LABELS[option])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {QUICK_ADD_NUTRIENTS.map((key) => (
              <Field key={key} label={i18n._(nutrientFieldLabel(key))}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={quick.nutrients[key] ?? ""}
                    onChange={(event) =>
                      setQuick({
                        ...quick,
                        nutrients: { ...quick.nutrients, [key]: event.target.value },
                      })
                    }
                  />
                )}
              </Field>
            ))}
            {draftNote !== null ? (
              <Field label={t`Barcode (kept with this food), optional`}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="off"
                    value={quick.barcode ?? ""}
                    onChange={(event) => setQuick({ ...quick, barcode: event.target.value })}
                  />
                )}
              </Field>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2 sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={saveAsFood}
                onChange={(event) => setSaveAsFood(event.target.checked)}
              />
              <Trans>Save to my foods for next time</Trans>
            </label>
            {!parsedQuick.ok && quick.name ? (
              <p className="text-sm text-destructive sm:col-span-2" role="alert">
                {i18n._(parsedQuick.error)}
              </p>
            ) : null}
          </div>
        )}

        <div className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-3 sm:items-end lg:grid-cols-1 xl:grid-cols-3">
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
          <Field label={t`Amount`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
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
                {allowedUnits.map((option) => (
                  <option key={option} value={option}>
                    {i18n._(UNIT_LABELS[option])}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="flex w-full flex-wrap gap-2 sm:col-span-3 lg:col-span-1 xl:col-span-3">
            <Button
              className="w-full sm:w-auto"
              onClick={() => void submit()}
              disabled={!preview || log.isPending || createFood.isPending}
            >
              {log.isPending ? t`Saving…` : t`Save to ${slotLabel}`}
            </Button>
            {chosen || draftNote !== null ? (
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                onClick={() => {
                  reset();
                  announce(t`Nothing saved`);
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
            ) : null}
          </div>
        </div>

        {preview ? (
          <div
            className="grid gap-1 rounded-2xl bg-food-soft px-4 py-3 text-sm"
            aria-label={t`Review before saving`}
          >
            <p className="font-semibold text-ink">{reviewLine}</p>
            <p className="text-ink-2 tabular-nums">
              {formatNutrientSummaryLine(preview, hideNumbers, i18n)}
            </p>
            {missingNote ? <p className="text-ink-3">{missingNote}</p> : null}
            {mode !== "quick" && chosen?.attribution ? (
              <p className="text-ink-3">{chosen.attribution}</p>
            ) : null}
            {mode === "barcode" ? (
              <p className="text-ink-3">{i18n._(BARCODE_COPY.verify)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Typed barcode lookup (Issue #75). The web app has no camera scanning: the
 * web document's `Permissions-Policy` disables the camera, and the
 * `BarcodeDetector` API is not broadly available. A hit lists the matches for
 * the member to review; a miss, store code, nameless product or unreachable
 * source opens a manual draft. Nothing is saved from here.
 */
function BarcodeLookupPanel({
  chosen,
  onSelect,
  onManualDraft,
  announce,
}: {
  chosen: FoodCandidate | null;
  onSelect: (candidate: FoodCandidate) => void;
  onManualDraft: (barcode: string | null, note: string) => void;
  announce: (text: string) => void;
}) {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const [outcome, setOutcome] = useState<BarcodeOutcome | null>(null);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const lookup = useMutation(orpc.nutritionFoods.lookupBarcode.mutationOptions());
  const { t, i18n } = useLingui();

  const run = (barcode: string) => {
    setLastBarcode(barcode);
    setOutcome(null);
    lookup.mutate(
      { barcode },
      {
        onSuccess: (result) => {
          const next = describeBarcodeLookup(result);
          setOutcome(next);
          announce(i18n._(next.message));
        },
        onError: (failure) => {
          if ((failure as { code?: string }).code === "INVALID_INPUT") {
            setError(BARCODE_COPY.invalid);
            announce(i18n._(BARCODE_COPY.invalid));
            return;
          }
          setError(DIARY_COPY.networkError);
          announce(i18n._(DIARY_COPY.networkError));
        },
      },
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseBarcode(digits);
    if (!parsed.ok) {
      setError(parsed.error);
      setOutcome(null);
      announce(i18n._(parsed.error));
      return;
    }
    setError(null);
    run(parsed.barcode);
  };

  return (
    <div className="grid gap-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
        <Field label={i18n._(BARCODE_COPY.digitsLabel)}>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              className="num w-56"
              value={digits}
              aria-invalid={error === BARCODE_COPY.invalid}
              aria-describedby="barcode-help"
              onChange={(event) => setDigits(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" disabled={lookup.isPending}>
          {i18n._(lookup.isPending ? BARCODE_COPY.lookingUp : BARCODE_COPY.lookUp)}
        </Button>
      </form>
      <p id="barcode-help" className="text-sm text-ink-3">
        {i18n._(BARCODE_COPY.webNoCamera)}
      </p>

      {error ? (
        <div className="grid gap-2 text-sm" role="alert">
          <p className="text-destructive">{i18n._(error)}</p>
          {error === DIARY_COPY.networkError ? (
            <div className="flex flex-wrap gap-2">
              {lastBarcode ? (
                <Button size="sm" variant="outline" onClick={() => run(lastBarcode)}>
                  {i18n._(DIARY_COPY.retry)}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onManualDraft(lastBarcode, i18n._(DIARY_COPY.networkError))}
              >
                {i18n._(BARCODE_COPY.enterManually)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {outcome?.kind === "matches" ? (
        <div className="grid gap-2">
          <p className="text-sm text-ink-2">{i18n._(outcome.message)}</p>
          <ul
            className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule"
            aria-label={t`Barcode matches`}
          >
            {outcome.candidates.map((candidate) => (
              <CandidateButton
                key={candidate.key}
                candidate={candidate}
                selected={chosen?.key === candidate.key}
                onSelect={() => onSelect(candidate)}
              />
            ))}
          </ul>
          <AttributionNotes candidates={outcome.candidates} />
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onManualDraft(outcome.barcode, i18n._(BARCODE_COPY.notThisProduct))}
            >
              <Trans>Not this product? Enter food manually</Trans>
            </Button>
          </div>
        </div>
      ) : outcome?.kind === "manual" ? (
        <div className="grid gap-2 text-sm">
          <p className="text-ink-2">{i18n._(outcome.message)}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onManualDraft(outcome.barcode, i18n._(outcome.message))}
            >
              {i18n._(BARCODE_COPY.enterManually)}
            </Button>
            {outcome.canRetry && lastBarcode ? (
              <Button size="sm" variant="outline" onClick={() => run(lastBarcode)}>
                {i18n._(BARCODE_COPY.retry)}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
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

  if (!open)
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Copy aria-hidden="true" />
          {i18n._(DIARY_COPY.copyFrom)}
        </Button>
      </div>
    );

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
    <Section
      icon={Copy}
      tone="food"
      sheet
      aria-labelledby="copy-day-heading"
      title={<span id="copy-day-heading">{i18n._(DIARY_COPY.copyFrom)}</span>}
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
    </Section>
  );
}
