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
import { CUSTOM_FOOD_COPY } from "@openvalens/api/presenters/custom-foods";
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
  SUMMARY_NUTRIENTS,
  dayStatusText,
  deviceTimeZone,
  foodSourceLabel,
  formatAmount,
  formatNutrientTotal,
  formatNutrientValue,
  groupBySlot,
  localDateIn,
  newClientMutationId,
  parseQuickAdd,
  previewNutrients,
  shiftLocalDate,
  summarizeDay,
  unitsFor,
  type QuickAddFields,
} from "@openvalens/api/presenters/nutrition-diary";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Meal diary (Issue #77) with food search and typed barcode lookup (#75). Online-only on web: every change goes straight to
 * `nutritionDiary.*`, and a network failure leaves saved data untouched and
 * offers a retry (the durable offline outbox is mobile-only). Copy is neutral:
 * it records, it never judges.
 */
export const Route = createFileRoute("/_auth/nutrition")({
  component: NutritionPage,
});

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
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

function networkFailure(retry: () => void, announce: (text: string) => void) {
  announce(DIARY_COPY.networkError);
  toast.error(DIARY_COPY.networkError, { action: { label: DIARY_COPY.retry, onClick: retry } });
}

function NutritionPage() {
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const [localDate, setLocalDate] = useState(() => localDateIn(timeZone));
  const { announce, region } = useAnnouncer();
  const queryClient = useQueryClient();

  const dayQuery = useQuery(orpc.nutritionDiary.getDay.queryOptions({ input: { localDate } }));
  const foodsQuery = useQuery(orpc.nutritionDiary.listFoods.queryOptions({ input: {} }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.nutritionDiary.key() });

  const go = (date: string) => {
    setLocalDate(date);
    announce(`Showing ${date}`);
  };

  const day = dayQuery.data;
  const summary = summarizeDay(day?.entries ?? []);
  const status = dayStatusText(day?.status ?? "unmarked", summary.entryCount);

  const setStatus = useMutation(
    orpc.nutritionDiary.setDayStatus.mutationOptions({
      onSuccess: (result) => {
        announce(`${result.localDate}: ${dayStatusText(result.status, summary.entryCount).label}`);
        void refresh();
      },
    }),
  );
  const toggleStatus = () => {
    const input = { localDate, complete: day?.status !== "complete" };
    setStatus.mutate(input, {
      onError: () => networkFailure(() => setStatus.mutate(input), announce),
    });
  };

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      {region}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{DIARY_COPY.title}</h1>
          <Link to="/foods" className="text-sm underline">
            {CUSTOM_FOOD_COPY.manageLink}
          </Link>
        </div>
        <nav className="flex items-center gap-2" aria-label="Choose day">
          <Button variant="outline" size="sm" onClick={() => go(shiftLocalDate(localDate, -1))}>
            Previous day
          </Button>
          <Input
            type="date"
            aria-label="Diary date"
            className="w-40"
            value={localDate}
            onChange={(event) => event.target.value && go(event.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => go(shiftLocalDate(localDate, 1))}>
            Next day
          </Button>
        </nav>
      </div>

      {dayQuery.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : dayQuery.isError ? (
        <p className="text-sm text-muted-foreground" role="alert">
          {DIARY_COPY.networkError}{" "}
          <button className="underline" onClick={() => void dayQuery.refetch()}>
            {DIARY_COPY.retry}
          </button>
        </p>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>{localDate}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  <Badge variant={day?.status === "complete" ? "secondary" : "outline"}>
                    {status.label}
                  </Badge>{" "}
                  {status.description}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleStatus}
                disabled={setStatus.isPending}
              >
                {day?.status === "complete" ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete}
              </Button>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {SUMMARY_NUTRIENTS.map((key) => (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">{NUTRIENT_LABELS[key].label}</dt>
                    <dd className="font-mono text-sm">
                      {formatNutrientTotal(key, summary.totals[key])}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{DIARY_COPY.unknownNote}</p>
            </CardContent>
          </Card>

          <AddFood
            localDate={localDate}
            timeZone={timeZone}
            foods={foodsQuery.data}
            onSaved={(name, slot) => {
              announce(`Saved ${name} to ${SLOT_LABELS[slot]} on ${localDate}`);
              void refresh();
            }}
            announce={announce}
          />

          {groupBySlot(day?.entries ?? []).map((group) => (
            <section key={group.slot} aria-labelledby={`slot-${group.slot}`}>
              <h2 id={`slot-${group.slot}`} className="mb-2 text-lg font-medium">
                {group.label}
              </h2>
              {group.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{DIARY_COPY.emptySlot}</p>
              ) : (
                <Card className="py-0">
                  <ul className="divide-y divide-border">
                    {group.entries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        favorite={
                          foodsQuery.data?.favorites.some(
                            (food) =>
                              food.ref.kind === "snapshot" &&
                              food.ref.snapshotId === entry.food.snapshotId,
                          ) ?? false
                        }
                        onChanged={() => void refresh()}
                        announce={announce}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          ))}

          <CopyDay
            localDate={localDate}
            timeZone={timeZone}
            onCopied={() => void refresh()}
            announce={announce}
          />
        </>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  favorite,
  onChanged,
  announce,
}: {
  entry: DiaryEntry;
  favorite: boolean;
  onChanged: () => void;
  announce: (text: string) => void;
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

  const handle = (result: EntryOutcome, done: string) => {
    if (result.outcome === "conflict") {
      setConflict(result.server);
      announce(DIARY_COPY.conflictTitle);
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
        if (handle(result, `Updated ${entry.food.name}`)) {
          setEditing(false);
          setConflict(null);
        }
      },
      onError: () => networkFailure(() => update.mutate(input), announce),
    });
  };

  const undo = (revision: number) => {
    const input = {
      clientMutationId: newClientMutationId(),
      entryId: entry.id,
      expectedRevision: revision,
    };
    restore.mutate(input, {
      onSuccess: (result) => handle(result, DIARY_COPY.restored),
      onError: () => networkFailure(() => restore.mutate(input), announce),
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
        handle(result, `${DIARY_COPY.deleted} ${entry.food.name}`);
        toast(`${DIARY_COPY.deleted} ${entry.food.name}`, {
          action: { label: DIARY_COPY.undo, onClick: () => undo(result.entry.revision) },
        });
      },
      onError: () => networkFailure(() => remove.mutate(input), announce),
    });
  };

  const units = unitsFor(entry.food.basis);
  const preview = previewNutrients(
    entry.food.basis,
    entry.food.nutrientsPerBasis,
    Number(amount),
    unit,
  );

  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="font-medium">{entry.food.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatAmount(entry.amount, entry.unit)} · {foodSourceLabel(entry.food.source)}
            {entry.food.brand ? ` · ${entry.food.brand}` : ""}
          </span>
          {entry.food.source === "off" && entry.food.attribution ? (
            <span className="text-xs text-muted-foreground">{entry.food.attribution}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">
            {formatNutrientValue("energyKcal", entry.nutrients.energyKcal)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
          >
            Edit <span className="sr-only">{entry.food.name}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={favorite}
            onClick={() =>
              favoriteMutation.mutate(
                { snapshotId: entry.food.snapshotId, favorite: !favorite },
                {
                  onSuccess: () => {
                    announce(favorite ? "Removed from favourites" : "Added to favourites");
                    onChanged();
                  },
                  onError: () => announce(DIARY_COPY.networkError),
                },
              )
            }
          >
            {favorite ? "Unfavourite" : "Favourite"}{" "}
            <span className="sr-only">{entry.food.name}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={del} disabled={remove.isPending}>
            Delete <span className="sr-only">{entry.food.name}</span>
          </Button>
        </div>
      </div>
      {conflict ? (
        <div className="grid gap-2 rounded-md border p-3 text-sm" role="alert">
          <p className="font-medium">{DIARY_COPY.conflictTitle}</p>
          <p>
            Other version:{" "}
            {conflict.deleted
              ? "deleted"
              : `${formatAmount(conflict.amount, conflict.unit)}, ${SLOT_LABELS[conflict.slot]}`}
            . Your change: {formatAmount(Number(amount), unit)}, {SLOT_LABELS[slot]}.
          </p>
          <div className="flex gap-2">
            {conflict.deleted ? null : (
              <Button size="sm" onClick={() => save(conflict.revision)}>
                {DIARY_COPY.keepMine}
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
              {DIARY_COPY.keepServer}
            </Button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select
                id={id}
                className={selectClass}
                value={unit}
                onChange={(event) => setUnit(event.target.value as AmountUnit)}
              >
                {units.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Meal">
            {(id) => (
              <select
                id={id}
                className={selectClass}
                value={slot}
                onChange={(event) => setSlot(event.target.value as MealSlot)}
              >
                {MEAL_SLOTS.map((option) => (
                  <option key={option} value={option}>
                    {SLOT_LABELS[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Button onClick={() => save()} disabled={preview === null || update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}
    </li>
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
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        className={`flex w-full justify-between gap-3 px-3 py-2 text-left text-sm ${selected ? "bg-accent" : ""}`}
        onClick={onSelect}
      >
        <span>
          {candidate.name}
          {candidate.brand ? ` · ${candidate.brand}` : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{candidate.sourceLabel}</span>
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
        <p key={notice} className="text-xs text-muted-foreground">
          {notice}
        </p>
      ))}
    </div>
  );
}

function AddFood({
  localDate,
  timeZone,
  foods,
  onSaved,
  announce,
}: {
  localDate: string;
  timeZone: string;
  foods: { recents: FoodChoice[]; favorites: FoodChoice[]; customFoods: FoodChoice[] } | undefined;
  onSaved: (name: string, slot: MealSlot) => void;
  announce: (text: string) => void;
}) {
  const [slot, setSlot] = useState<MealSlot>("breakfast");
  const [mode, setMode] = useState<"choose" | "barcode" | "quick">("choose");
  const [query, setQuery] = useState("");
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
    announce(BARCODE_COPY.enterManually);
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
  const missingNote = mode !== "quick" && chosen ? missingDataNote(chosen) : null;

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
      networkFailure(() => void submit(), announce);
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
        onError: () => networkFailure(send, announce),
      });
    send();
  };

  const modes = [
    ["choose", "Search and recents"],
    ["barcode", BARCODE_COPY.mode],
    ["quick", "Quick add"],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{DIARY_COPY.addFood}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="How to add">
          {modes.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "default" : "outline"}
              aria-pressed={mode === value}
              onClick={() => switchMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {mode === "choose" ? (
          <div className="grid gap-3">
            <Field label={BARCODE_COPY.searchLabel}>
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
              {BARCODE_COPY.searchHint}
            </p>
            <section className="grid gap-1" aria-label={BARCODE_COPY.savedFoods}>
              <h3 className="text-sm font-medium">{BARCODE_COPY.savedFoods}</h3>
              {saved.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {query.trim()
                    ? BARCODE_COPY.searchEmpty
                    : "No saved or recent foods yet. Search, scan a barcode or use quick add."}
                </p>
              ) : (
                <ul className="max-h-56 overflow-y-auto rounded-md border" aria-label="Saved foods">
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
            <section className="grid gap-1" aria-label={BARCODE_COPY.searchResults}>
              <h3 className="text-sm font-medium">{BARCODE_COPY.searchResults}</h3>
              {!isSearchable(debounced) ? (
                <p className="text-sm text-muted-foreground">{BARCODE_COPY.searchHint}</p>
              ) : search.isPending ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Searching…
                </p>
              ) : search.isError ? (
                <p className="text-sm text-muted-foreground" role="alert">
                  {BARCODE_COPY.searchFailed}{" "}
                  <button className="underline" onClick={() => void search.refetch()}>
                    {DIARY_COPY.retry}
                  </button>
                </p>
              ) : found.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {BARCODE_COPY.searchEmpty}
                </p>
              ) : (
                <>
                  <p className="sr-only" role="status">
                    {found.length} {found.length === 1 ? "food" : "foods"} found
                  </p>
                  <ul
                    className="max-h-72 overflow-y-auto rounded-md border"
                    aria-label="Food database results"
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
          <div className="grid gap-3 sm:grid-cols-3">
            {draftNote ? (
              <div className="grid gap-1 rounded-md border p-3 text-sm sm:col-span-3">
                <p>{draftNote}</p>
                <p className="text-muted-foreground">{BARCODE_COPY.manualNote}</p>
              </div>
            ) : null}
            <Field label="Food name">
              {(id) => (
                <Input
                  id={id}
                  value={quick.name}
                  onChange={(event) => setQuick({ ...quick, name: event.target.value })}
                />
              )}
            </Field>
            <Field label="Values per">
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={quick.basisAmount}
                  onChange={(event) => setQuick({ ...quick, basisAmount: event.target.value })}
                />
              )}
            </Field>
            <Field label="Per unit">
              {(id) => (
                <select
                  id={id}
                  className={selectClass}
                  value={quick.basisUnit}
                  onChange={(event) => {
                    const next = event.target.value as AmountUnit;
                    setQuick({ ...quick, basisUnit: next });
                    setUnit(next);
                  }}
                >
                  {AMOUNT_UNITS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {QUICK_ADD_NUTRIENTS.map((key) => (
              <Field
                key={key}
                label={`${NUTRIENT_LABELS[key].label} (${NUTRIENT_LABELS[key].unit}, optional)`}
              >
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
              <Field label={`${BARCODE_COPY.barcodeOnDraft}, optional`}>
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
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={saveAsFood}
                onChange={(event) => setSaveAsFood(event.target.checked)}
              />
              Save to my foods for next time
            </label>
            {!parsedQuick.ok && quick.name ? (
              <p className="text-sm text-muted-foreground sm:col-span-3" role="alert">
                {parsedQuick.error}
              </p>
            ) : null}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Meal">
            {(id) => (
              <select
                id={id}
                className={selectClass}
                value={slot}
                onChange={(event) => setSlot(event.target.value as MealSlot)}
              >
                {MEAL_SLOTS.map((option) => (
                  <option key={option} value={option}>
                    {SLOT_LABELS[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select
                id={id}
                className={selectClass}
                value={unit}
                onChange={(event) => setUnit(event.target.value as AmountUnit)}
              >
                {allowedUnits.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="flex gap-2">
            <Button
              onClick={() => void submit()}
              disabled={!preview || log.isPending || createFood.isPending}
            >
              {log.isPending ? "Saving…" : `Save to ${SLOT_LABELS[slot]}`}
            </Button>
            {chosen || draftNote !== null ? (
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  announce("Nothing saved");
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>

        {preview ? (
          <div className="rounded-md border p-3 text-sm" aria-label="Review before saving">
            <p className="mb-1 font-medium">
              Review: {mode !== "quick" && chosen ? `${chosen.name}, ` : ""}
              {formatAmount(Number(amount), unit)} on {localDate}
              {mode !== "quick" && chosen
                ? ` · ${chosen.sourceLabel}`
                : draftNote !== null
                  ? " · Entered by you"
                  : " · Quick add"}
            </p>
            <p className="text-muted-foreground">
              {SUMMARY_NUTRIENTS.map(
                (key) => `${NUTRIENT_LABELS[key].label} ${formatNutrientValue(key, preview[key])}`,
              ).join(" · ")}
            </p>
            {missingNote ? <p className="mt-1 text-muted-foreground">{missingNote}</p> : null}
            {mode !== "quick" && chosen?.attribution ? (
              <p className="mt-1 text-xs text-muted-foreground">{chosen.attribution}</p>
            ) : null}
            {mode === "barcode" ? (
              <p className="mt-1 text-xs text-muted-foreground">{BARCODE_COPY.verify}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
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
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BarcodeOutcome | null>(null);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const lookup = useMutation(orpc.nutritionFoods.lookupBarcode.mutationOptions());

  const run = (barcode: string) => {
    setLastBarcode(barcode);
    setOutcome(null);
    lookup.mutate(
      { barcode },
      {
        onSuccess: (result) => {
          const next = describeBarcodeLookup(result);
          setOutcome(next);
          announce(next.message);
        },
        onError: (failure) => {
          if ((failure as { code?: string }).code === "INVALID_INPUT") {
            setError(BARCODE_COPY.invalid);
            announce(BARCODE_COPY.invalid);
            return;
          }
          setError(DIARY_COPY.networkError);
          announce(DIARY_COPY.networkError);
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
      announce(parsed.error);
      return;
    }
    setError(null);
    run(parsed.barcode);
  };

  return (
    <div className="grid gap-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
        <Field label={BARCODE_COPY.digitsLabel}>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              className="w-56"
              value={digits}
              aria-invalid={error === BARCODE_COPY.invalid}
              aria-describedby="barcode-help"
              onChange={(event) => setDigits(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={lookup.isPending}>
          {lookup.isPending ? BARCODE_COPY.lookingUp : BARCODE_COPY.lookUp}
        </Button>
      </form>
      <p id="barcode-help" className="text-xs text-muted-foreground">
        {BARCODE_COPY.webNoCamera}
      </p>

      {error ? (
        <div className="grid gap-2 text-sm" role="alert">
          <p>{error}</p>
          {error === DIARY_COPY.networkError ? (
            <div className="flex flex-wrap gap-2">
              {lastBarcode ? (
                <Button size="sm" variant="outline" onClick={() => run(lastBarcode)}>
                  {DIARY_COPY.retry}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onManualDraft(lastBarcode, DIARY_COPY.networkError)}
              >
                {BARCODE_COPY.enterManually}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {outcome?.kind === "matches" ? (
        <div className="grid gap-2">
          <p className="text-sm">{outcome.message}</p>
          <ul className="rounded-md border" aria-label="Barcode matches">
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
              onClick={() => onManualDraft(outcome.barcode, BARCODE_COPY.notThisProduct)}
            >
              Not this product? {BARCODE_COPY.enterManually}
            </Button>
          </div>
        </div>
      ) : outcome?.kind === "manual" ? (
        <div className="grid gap-2 text-sm">
          <p>{outcome.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onManualDraft(outcome.barcode, outcome.message)}>
              {BARCODE_COPY.enterManually}
            </Button>
            {outcome.canRetry && lastBarcode ? (
              <Button size="sm" variant="outline" onClick={() => run(lastBarcode)}>
                {BARCODE_COPY.retry}
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

  if (!open)
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          {DIARY_COPY.copyFrom}
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
          announce(`Copied ${result.created} items to ${localDate}`);
          setOpen(false);
          setSelected(new Set());
          onCopied();
        },
        onError: () => networkFailure(send, announce),
      });
    send();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{DIARY_COPY.copyFrom}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="Copy from">
          {(id) => (
            <Input
              id={id}
              type="date"
              className="w-44"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setSelected(new Set());
              }}
            />
          )}
        </Field>
        {fromDate === localDate ? (
          <p className="text-sm text-muted-foreground">Choose a different day.</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{DIARY_COPY.empty}</p>
        ) : (
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium">Items to copy</legend>
            {entries.map((entry) => (
              <label key={entry.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(entry.id);
                    else next.delete(entry.id);
                    setSelected(next);
                  }}
                />
                {SLOT_LABELS[entry.slot]}: {entry.food.name},{" "}
                {formatAmount(entry.amount, entry.unit)}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={selected.size === 0 || copy.isPending}>
            Copy {selected.size} {selected.size === 1 ? "item" : "items"} to {localDate}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
