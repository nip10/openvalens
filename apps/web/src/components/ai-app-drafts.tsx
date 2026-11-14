import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  AI_APP_LAB_RANGE_FROM_REPORT,
  AI_APP_SOURCE_LABEL,
  type AiAppDraftKind,
} from "@openvalens/api/presenters/ai-apps";
import { displayLabRange, formatLabRange, formatLabValue } from "@openvalens/api/presenters/labs";
import { SLOT_LABELS } from "@openvalens/api/presenters/nutrition-diary";
import { workoutDurationLabel, workoutTypeLabel } from "@openvalens/api/presenters/workouts";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Dumbbell, TestTube, UtensilsCrossed } from "lucide-react";
import { useState } from "react";

import { Section, StatusPill } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";

/**
 * Issue #439 (M2c) — drafts a connected AI app wrote that wait for the
 * member's review: lab results on the Labs screen, workouts with an exercise
 * that is not in the catalog on Workouts, meal drafts on "Describe a meal".
 * Nothing is in the member's records until they confirm one; discarding saves
 * nothing. Each draft says which app wrote it ("via Claude").
 */

type DraftList = Awaited<ReturnType<typeof client.aiApps.drafts.list>>["drafts"];
export type AiAppDraft = DraftList[number];
export type AiAppFoodDraft = Extract<AiAppDraft, { kind: "food" }>;
type LabDraft = Extract<AiAppDraft, { kind: "lab" }>;
type WorkoutDraft = Extract<AiAppDraft, { kind: "workout" }>;

function draftsQuery(kind: AiAppDraftKind) {
  return orpc.aiApps.drafts.list.queryOptions({ input: { kind } });
}

/** The member's drafts of one kind waiting for review; empty while loading or on error. */
export function useAiAppDrafts<K extends AiAppDraftKind>(
  kind: K,
): Array<Extract<AiAppDraft, { kind: K }>> {
  const query = useQuery(draftsQuery(kind));
  return (query.data?.drafts ?? []) as Array<Extract<AiAppDraft, { kind: K }>>;
}

/** Confirm and discard for one kind, refreshing the list (and the screen) afterwards. */
export function useAiAppDraftActions(kind: AiAppDraftKind, onChanged?: () => void) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.aiApps.drafts.list.key() });
    onChanged?.();
  };
  const confirm = useMutation(
    orpc.aiApps.drafts.confirm.mutationOptions({
      onMutate: () => setError(null),
      onError: (failure) => setError(failure.message || null),
      onSettled: settle,
    }),
  );
  const discard = useMutation(
    orpc.aiApps.drafts.discard.mutationOptions({
      onMutate: () => setError(null),
      onError: (failure) => setError(failure.message || null),
      onSettled: settle,
    }),
  );
  return { confirm, discard, error, kind };
}

/** "via Claude": which app wrote a draft. */
export function ViaApp({ name }: { name: string }) {
  const { i18n } = useLingui();
  return (
    <StatusPill tone="neutral">
      <Bot className="mr-1 size-3.5" aria-hidden="true" />
      {i18n._({ ...AI_APP_SOURCE_LABEL, values: { name } })}
    </StatusPill>
  );
}

function ActionError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

// ─── Labs ─────────────────────────────────────────────────────

function labRangeLine(i18n: ReturnType<typeof useLingui>["i18n"], draft: LabDraft): string | null {
  const range = draft.payload.referenceRange;
  if (!range) return null;
  const shown = displayLabRange(
    { code: draft.payload.markerCode, unit: draft.payload.unit },
    { low: range.low, high: range.high, text: range.text, unit: draft.payload.unit },
    "as_reported",
  );
  if (!shown) return null;
  return `${formatLabRange(i18n, shown)} (${i18n._(AI_APP_LAB_RANGE_FROM_REPORT)})`;
}

/** Lab results from connected AI apps, each confirmed or discarded here. */
export function AiAppLabDrafts({ onSaved }: { onSaved?: () => void }) {
  const { t, i18n } = useLingui();
  const drafts = useAiAppDrafts("lab");
  const { confirm, discard, error } = useAiAppDraftActions("lab", onSaved);
  if (drafts.length === 0) return null;
  const busy = confirm.isPending || discard.isPending;
  return (
    <Section
      icon={TestTube}
      tone="water"
      sheet
      title={<Trans>Waiting for your review</Trans>}
      info={
        <Trans>
          A connected AI app sent these results. Check each one against the report before you save
          it; nothing is in your labs until you do.
        </Trans>
      }
    >
      <ul className="grid gap-3">
        {drafts.map((draft) => {
          const range = labRangeLine(i18n, draft);
          const marker = draft.payload.markerName;
          const app = draft.appName;
          return (
            <li
              key={draft.id}
              className="grid gap-2 rounded-2xl bg-paper-2 p-4"
              aria-label={t`${marker}, from ${app}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">{draft.payload.markerName}</span>
                <span className="num text-sm font-semibold text-ink">
                  {formatLabValue(draft.payload.value, draft.payload.unit)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <time dateTime={draft.payload.observedAt}>
                  {friendlyDate(i18n, draft.payload.observedAt)}
                </time>
                <ViaApp name={draft.appName} />
              </div>
              {range ? <span className="num text-sm text-ink-2">{range}</span> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => confirm.mutate({ draftId: draft.id })}
                >
                  <Trans>Save to my labs</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => discard.mutate({ draftId: draft.id })}
                >
                  <Trans>Discard</Trans>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ActionError error={error} />
    </Section>
  );
}

// ─── Workouts ─────────────────────────────────────────────────

/** Picks a catalog exercise for one the app named, or adds it as the member's own. */
function ExerciseResolver({
  name,
  chosen,
  onChoose,
}: {
  name: string;
  chosen: { id: number; name: string } | null;
  onChoose: (exercise: { id: number; name: string } | null) => void;
}) {
  const { t, i18n } = useLingui();
  const [query, setQuery] = useState(name);
  const search = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({
      input: { query: query.trim() || undefined, language: "en", limit: 10 },
    }),
    enabled: chosen === null && query.trim().length > 0,
  });
  const create = useMutation(
    orpc.exerciseCatalog.createCustom.mutationOptions({
      onSuccess: (created) => {
        if (created) onChoose({ id: created.id, name: created.name });
      },
    }),
  );
  if (chosen) {
    const chosenName = chosen.name;
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-2">
          <Trans>
            “{name}” will be saved as <span className="font-medium text-ink">{chosenName}</span>
          </Trans>
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChoose(null)}>
          <Trans>Change</Trans>
        </Button>
      </div>
    );
  }
  const results = (search.data ?? []) as Array<{ id: number; name: string }>;
  return (
    <div className="grid gap-2">
      <p className="text-sm text-ink-2">
        <Trans>“{name}” is not in the exercise catalog. Choose one, or add it as your own.</Trans>
      </p>
      <div className="grid gap-1.5">
        <Label className="text-sm font-medium text-ink-3">
          <Trans>Search the catalog</Trans>
        </Label>
        <Input value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {results.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t`Catalog exercises`}>
          {results.map((item) => (
            <li key={item.id}>
              <Button size="sm" variant="outline" onClick={() => onChoose(item)}>
                {item.name}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={create.isPending}
        onClick={() => create.mutate({ name, language: i18n.locale || "en" })}
      >
        <Trans>Add “{name}” as my own exercise</Trans>
      </Button>
      {create.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not add the exercise. Try again.</Trans>
        </p>
      ) : null}
    </div>
  );
}

function WorkoutDraftCard({
  draft,
  actions,
}: {
  draft: WorkoutDraft;
  actions: ReturnType<typeof useAiAppDraftActions>;
}) {
  const { t, i18n } = useLingui();
  const [chosen, setChosen] = useState<Record<number, { id: number; name: string } | null>>({});
  const plan = draft.payload;
  const unresolved = plan.exercises
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.exerciseId === null);
  const ready = unresolved.every(({ index }) => chosen[index]);
  const busy = actions.confirm.isPending || actions.discard.isPending;
  const type = i18n._(workoutTypeLabel(plan.type));
  const app = draft.appName;
  return (
    <li className="grid gap-3 rounded-2xl bg-paper-2 p-4" aria-label={t`${type}, from ${app}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">{type}</span>
        <span className="text-sm text-ink-2">
          {friendlyDate(i18n, plan.date)}
          {plan.duration ? ` · ${workoutDurationLabel(plan.duration)}` : ""}
        </span>
      </div>
      <ViaApp name={draft.appName} />
      <ol className="grid gap-3">
        {plan.exercises.map((item, index) => (
          <li key={index} className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">
              {item.name}{" "}
              <span className="font-normal text-ink-3">
                <Plural value={item.sets.length} one="# set" other="# sets" />
              </span>
            </span>
            {item.exerciseId === null ? (
              <ExerciseResolver
                name={item.name}
                chosen={chosen[index] ?? null}
                onChoose={(exercise) => setChosen((current) => ({ ...current, [index]: exercise }))}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() =>
            actions.confirm.mutate({
              draftId: draft.id,
              exercises: unresolved.map(({ index }) => ({
                index,
                exerciseId: chosen[index]!.id,
              })),
            })
          }
        >
          <Trans>Save workout</Trans>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => actions.discard.mutate({ draftId: draft.id })}
        >
          <Trans>Discard</Trans>
        </Button>
      </div>
    </li>
  );
}

/** Workouts from connected AI apps with an exercise that is not in the catalog. */
export function AiAppWorkoutDrafts({ onSaved }: { onSaved?: () => void }) {
  const drafts = useAiAppDrafts("workout");
  const actions = useAiAppDraftActions("workout", onSaved);
  if (drafts.length === 0) return null;
  return (
    <Section
      icon={Dumbbell}
      tone="steps"
      sheet
      title={<Trans>Waiting for your review</Trans>}
      info={
        <Trans>
          A connected AI app sent these workouts with an exercise that is not in the catalog. Choose
          a catalog exercise or add it as your own, then save; nothing is in your workouts until you
          do.
        </Trans>
      }
    >
      <ul className="grid gap-3">
        {drafts.map((draft) => (
          <WorkoutDraftCard key={draft.id} draft={draft} actions={actions} />
        ))}
      </ul>
      <ActionError error={actions.error} />
    </Section>
  );
}

// ─── Food ─────────────────────────────────────────────────────

/**
 * Meal drafts from connected AI apps. "Review" opens one in the draft review
 * below; the member logs each item in the meal diary from there.
 */
export function AiAppFoodDrafts({
  reviewingId,
  onReview,
  actions,
}: {
  reviewingId: string | null;
  onReview: (draft: AiAppFoodDraft) => void;
  actions: ReturnType<typeof useAiAppDraftActions>;
}) {
  const { t, i18n } = useLingui();
  const drafts = useAiAppDrafts("food");
  if (drafts.length === 0) return null;
  const busy = actions.confirm.isPending || actions.discard.isPending;
  return (
    <Section
      icon={UtensilsCrossed}
      tone="food"
      sheet
      title={<Trans>Meal drafts waiting for your review</Trans>}
      info={
        <Trans>
          A connected AI app made these from what you told it. Review one to match each item to a
          food and log it in your meal diary; nothing is logged until you do.
        </Trans>
      }
    >
      <ul className="grid gap-3">
        {drafts.map((draft) => {
          const slot = draft.payload.meal as keyof typeof SLOT_LABELS | null;
          const items = draft.payload.items.map((item) => item.foodText).join(", ");
          const app = draft.appName;
          return (
            <li
              key={draft.id}
              className="grid gap-2 rounded-2xl bg-paper-2 p-4"
              aria-label={t`Meal draft from ${app}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <span className="font-semibold text-ink">
                  {slot && SLOT_LABELS[slot] ? i18n._(SLOT_LABELS[slot]) : t`Meal`}
                </span>
                <time dateTime={draft.payload.eatenAt}>
                  {friendlyDate(i18n, draft.payload.eatenAt)}
                </time>
                <ViaApp name={draft.appName} />
              </div>
              <p className="text-sm text-ink-2">{items}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={reviewingId === draft.id ? "secondary" : "default"}
                  disabled={busy || reviewingId === draft.id}
                  onClick={() => onReview(draft)}
                >
                  {reviewingId === draft.id ? <Trans>Reviewing</Trans> : <Trans>Review</Trans>}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => actions.discard.mutate({ draftId: draft.id })}
                >
                  <Trans>Discard</Trans>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ActionError error={actions.error} />
    </Section>
  );
}
