import {
  AMOUNT_UNITS,
  MEAL_SLOTS,
  type AmountUnit,
  type FoodChoice,
  type FoodRef,
  type LogEntryInput,
  type MealSlot,
  type NutrientKey,
} from "@openvalens/api/contracts/nutrition-diary";
import { nutrientFieldLabel } from "@openvalens/api/presenters/custom-foods";
import {
  BARCODE_COPY,
  candidateFromChoice,
  defaultFoodPortion,
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
  formatAmount,
  formatNutrientValue,
  newClientMutationId,
  parseQuickAdd,
  previewNutrients,
  unitsFor,
  type QuickAddFields,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  formatDrinkNutrientsLine,
  formatNutrientSummaryLine,
} from "@openvalens/api/presenters/nutrition-targets";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, MessageSquareText, Plus, ScanBarcode, Search, Zap } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { DecimalHint } from "@/components/decimal-hint";
import { inlineButtonClass, nativeSelectClass } from "@/components/food-classes";
import { FoodDraftPanel, type DraftItem } from "@/components/food-draft-panel";
import { LogDialog } from "@/components/log-dialog";
import { draftAmount } from "@/utils/food-display";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { parseDecimal } from "@openvalens/i18n/numbers";

/**
 * Log food (#77, nutrition#0): the meal diary's sheet, opened by the log "+"
 * and each meal's "+ Add" for a meal and the day on screen. Tabs: Search
 * (saved, recent and the food databases, #69), Describe (#73), Quick add,
 * Barcode (#75) and Photo (#71) when an AI provider is on. Online-only on
 * web: a network failure leaves saved data untouched and offers a retry.
 */
export type LogFoodTab = "search" | "describe" | "quick" | "barcode" | "photo";

/** One opening of the sheet. A new `id` starts it fresh. */
export type LogFoodRequest = {
  id: number;
  meal: MealSlot;
  tab: LogFoodTab;
  /** Words for the search box (a palette one-liner). */
  query?: string;
  /** Words for Describe (the old /food-draft link). */
  text?: string;
};

export const LOG_FOOD_COPY = Object.freeze({
  title: msg`Log food`,
  search: msg`Search`,
  describe: msg`Describe`,
  quick: msg`Quick add`,
  photo: msg`Photo`,
  showAll: msg`Show all`,
  howToAdd: msg`How to add`,
});

/** Shows the sheet for `request`; `null` closes it. */
export function LogFoodSheet({
  request,
  onClose,
  localDate,
  timeZone,
  foods,
  hideNumbers,
  onSaved,
  announce,
}: {
  request: LogFoodRequest | null;
  onClose: () => void;
  localDate: string;
  timeZone: string;
  foods: { recents: FoodChoice[]; favorites: FoodChoice[]; customFoods: FoodChoice[] } | undefined;
  hideNumbers: boolean;
  onSaved: (name: string, slot: MealSlot) => void;
  announce: (text: string) => void;
}) {
  const { i18n } = useLingui();
  return (
    <LogDialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={i18n._(LOG_FOOD_COPY.title)}
      description={friendlyDate(i18n, localDate)}
      className="sm:max-w-2xl"
    >
      {request ? (
        <LogFoodForm
          key={request.id}
          request={request}
          localDate={localDate}
          timeZone={timeZone}
          foods={foods}
          hideNumbers={hideNumbers}
          onSaved={onSaved}
          onDone={onClose}
          announce={announce}
        />
      ) : null}
    </LogDialog>
  );
}

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

function networkFailure(retry: () => void, announce: (text: string) => void, i18n: I18n) {
  const message = i18n._(DIARY_COPY.networkError);
  announce(message);
  toast.error(message, { action: { label: i18n._(DIARY_COPY.retry), onClick: retry } });
}

const QUICK_ADD_NUTRIENTS: NutrientKey[] = [
  "energyKcal",
  "proteinG",
  "carbohydrateG",
  "fatG",
  "fiberG",
];
const EMPTY_QUICK: QuickAddFields = { name: "", basisAmount: "100", basisUnit: "g", nutrients: {} };
/** Saved and recent rows shown before "Show all" (nutrition#6). */
const SAVED_ROWS = 8;

/** `value`, settled for `ms` (keeps search requests to one per pause in typing). */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function LogFoodForm({
  request,
  localDate,
  timeZone,
  foods,
  hideNumbers,
  onSaved,
  onDone,
  announce,
}: {
  request: LogFoodRequest;
  localDate: string;
  timeZone: string;
  foods: { recents: FoodChoice[]; favorites: FoodChoice[]; customFoods: FoodChoice[] } | undefined;
  hideNumbers: boolean;
  onSaved: (name: string, slot: MealSlot) => void;
  onDone: () => void;
  announce: (text: string) => void;
}) {
  const [slot, setSlot] = useState<MealSlot>(request.meal);
  const [mode, setMode] = useState<LogFoodTab>(request.tab);
  const [query, setQuery] = useState(request.query ?? "");
  const [chosen, setChosen] = useState<FoodCandidate | null>(null);
  const [amount, setAmount] = useState("100");
  const [unit, setUnit] = useState<AmountUnit>("g");
  const [quick, setQuick] = useState<QuickAddFields>(EMPTY_QUICK);
  /** Set while the quick-add form is a manual draft started from a barcode. */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [saveAsFood, setSaveAsFood] = useState(false);
  const [showAllSaved, setShowAllSaved] = useState(false);
  /** The Describe or Photo item being found and logged, and where to return. */
  const [finding, setFinding] = useState<{ item: DraftItem; from: "describe" | "photo" } | null>(
    null,
  );
  const [loggedDraftIds, setLoggedDraftIds] = useState<ReadonlySet<string>>(new Set());
  const [draftView, setDraftView] = useState<"describe" | "photo">(
    request.tab === "photo" ? "photo" : "describe",
  );
  const log = useMutation(orpc.nutritionDiary.logEntry.mutationOptions());
  const createFood = useMutation(orpc.nutritionDiary.createFood.mutationOptions());
  // Kept across retries of one save so a lost response cannot save the food twice (#81).
  const [saveFoodMutationId, setSaveFoodMutationId] = useState(newClientMutationId);
  const { t, i18n } = useLingui();
  const amountValue = parseDecimal(amount, i18n.locale) ?? Number.NaN;
  const provider = useQuery({
    queryKey: ["nutritionFoodDrafts", "provider"],
    queryFn: () => client.nutritionFoodDrafts.provider({}),
  });

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
    enabled: mode === "search" && isSearchable(debounced),
    staleTime: 60_000,
  });
  const found = useMemo(
    () => searchCandidates(search.data?.results ?? [], savedIds),
    [search.data, savedIds],
  );

  const select = (candidate: FoodCandidate) => {
    setChosen(candidate);
    const supported = unitsFor(candidate.basis);
    const fromDraft = draftAmount(finding?.item ?? null);
    const portion =
      fromDraft && supported.includes(fromDraft.unit) ? fromDraft : defaultFoodPortion(candidate);
    setUnit(portion.unit);
    setAmount(String(portion.amount));
  };

  const switchMode = (next: LogFoodTab) => {
    setMode(next);
    setChosen(null);
    if (next !== "quick") setDraftNote(null);
    if (next === "describe" || next === "photo") setDraftView(next);
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

  const findDraftItem = (item: DraftItem) => {
    setFinding({ item, from: draftView });
    setQuery(item.foodText);
    setChosen(null);
    setMode("search");
  };

  /** After a save: back to the draft when one item was being found, else close. */
  const afterSave = (name: string, savedSlot: MealSlot) => {
    onSaved(name, savedSlot);
    if (finding) {
      setLoggedDraftIds((current) => new Set([...current, finding.item.id]));
      setMode(finding.from);
      setFinding(null);
      setChosen(null);
      setQuery("");
      return;
    }
    onDone();
  };

  const parsedQuick = parseQuickAdd(quick, i18n.locale);
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
  const preview = basis && perBasis ? previewNutrients(basis, perBasis, amountValue, unit) : null;
  const allowedUnits = basis ? unitsFor(basis) : [...AMOUNT_UNITS];
  const missingNote = mode !== "quick" && chosen ? missingDataNote(chosen, i18n) : null;
  const slotLabel = i18n._(SLOT_LABELS[slot]);
  const reviewAmount = formatAmount(amountValue, unit, i18n);
  const reviewName = mode !== "quick" && chosen ? chosen.name : null;
  const reviewLine = reviewName ? `${reviewName}, ${reviewAmount}` : reviewAmount;

  const send = (input: Omit<LogEntryInput, "clientMutationId">, name: string) => {
    const full = { ...input, clientMutationId: newClientMutationId() } as LogEntryInput;
    // The same client mutation id is reused on retry, so a lost response cannot duplicate the meal.
    const go = () =>
      log.mutate(full, {
        onSuccess: () => afterSave(name, full.slot),
        onError: () => networkFailure(go, announce, i18n),
      });
    go();
  };

  /** One tap from a saved or recent row: its usual amount, to the chosen meal (nutrition#6). */
  const quickLog = (candidate: FoodCandidate) => {
    const portion = defaultFoodPortion(candidate);
    send(
      {
        localDate,
        timeZone,
        slot,
        food: candidate.ref,
        amount: portion.amount,
        unit: portion.unit,
        method: candidate.method,
      },
      candidate.name,
    );
  };

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
          setSaveFoodMutationId(newClientMutationId());
        } else {
          food = { kind: "manual", food: parsedQuick.food };
        }
      } else return;
    } catch {
      networkFailure(() => void submit(), announce, i18n);
      return;
    }
    send({ localDate, timeZone, slot, food, amount: amountValue, unit, method }, name);
  };

  const photoOn = provider.data?.available === true;
  const modes = [
    ["search", i18n._(LOG_FOOD_COPY.search), Search],
    ["describe", i18n._(LOG_FOOD_COPY.describe), MessageSquareText],
    ["quick", i18n._(LOG_FOOD_COPY.quick), Zap],
    ["barcode", i18n._(BARCODE_COPY.mode), ScanBarcode],
    ...(photoOn ? ([["photo", i18n._(LOG_FOOD_COPY.photo), Camera]] as const) : []),
  ] as const;
  const drafting = mode === "describe" || mode === "photo";
  const kcalOf = (candidate: FoodCandidate) => {
    if (hideNumbers) return null;
    const portion = defaultFoodPortion(candidate);
    const values = previewNutrients(
      candidate.basis,
      candidate.nutrientsPerBasis,
      portion.amount,
      portion.unit,
    );
    const kcal = values?.energyKcal;
    return kcal === null || kcal === undefined
      ? null
      : formatNutrientValue("energyKcal", kcal, i18n);
  };
  const savedShown = showAllSaved || query.trim() ? saved : saved.slice(0, SAVED_ROWS);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="sm:max-w-48">
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
      </div>

      <div
        className="flex flex-wrap gap-1 rounded-3xl bg-paper-2 p-1"
        role="group"
        aria-label={i18n._(LOG_FOOD_COPY.howToAdd)}
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

      {/* Kept mounted so a draft survives a trip to Search to find one of its items. */}
      <div hidden={!drafting}>
        <FoodDraftPanel
          view={draftView}
          initialText={request.text}
          loggedIds={loggedDraftIds}
          onFind={findDraftItem}
          onAiDraft={(draft) => {
            const meal = draft.payload.meal;
            if (meal && (MEAL_SLOTS as readonly string[]).includes(meal)) setSlot(meal as MealSlot);
          }}
        />
      </div>

      {mode === "search" ? (
        <div className="grid gap-3">
          {finding ? (
            <p className="rounded-2xl bg-food-soft px-4 py-2.5 text-sm text-ink-2">
              <Trans>Finding “{finding.item.foodText}” from your draft.</Trans>{" "}
              <button
                type="button"
                className={inlineButtonClass}
                onClick={() => {
                  setMode(finding.from);
                  setFinding(null);
                  setQuery("");
                }}
              >
                <Trans>Back to the draft</Trans>
              </button>
            </p>
          ) : null}
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
            <h3 className="text-sm font-semibold text-ink-3">{i18n._(BARCODE_COPY.savedFoods)}</h3>
            {saved.length === 0 ? (
              <p className="text-sm text-ink-3">
                {query.trim()
                  ? i18n._(BARCODE_COPY.searchEmpty)
                  : t`No saved or recent foods yet. Search, scan a barcode or use quick add.`}
              </p>
            ) : (
              <>
                <ul
                  className="divide-y divide-rule rounded-2xl border border-rule"
                  aria-label={t`Saved foods`}
                >
                  {savedShown.map((candidate) => (
                    <CandidateButton
                      key={candidate.key}
                      candidate={candidate}
                      detail={kcalOf(candidate)}
                      selected={chosen?.key === candidate.key}
                      onSelect={() => select(candidate)}
                      onQuickLog={log.isPending ? undefined : () => quickLog(candidate)}
                      quickLogLabel={t`Add ${candidate.name} to ${slotLabel}`}
                    />
                  ))}
                </ul>
                {savedShown.length < saved.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    onClick={() => setShowAllSaved(true)}
                  >
                    {i18n._(LOG_FOOD_COPY.showAll)}
                    <span className="num text-ink-3">{saved.length}</span>
                  </Button>
                ) : null}
              </>
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
                      detail={i18n._(candidate.sourceLabel)}
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
          chosen={chosen}
          onSelect={select}
          onManualDraft={startManualDraft}
          announce={announce}
        />
      ) : mode === "quick" ? (
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
          <div className="grid grid-cols-2 gap-3">
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
          </div>
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
      ) : null}

      {drafting ? null : (
        <div className="grid gap-3 border-t border-rule pt-4">
          {preview ? (
            <div
              className="grid gap-1 rounded-2xl bg-food-soft px-4 py-3 text-sm"
              aria-label={t`Review before saving`}
            >
              <p className="font-semibold text-ink">{reviewLine}</p>
              <p className="text-ink-2 tabular-nums">
                {formatNutrientSummaryLine(preview, hideNumbers, i18n)}
              </p>
              {hideNumbers ? null : (
                <p className="text-ink-3 tabular-nums">
                  {formatDrinkNutrientsLine(preview, hideNumbers, i18n)}
                </p>
              )}
              {missingNote ? <p className="text-ink-3">{missingNote}</p> : null}
              {mode !== "quick" && chosen?.attribution ? (
                <p className="text-ink-3">{chosen.attribution}</p>
              ) : null}
              {mode === "barcode" ? (
                <p className="text-ink-3">{i18n._(BARCODE_COPY.verify)}</p>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t`Amount`}>
              {(id) => (
                <>
                  <Input
                    id={id}
                    inputMode="decimal"
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
                  {allowedUnits.map((option) => (
                    <option key={option} value={option}>
                      {i18n._(UNIT_LABELS[option])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Button
            className="w-full sm:w-fit"
            onClick={() => void submit()}
            disabled={!preview || log.isPending || createFood.isPending}
          >
            {log.isPending ? t`Saving…` : t`Save to ${slotLabel}`}
          </Button>
        </div>
      )}
    </div>
  );
}

function CandidateButton({
  candidate,
  detail,
  selected,
  onSelect,
  onQuickLog,
  quickLogLabel,
}: {
  candidate: FoodCandidate;
  /** Right of the name: kcal for a usual amount, or the source. */
  detail: string | null;
  selected: boolean;
  onSelect: () => void;
  /** One tap to log the usual amount; absent while a save is running. */
  onQuickLog?: () => void;
  quickLogLabel?: string;
}) {
  return (
    <li className="flex min-w-0 items-center">
      <button
        type="button"
        aria-pressed={selected}
        className={`flex min-w-0 flex-1 cursor-pointer justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors duration-[var(--dur-short)] hover:bg-paper-2 active:bg-paper-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-food-soft aria-pressed:text-ink ${selected ? "font-semibold text-ink" : "text-ink-2"}`}
        onClick={onSelect}
      >
        <span className="min-w-0 break-words">
          {candidate.name}
          {candidate.brand ? <span className="text-ink-3">, {candidate.brand}</span> : null}
        </span>
        {detail ? <span className="num shrink-0 text-ink-3">{detail}</span> : null}
      </button>
      {quickLogLabel ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1.5 shrink-0 text-ink-3 hover:text-ink"
          disabled={!onQuickLog}
          onClick={onQuickLog}
          aria-label={quickLogLabel}
          title={quickLogLabel}
        >
          <Plus aria-hidden="true" />
        </Button>
      ) : null}
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
                detail={i18n._(candidate.sourceLabel)}
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
