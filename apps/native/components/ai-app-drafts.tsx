import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import {
  AI_APP_LAB_RANGE_FROM_REPORT,
  AI_APP_SOURCE_LABEL,
  type AiAppDraftKind,
} from "@openvalens/api/presenters/ai-apps";
import { displayLabRange, formatLabRange, formatLabValue } from "@openvalens/api/presenters/labs";
import { SLOT_LABELS } from "@openvalens/api/presenters/nutrition-diary";
import { workoutDurationLabel, workoutTypeLabel } from "@openvalens/api/presenters/workouts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Dumbbell, TestTube, UtensilsCrossed } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { Section, StatusPill } from "@/components/bloom";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #439 (M2c) — drafts a connected AI app wrote, reviewed on mobile as on
 * the web (`apps/web/src/components/ai-app-drafts.tsx`): lab results on Labs,
 * workouts with an exercise that is not in the catalog on Training, and meal
 * drafts from the food diary, matched in Add food. Nothing is in the member's
 * records until they confirm one; discarding saves nothing. Each draft says
 * which app wrote it ("via Claude").
 */

type DraftList = Awaited<ReturnType<typeof client.aiApps.drafts.list>>["drafts"];
export type AiAppDraft = DraftList[number];
export type AiAppFoodDraft = Extract<AiAppDraft, { kind: "food" }>;
type LabDraft = Extract<AiAppDraft, { kind: "lab" }>;
type WorkoutDraft = Extract<AiAppDraft, { kind: "workout" }>;

/** The member's drafts of one kind waiting for review; empty while loading or on error. */
export function useAiAppDrafts<K extends AiAppDraftKind>(
  kind: K,
  enabled = true,
): { drafts: Array<Extract<AiAppDraft, { kind: K }>>; isPending: boolean } {
  const query = useQuery({
    ...orpc.aiApps.drafts.list.queryOptions({ input: { kind } }),
    enabled,
  });
  return {
    drafts: (query.data?.drafts ?? []) as Array<Extract<AiAppDraft, { kind: K }>>,
    isPending: query.isPending,
  };
}

/** Confirm and discard for one kind, refreshing the list (and the screen) afterwards. */
export function useAiAppDraftActions(onChanged?: () => void) {
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
  return { confirm, discard, error, busy: confirm.isPending || discard.isPending };
}

export type AiAppDraftActions = ReturnType<typeof useAiAppDraftActions>;

/** "via Claude": which app wrote a draft. */
export function ViaApp({ name }: { name: string }) {
  const { i18n } = useLingui();
  return (
    <StatusPill tone="neutral">{i18n._({ ...AI_APP_SOURCE_LABEL, values: { name } })}</StatusPill>
  );
}

export function AiAppDraftError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
      {error}
    </Text>
  );
}

function DraftCard({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View className="gap-2 rounded-2xl bg-paper-2 p-4" accessibilityLabel={label}>
      {children}
    </View>
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

/** Lab results from connected AI apps, each saved or discarded here. */
export function AiAppLabDrafts({ onSaved }: { onSaved?: () => void }) {
  const { t, i18n } = useLingui();
  const { drafts } = useAiAppDrafts("lab");
  const actions = useAiAppDraftActions(onSaved);
  if (drafts.length === 0) return null;
  return (
    <Section
      icon={TestTube}
      tone="water"
      sheet
      title={t`Waiting for your review`}
      info={t`A connected AI app sent these results. Check each one against the report before you save it; nothing is in your labs until you do.`}
    >
      <View className="gap-3" testID="ai-app-lab-drafts">
        {drafts.map((draft, index) => {
          const range = labRangeLine(i18n, draft);
          const marker = draft.payload.markerName;
          const app = draft.appName;
          return (
            <DraftCard key={draft.id} label={t`${marker}, from ${app}`}>
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="font-sans text-base font-semibold text-ink">{marker}</Text>
                <Text className="font-sans text-sm font-semibold text-ink">
                  {formatLabValue(draft.payload.value, draft.payload.unit)}
                </Text>
              </View>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-sans text-sm text-ink-3">
                  {friendlyDate(i18n, draft.payload.observedAt)}
                </Text>
                <ViaApp name={app} />
              </View>
              {range ? <Text className="font-sans text-sm text-ink-2">{range}</Text> : null}
              <View className="flex-row flex-wrap gap-2">
                <Button
                  size="sm"
                  testID={`ai-lab-draft-save-${index + 1}`}
                  isDisabled={actions.busy}
                  onPress={() => actions.confirm.mutate({ draftId: draft.id })}
                >
                  <Button.Label>{t`Save to my labs`}</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  testID={`ai-lab-draft-discard-${index + 1}`}
                  isDisabled={actions.busy}
                  onPress={() => actions.discard.mutate({ draftId: draft.id })}
                >
                  <Button.Label>{t`Discard`}</Button.Label>
                </Button>
              </View>
            </DraftCard>
          );
        })}
        <AiAppDraftError error={actions.error} />
      </View>
    </Section>
  );
}

// ─── Workouts ─────────────────────────────────────────────────

type ChosenExercise = { id: number; name: string };

/** Picks a catalog exercise for one the app named, or adds it as the member's own. */
function ExerciseResolver({
  name,
  testID,
  chosen,
  onChoose,
}: {
  name: string;
  testID: string;
  chosen: ChosenExercise | null;
  onChoose: (exercise: ChosenExercise | null) => void;
}) {
  const { t, i18n } = useLingui();
  const placeholderColor = useThemeColor("ink-3");
  const [query, setQuery] = useState(name);
  const search = useQuery({
    ...orpc.exerciseCatalog.search.queryOptions({
      input: { query: query.trim() || undefined, language: i18n.locale || "en", limit: 10 },
    }),
    enabled: chosen === null && query.trim().length > 0,
  });
  const create = useMutation(
    orpc.exerciseCatalog.createCustom.mutationOptions({
      retry: false,
      onSuccess: (created) => {
        if (created) onChoose({ id: created.id, name: created.name });
      },
    }),
  );
  if (chosen) {
    const chosenName = chosen.name;
    return (
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="min-w-0 flex-1 font-sans text-sm text-ink-2">
          {t`“${name}” will be saved as ${chosenName}`}
        </Text>
        <Button size="sm" variant="ghost" onPress={() => onChoose(null)}>
          <Button.Label>{t`Change`}</Button.Label>
        </Button>
      </View>
    );
  }
  const results = (search.data ?? []) as Array<{ id: number; name: string }>;
  return (
    <View className="gap-2">
      <Text className="font-sans text-sm text-ink-2">
        {t`“${name}” is not in the exercise catalog. Choose one, or add it as your own.`}
      </Text>
      <TextInput
        testID={`${testID}-search`}
        accessibilityLabel={t`Search the catalog`}
        placeholder={t`Search the catalog`}
        value={query}
        maxLength={100}
        onChangeText={setQuery}
        className="min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink"
        placeholderTextColor={placeholderColor}
      />
      {results.length ? (
        <View className="flex-row flex-wrap gap-2" accessibilityLabel={t`Catalog exercises`}>
          {results.map((item, index) => (
            <Button
              key={item.id}
              size="sm"
              variant="outline"
              testID={`${testID}-result-${index + 1}`}
              onPress={() => onChoose(item)}
            >
              <Button.Label>{item.name}</Button.Label>
            </Button>
          ))}
        </View>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        testID={`${testID}-own`}
        isDisabled={create.isPending}
        onPress={() => create.mutate({ name, language: i18n.locale || "en" })}
      >
        <Button.Label>{t`Add “${name}” as my own exercise`}</Button.Label>
      </Button>
      {create.isError ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not add the exercise. Try again.`}
        </Text>
      ) : null}
    </View>
  );
}

function WorkoutDraftCard({
  draft,
  position,
  actions,
}: {
  draft: WorkoutDraft;
  position: number;
  actions: AiAppDraftActions;
}) {
  const { t, i18n } = useLingui();
  const [chosen, setChosen] = useState<Record<number, ChosenExercise | null>>({});
  const plan = draft.payload;
  const unresolved = plan.exercises
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.exerciseId === null);
  const ready = unresolved.every(({ index }) => chosen[index]);
  const type = i18n._(workoutTypeLabel(plan.type));
  const app = draft.appName;
  return (
    <DraftCard label={t`${type}, from ${app}`}>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-sans text-base font-semibold text-ink">{type}</Text>
        <Text className="font-sans text-sm text-ink-2">
          {friendlyDate(i18n, plan.date)}
          {plan.duration ? ` · ${workoutDurationLabel(plan.duration)}` : ""}
        </Text>
      </View>
      <ViaApp name={app} />
      <View className="gap-3">
        {plan.exercises.map((item, index) => (
          <View key={index} className="gap-1.5">
            <Text className="font-sans text-sm font-medium text-ink">
              {item.name}{" "}
              <Text className="font-normal text-ink-3">
                <Plural value={item.sets.length} one="# set" other="# sets" />
              </Text>
            </Text>
            {item.exerciseId === null ? (
              <ExerciseResolver
                name={item.name}
                testID={`ai-workout-draft-${position}-exercise-${index + 1}`}
                chosen={chosen[index] ?? null}
                onChoose={(exercise) => setChosen((current) => ({ ...current, [index]: exercise }))}
              />
            ) : null}
          </View>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="sm"
          testID={`ai-workout-draft-save-${position}`}
          isDisabled={!ready || actions.busy}
          onPress={() =>
            actions.confirm.mutate({
              draftId: draft.id,
              exercises: unresolved.map(({ index }) => ({
                index,
                exerciseId: chosen[index]!.id,
              })),
            })
          }
        >
          <Button.Label>{t`Save workout`}</Button.Label>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          testID={`ai-workout-draft-discard-${position}`}
          isDisabled={actions.busy}
          onPress={() => actions.discard.mutate({ draftId: draft.id })}
        >
          <Button.Label>{t`Discard`}</Button.Label>
        </Button>
      </View>
    </DraftCard>
  );
}

/** Workouts from connected AI apps with an exercise that is not in the catalog. */
export function AiAppWorkoutDrafts({ onSaved }: { onSaved?: () => void }) {
  const { t } = useLingui();
  const { drafts } = useAiAppDrafts("workout");
  const actions = useAiAppDraftActions(onSaved);
  if (drafts.length === 0) return null;
  return (
    <Section
      icon={Dumbbell}
      tone="steps"
      sheet
      title={t`Waiting for your review`}
      info={t`A connected AI app sent these workouts with an exercise that is not in the catalog. Choose a catalog exercise or add it as your own, then save; nothing is in your workouts until you do.`}
    >
      <View className="gap-3" testID="ai-app-workout-drafts">
        {drafts.map((draft, index) => (
          <WorkoutDraftCard key={draft.id} draft={draft} position={index + 1} actions={actions} />
        ))}
        <AiAppDraftError error={actions.error} />
      </View>
    </Section>
  );
}

// ─── Food ─────────────────────────────────────────────────────

/** The meal a draft names, or "Meal". */
export function useFoodDraftTitle() {
  const { t, i18n } = useLingui();
  return (draft: AiAppFoodDraft) => {
    const slot = draft.payload.meal as MealSlot | null;
    return slot && SLOT_LABELS[slot] ? i18n._(SLOT_LABELS[slot]) : t`Meal`;
  };
}

/**
 * Meal drafts from connected AI apps, on the food diary. "Review" opens one
 * in Add food, where each item is matched to a food and logged as usual.
 */
export function AiAppFoodDrafts({ onReview }: { onReview: (draft: AiAppFoodDraft) => void }) {
  const { t, i18n } = useLingui();
  const { drafts } = useAiAppDrafts("food");
  const actions = useAiAppDraftActions();
  const title = useFoodDraftTitle();
  if (drafts.length === 0) return null;
  return (
    <Section
      icon={UtensilsCrossed}
      tone="food"
      sheet
      title={t`Meal drafts waiting for your review`}
      info={t`A connected AI app made these from what you told it. Review one to match each item to a food and log it in your meal diary; nothing is logged until you do.`}
    >
      <View className="gap-3" testID="ai-app-food-drafts">
        {drafts.map((draft, index) => {
          const app = draft.appName;
          return (
            <DraftCard key={draft.id} label={t`Meal draft from ${app}`}>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-sans text-base font-semibold text-ink">{title(draft)}</Text>
                <Text className="font-sans text-sm text-ink-3">
                  {friendlyDate(i18n, draft.payload.eatenAt)}
                </Text>
                <ViaApp name={app} />
              </View>
              <Text className="font-sans text-sm text-ink-2">
                {draft.payload.items.map((item) => item.foodText).join(", ")}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  size="sm"
                  testID={`ai-food-draft-review-${index + 1}`}
                  isDisabled={actions.busy}
                  onPress={() => onReview(draft)}
                >
                  <Button.Label>{t`Review`}</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  testID={`ai-food-draft-discard-${index + 1}`}
                  isDisabled={actions.busy}
                  onPress={() => actions.discard.mutate({ draftId: draft.id })}
                >
                  <Button.Label>{t`Discard`}</Button.Label>
                </Button>
              </View>
            </DraftCard>
          );
        })}
        <AiAppDraftError error={actions.error} />
      </View>
    </Section>
  );
}

/**
 * Add food's "From app" tab: the items of one meal draft, each matched and
 * logged through the usual search, then "Mark draft done" (or discard).
 */
export function AiAppFoodDraftReview({
  draftId,
  isPending,
  draft,
  renderItems,
  actions,
  onClosed,
}: {
  draftId: string;
  isPending: boolean;
  draft: AiAppFoodDraft | null;
  renderItems: () => ReactNode;
  actions: AiAppDraftActions;
  onClosed: (outcome: "done" | "discarded") => void;
}) {
  const { t } = useLingui();
  const title = useFoodDraftTitle();
  if (!draft)
    return (
      <Text className="font-sans text-sm text-ink-3" testID="ai-food-draft-missing">
        {isPending ? t`Loading…` : t`This draft was already reviewed or discarded.`}
      </Text>
    );
  return (
    <View className="gap-3" testID="ai-food-draft-review">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="font-sans text-base font-semibold text-ink">{title(draft)}</Text>
        <ViaApp name={draft.appName} />
      </View>
      <Text className="font-sans text-sm text-ink-2">
        <Trans>
          Log each food in your meal diary, then mark the draft done. It stays here until you do.
        </Trans>
      </Text>
      {renderItems()}
      <View className="flex-row flex-wrap gap-2">
        <Button
          className="min-h-11"
          testID="ai-food-draft-done"
          isDisabled={actions.busy}
          onPress={() => actions.confirm.mutate({ draftId }, { onSuccess: () => onClosed("done") })}
        >
          <Button.Label>{t`Mark draft done`}</Button.Label>
        </Button>
        <Button
          className="min-h-11"
          variant="danger-soft"
          testID="ai-food-draft-discard"
          isDisabled={actions.busy}
          onPress={() =>
            actions.discard.mutate({ draftId }, { onSuccess: () => onClosed("discarded") })
          }
        >
          <Button.Label>{t`Discard draft`}</Button.Label>
        </Button>
      </View>
      <AiAppDraftError error={actions.error} />
    </View>
  );
}
