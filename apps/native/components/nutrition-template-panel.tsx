import type { MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import {
  NutritionTemplateManager,
  type TemplateFoodChoice,
} from "@/components/nutrition-template-manager";
import { NutritionRecipeImport } from "@/components/nutrition-recipe-import";
import { useDiaryOutbox, DIARY_CACHE_PREFIX } from "@/lib/nutrition/sync";
import { cachedTemplateLogInput } from "@/lib/nutrition/outbox";
import {
  useOfflineWriteSessionKey,
  useCacheFirst,
  isOfflineWriteTicketCurrent,
} from "@/lib/offline/sync";
import { writeCache } from "@/lib/offline/cache";
import { client, orpc, queryClient } from "@/utils/orpc";
import {
  candidateFromChoice,
  candidateFromResult,
  defaultFoodPortion,
  isSearchable,
} from "@openvalens/api/presenters/food-lookup";
import { newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import { TEMPLATE_PANEL_COPY } from "@openvalens/api/presenters/nutrition-template-panel";
import type { RecipeDraft } from "@openvalens/api/presenters/recipe-draft";

export type NutritionTemplatePanelProps = {
  localDate: string;
  timeZone: string;
  slot: MealSlot;
  hideNumbers: boolean;
  ownerKey?: string;
  seedIngredients?: readonly import("@openvalens/api/presenters/nutrition-templates").NutritionTemplateIngredientInput[];
  recipeImportEnabled: boolean;
  onLogged?: (handle: { id: string; action: string } | null) => void;
};

export function NutritionTemplatePanel(props: NutritionTemplatePanelProps) {
  const { i18n } = useLingui();
  const outbox = useDiaryOutbox();
  const sessionKey = useOfflineWriteSessionKey();
  const owner = `${props.ownerKey ?? outbox.scope ?? "signed-out"}:${sessionKey ?? "no-session"}:${props.localDate}:${props.timeZone}`;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const scopeRef = useRef(outbox.scope);
  scopeRef.current = outbox.scope;
  const sessionRef = useRef(sessionKey);
  sessionRef.current = sessionKey;
  const mountedRef = useRef(false);
  const foods = useCacheFirst(
    `${DIARY_CACHE_PREFIX}foods`,
    orpc.nutritionDiary.listFoods.queryOptions({ input: {} }),
  );
  const templates = useCacheFirst(
    `${DIARY_CACHE_PREFIX}templates`,
    orpc.nutritionTemplates.list.queryOptions({ input: {} }),
  );
  const [noticeState, setNoticeState] = useState<{ owner: string; text: string } | null>(null);
  const [undoState, setUndoState] = useState<{
    owner: string;
    refs: Array<{ kind: "pending"; mutationId: string; itemKey: string }>;
  } | null>(null);
  const [importedDraftState, setImportedDraftState] = useState<{
    owner: string;
    draft: RecipeDraft;
  } | null>(null);
  const generation = useRef(0);
  const choices: TemplateFoodChoice[] = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...(foods.data?.favorites ?? []),
      ...(foods.data?.recents ?? []),
      ...(foods.data?.customFoods ?? []),
    ].flatMap((choice) => {
      const candidate = candidateFromChoice(choice);
      if (seen.has(candidate.key)) return [];
      seen.add(candidate.key);
      const portion = defaultFoodPortion(candidate);
      return [
        {
          food: candidate.ref,
          name: candidate.name,
          basis: candidate.basis,
          nutrientsPerBasis: candidate.nutrientsPerBasis,
          defaultAmount: portion.amount,
          defaultUnit: portion.unit,
        },
      ];
    });
  }, [foods.data]);
  useEffect(() => {
    mountedRef.current = true;
    generation.current += 1;
    setNoticeState(null);
    setUndoState(null);
    setImportedDraftState(null);
    return () => {
      mountedRef.current = false;
      generation.current += 1;
    };
  }, [owner]);

  const isCurrentOwner = (
    expectedOwner: string,
    expectedScope: string | null = scopeRef.current,
    expectedSession: string | null = sessionKey,
  ) =>
    mountedRef.current &&
    ownerRef.current === expectedOwner &&
    !!expectedScope &&
    scopeRef.current === expectedScope &&
    !!expectedSession &&
    sessionRef.current === expectedSession;

  const refresh = async (expectedOwner: string, expectedScope: string | null) => {
    if (!isCurrentOwner(expectedOwner, expectedScope)) return;
    await queryClient.invalidateQueries({
      queryKey: orpc.nutritionTemplates.list.queryKey({ input: {} }),
    });
    if (!isCurrentOwner(expectedOwner, expectedScope)) return;
    const result = await client.nutritionTemplates.list({});
    if (expectedScope && isCurrentOwner(expectedOwner, expectedScope))
      writeCache(expectedScope, `${DIARY_CACHE_PREFIX}templates`, result);
  };
  const onLog = (
    template: Parameters<React.ComponentProps<typeof NutritionTemplateManager>["onLog"]>[0],
    servings?: number,
  ) => {
    const expectedOwner = owner;
    if (!isCurrentOwner(expectedOwner, outbox.scope, sessionKey)) return;
    if (template.kind === "recipe" && (!Number.isFinite(servings) || !servings || servings <= 0))
      return;
    const ticket = outbox.beginWrite();
    if (!ticket) return;
    const input = cachedTemplateLogInput(template, {
      clientMutationId: newClientMutationId(),
      localDate: props.localDate,
      timeZone: props.timeZone,
      slot: props.slot,
      ...(template.kind === "recipe" ? { servings } : {}),
    });
    const handle = outbox.enqueueForIntentWithHandle(ticket, input);
    if (!handle || !isCurrentOwner(expectedOwner, outbox.scope, sessionKey)) return;
    setUndoState({
      owner: expectedOwner,
      refs: (input.batchPreviews ?? []).map((child) => ({
        kind: "pending",
        mutationId: handle.id,
        itemKey: child.itemKey,
      })),
    });
    const message = i18n._(TEMPLATE_PANEL_COPY.logged);
    setNoticeState({ owner: expectedOwner, text: message });
    AccessibilityInfo.announceForAccessibility(message);
    props.onLogged?.(handle);
  };
  const onSearchFoods = async (query: string): Promise<TemplateFoodChoice[]> => {
    const needle = query.trim();
    const local = choices.filter((choice) =>
      choice.name.toLocaleLowerCase().includes(needle.toLocaleLowerCase()),
    );
    if (!outbox.online || !isSearchable(needle)) return local.slice(0, 8);
    const expectedOwner = owner;
    const expectedScope = outbox.scope;
    if (!isCurrentOwner(expectedOwner, expectedScope, sessionKey)) return [];
    const result = await client.nutritionFoods.search({ query: needle });
    if (!isCurrentOwner(expectedOwner, expectedScope, sessionKey)) return [];
    const saved = new Set(choices.map((choice) => JSON.stringify(choice.food)));
    const remote = (result.results ?? [])
      .map((item) => candidateFromResult(item, "search"))
      .filter((candidate) => candidate && !saved.has(JSON.stringify(candidate.ref)))
      .map((candidate) => {
        const portion = defaultFoodPortion(candidate!);
        return {
          food: candidate!.ref,
          name: candidate!.name,
          basis: candidate!.basis,
          nutrientsPerBasis: candidate!.nutrientsPerBasis,
          defaultAmount: portion.amount,
          defaultUnit: portion.unit,
        };
      });
    return [...local, ...remote].slice(0, 8);
  };
  const online = outbox.online;
  const canMutate = Boolean(outbox.scope && sessionKey);
  const cached = templates.data?.templates ?? [];
  const notice = noticeState?.owner === owner ? noticeState.text : "";
  const undoItems = undoState?.owner === owner ? undoState.refs : null;
  const importedRecipeDraft = importedDraftState?.owner === owner ? importedDraftState.draft : null;
  const undo = () => {
    if (!undoItems?.length || !isCurrentOwner(owner, outbox.scope, sessionKey)) return;
    const currentScope = outbox.scope;
    if (!currentScope) return;
    let allQueued = true;
    for (const ref of undoItems) {
      const ticket = outbox.beginWrite();
      if (
        !ticket ||
        !isOfflineWriteTicketCurrent(ticket, currentScope) ||
        !outbox.deleteEntry(ticket, ref, `undo-template-${Date.now()}-${ref.itemKey}`)
      ) {
        allQueued = false;
        break;
      }
    }
    if (!allQueued) return;
    setUndoState(null);
    const message = i18n._(TEMPLATE_PANEL_COPY.undoQueued);
    setNoticeState({ owner, text: message });
    AccessibilityInfo.announceForAccessibility(message);
  };
  return (
    <View className="gap-3">
      <NutritionRecipeImport
        enabled={props.recipeImportEnabled}
        online={online}
        canMutate={() => canMutate && isCurrentOwner(owner, outbox.scope, sessionKey)}
        hideNumbers={props.hideNumbers}
        onDraft={(draft) => {
          if (isCurrentOwner(owner, outbox.scope, sessionKey))
            setImportedDraftState({ owner, draft });
        }}
      />
      <NutritionTemplateManager
        key={owner}
        ownerKey={owner}
        templates={cached}
        networkAvailable={online}
        canMutate={canMutate}
        hideNumbers={props.hideNumbers}
        currentMealIngredients={props.seedIngredients}
        importedRecipeDraft={importedRecipeDraft}
        foodChoices={choices}
        onSearchFoods={onSearchFoods}
        onCreate={async (input) => {
          const scope = outbox.scope;
          if (!isCurrentOwner(owner, scope, sessionKey))
            throw new Error("Template owner is no longer current");
          const result = await client.nutritionTemplates.create(input);
          if (ownerRef.current === owner) await refresh(owner, scope);
          return result;
        }}
        onUpdate={async (input) => {
          const scope = outbox.scope;
          if (!isCurrentOwner(owner, scope, sessionKey))
            throw new Error("Template owner is no longer current");
          const result = await client.nutritionTemplates.update(input);
          if (ownerRef.current === owner) await refresh(owner, scope);
          return result;
        }}
        onArchive={async (input) => {
          const scope = outbox.scope;
          if (!isCurrentOwner(owner, scope, sessionKey))
            throw new Error("Template owner is no longer current");
          const result = await client.nutritionTemplates.archive(input);
          if (ownerRef.current === owner) await refresh(owner, scope);
          return result;
        }}
        onLog={onLog}
      />
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {undoItems?.length ? (
        <Button onPress={undo}>
          <Button.Label>{i18n._(TEMPLATE_PANEL_COPY.undo)}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
