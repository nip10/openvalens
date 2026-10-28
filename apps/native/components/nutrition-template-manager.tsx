import type {
  AmountUnit,
  FoodRef,
  NutrientValues,
} from "@openvalens/api/contracts/nutrition-diary";
import {
  NUTRITION_TEMPLATES_COPY as COPY,
  templateIngredientCoverage,
  templateAmountValue,
  type NutritionTemplate,
  type NutritionTemplateContent,
  type NutritionTemplateIngredientInput,
  type TemplateMutationOutcome,
} from "@openvalens/api/presenters/nutrition-templates";
import type { RecipeDraft } from "@openvalens/api/presenters/recipe-draft";
import { UNIT_LABELS, unitsFor } from "@openvalens/api/presenters/nutrition-diary";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

export type TemplateFoodChoice = {
  food: FoodRef;
  name: string;
  basis?: import("@openvalens/api/contracts/nutrition-diary").FoodChoice["basis"];
  nutrientsPerBasis?: NutrientValues;
  defaultAmount?: number;
  defaultUnit?: AmountUnit;
};
type DraftIngredient = {
  key: string;
  food: FoodRef | null;
  foodName: string;
  amount: number | null;
  unit: AmountUnit;
};
type SaveArgs = { clientMutationId: string; content: NutritionTemplateContent };
type UpdateArgs = SaveArgs & {
  templateId: NutritionTemplate["id"];
  expectedRevision: NutritionTemplate["revision"];
};
type ArchiveArgs = {
  clientMutationId: string;
  templateId: NutritionTemplate["id"];
  expectedRevision: NutritionTemplate["revision"];
};
export interface NutritionTemplateManagerProps {
  /** Feed from tenant-fenced cache (`${DIARY_CACHE_PREFIX}templates`) or API list result. */
  templates: readonly NutritionTemplate[];
  /** Cache/session owner key; changing it clears all transient editor and result state. */
  ownerKey: string;
  networkAvailable: boolean;
  canMutate: boolean;
  hideNumbers?: boolean;
  currentMealIngredients?: readonly (NutritionTemplateIngredientInput & { name?: string })[];
  /** Existing recipe import editor can pass its reviewed draft here; every line is rematched below. */
  importedRecipeDraft?: RecipeDraft | null;
  foodChoices?: readonly TemplateFoodChoice[];
  onSearchFoods?: (query: string) => Promise<TemplateFoodChoice[]>;
  onCreate: (args: SaveArgs) => Promise<TemplateMutationOutcome>;
  onUpdate: (args: UpdateArgs) => Promise<TemplateMutationOutcome>;
  onArchive: (args: ArchiveArgs) => Promise<TemplateMutationOutcome>;
  onUndoArchive?: (template: NutritionTemplate) => Promise<void>;
  /** Parent performs the actual offline-capable logTemplate outbox enqueue. */
  onLog: (template: NutritionTemplate, servings?: number) => void;
}

let localMutationSequence = 0;
const mutationId = () => `template-${Date.now()}-${++localMutationSequence}`;
const blankIngredient = (key: string): DraftIngredient => ({
  key,
  food: null,
  foodName: "",
  amount: null,
  unit: "serving",
});

/** Private template browser/editor. CRUD is network-required; logging delegates to the parent's offline outbox. */
export function NutritionTemplateManager(props: NutritionTemplateManagerProps) {
  const { i18n } = useLingui();
  const [kindFilter, setKindFilter] = useState<"meal" | "recipe">("meal");
  const [editing, setEditing] = useState<NutritionTemplate | null>(null);
  const [creating, setCreating] = useState<"meal" | "recipe" | null>(null);
  const [name, setName] = useState("");
  const [yieldText, setYieldText] = useState("");
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TemplateFoodChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<NutritionTemplate | null>(null);
  const [undoTemplate, setUndoTemplate] = useState<NutritionTemplate | null>(null);
  const [servings, setServings] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const pendingMutation = useRef<{ key: string; id: string } | null>(null);
  const ownerRef = useRef(props.ownerKey);
  ownerRef.current = props.ownerKey;
  useEffect(() => {
    generation.current += 1;
    setEditing(null);
    setCreating(null);
    setIngredients([]);
    setName("");
    setYieldText("");
    setSearch("");
    setSearchResults([]);
    setNotice(null);
    setConflict(null);
    setUndoTemplate(null);
    setBusy(false);
    setServings({});
  }, [props.ownerKey]);
  useEffect(() => {
    if (!props.importedRecipeDraft) return;
    setCreating("recipe");
    setEditing(null);
    setName(props.importedRecipeDraft.title ?? "");
    setYieldText(props.importedRecipeDraft.servingsText ?? "");
    setIngredients(
      props.importedRecipeDraft.ingredients.map((item) => ({
        ...blankIngredient(`import-${item.id}`),
        foodName: item.foodText ?? item.rawText,
        unit: "serving",
        amount:
          item.quantityText && Number.isFinite(Number(item.quantityText))
            ? Number(item.quantityText)
            : 1,
      })),
    );
    setNotice(i18n._(COPY.matchImported));
    // Import is an explicit reviewed-draft handoff. Do not overwrite an active edit on parent rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.importedRecipeDraft?.id]);

  const startCreate = (kind: "meal" | "recipe") => {
    if (!props.canMutate || !props.networkAvailable) return;
    generation.current += 1;
    setEditing(null);
    setCreating(kind);
    setConflict(null);
    setNotice(null);
    setName("");
    setYieldText("1");
    const seeds = kind === "meal" ? (props.currentMealIngredients ?? []) : [];
    setIngredients(
      seeds.map((item, index) => ({
        key: `seed-${index}-${generation.current}`,
        food: item.food,
        foodName: item.name ?? "",
        amount: item.amount,
        unit: item.unit,
      })),
    );
  };
  const startEdit = (template: NutritionTemplate) => {
    if (!props.canMutate || !props.networkAvailable) return;
    generation.current += 1;
    setEditing(template);
    setCreating(null);
    setConflict(null);
    setNotice(null);
    setName(template.name);
    setYieldText(template.yieldServings?.toString() ?? "");
    setIngredients(
      template.ingredients.map((item, index) => ({
        key: `${template.id}-${index}`,
        food: { kind: "snapshot", snapshotId: item.food.snapshotId },
        foodName: item.food.name,
        amount: item.amount,
        unit: item.unit,
      })),
    );
  };
  const addIngredient = () =>
    setIngredients((items) => [
      ...items,
      blankIngredient(`new-${generation.current}-${items.length}`),
    ]);
  const updateIngredient = (key: string, patch: Partial<DraftIngredient>) =>
    setIngredients((items) =>
      items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  const findFoods = async (query: string) => {
    setSearch(query);
    if (!props.onSearchFoods || !query.trim()) {
      setSearchResults([...(props.foodChoices ?? [])]);
      return;
    }
    const generationAtRequest = generation.current;
    const owner = ownerRef.current;
    try {
      const found = await props.onSearchFoods(query);
      if (ownerRef.current === owner && generation.current === generationAtRequest)
        setSearchResults([...found]);
    } catch {
      if (ownerRef.current === owner && generation.current === generationAtRequest)
        setSearchResults([]);
    }
  };
  const convertContent = (): NutritionTemplateContent | null => {
    if (
      !name.trim() ||
      ingredients.length === 0 ||
      ingredients.some((item) => !item.food || !item.amount || item.amount <= 0)
    )
      return null;
    const contentIngredients = ingredients.map((item) => ({
      food: item.food!,
      amount: item.amount!,
      unit: item.unit,
    }));
    if ((editing?.kind ?? creating) === "recipe") {
      const yieldServings = Number(yieldText);
      if (!Number.isFinite(yieldServings) || yieldServings <= 0) return null;
      return { kind: "recipe", name: name.trim(), yieldServings, ingredients: contentIngredients };
    }
    return { kind: "meal", name: name.trim(), ingredients: contentIngredients };
  };
  const save = async () => {
    if (!props.canMutate || !props.networkAvailable || busy) return;
    const content = convertContent();
    if (!content) {
      setNotice(
        i18n._(
          (editing?.kind ?? creating) === "recipe" && Number(yieldText) <= 0
            ? COPY.badYield
            : COPY.invalidTemplate,
        ),
      );
      return;
    }
    const id = ++generation.current;
    const owner = ownerRef.current;
    const retryKey = JSON.stringify([editing?.id ?? null, content]);
    if (!pendingMutation.current || pendingMutation.current.key !== retryKey)
      pendingMutation.current = { key: retryKey, id: mutationId() };
    const clientMutationId = pendingMutation.current.id;
    setBusy(true);
    setNotice(null);
    setConflict(null);
    try {
      const result = editing
        ? await props.onUpdate({
            clientMutationId,
            templateId: editing.id,
            expectedRevision: editing.revision,
            content,
          })
        : await props.onCreate({ clientMutationId, content });
      if (ownerRef.current !== owner || generation.current !== id) return;
      pendingMutation.current = null;
      if (result.outcome === "conflict") {
        setConflict(result.server);
        setNotice(i18n._(COPY.conflict));
      } else {
        setEditing(null);
        setCreating(null);
        setNotice(i18n._(COPY.saved));
      }
    } catch {
      if (ownerRef.current === owner && generation.current === id)
        setNotice(i18n._(COPY.saveFailed));
    } finally {
      if (ownerRef.current === owner && generation.current === id) setBusy(false);
    }
  };
  const archive = async (template: NutritionTemplate) => {
    if (!props.canMutate || !props.networkAvailable || busy) return;
    const id = ++generation.current;
    const owner = ownerRef.current;
    setBusy(true);
    try {
      const outcome = await props.onArchive({
        clientMutationId: mutationId(),
        templateId: template.id,
        expectedRevision: template.revision,
      });
      if (ownerRef.current !== owner || generation.current !== id) return;
      if (outcome.outcome === "conflict") {
        setConflict(outcome.server);
        setNotice(i18n._(COPY.conflict));
      } else {
        setUndoTemplate(props.onUndoArchive ? outcome.template : null);
        setNotice(i18n._(COPY.archived));
      }
    } catch {
      if (ownerRef.current === owner && generation.current === id)
        setNotice(i18n._(COPY.saveFailed));
    } finally {
      if (ownerRef.current === owner && generation.current === id) setBusy(false);
    }
  };

  const active = props.templates.filter((item) => !item.archived && item.kind === kindFilter);
  const formKind = editing?.kind ?? creating;
  const editable = Boolean(formKind);
  const coverageText = (template: NutritionTemplate) => {
    const coverage = templateIngredientCoverage(template.ingredients);
    return i18n._(COPY.ingredientsCoverage.id, coverage);
  };
  const hidden = props.hideNumbers ?? false;
  const ingredientUnits = (item: DraftIngredient): AmountUnit[] => {
    if (!item.food) return ["g", "ml", "serving"];
    const choice = props.foodChoices?.find(
      (candidate) => JSON.stringify(candidate.food) === JSON.stringify(item.food),
    );
    return choice?.basis ? unitsFor(choice.basis) : [item.unit];
  };

  return (
    <View className="gap-3">
      <Text className="font-display text-lg font-medium text-ink">{i18n._(COPY.title)}</Text>
      {!props.networkAvailable ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-ink-2">
          {i18n._(COPY.networkRequired)}
        </Text>
      ) : null}
      {undoTemplate && props.onUndoArchive ? (
        <Button
          isDisabled={!props.networkAvailable || !props.canMutate}
          onPress={async () => {
            if (!props.networkAvailable || !props.canMutate || !props.onUndoArchive) return;
            const owner = ownerRef.current;
            const id = ++generation.current;
            try {
              await props.onUndoArchive(undoTemplate);
              if (ownerRef.current === owner && generation.current === id) {
                setUndoTemplate(null);
                setNotice(i18n._(COPY.saved));
              }
            } catch {
              if (ownerRef.current === owner && generation.current === id)
                setNotice(i18n._(COPY.saveFailed));
            }
          }}
        >
          <Button.Label>{i18n._(COPY.undo)}</Button.Label>
        </Button>
      ) : null}
      <View className="min-h-11 flex-row gap-2">
        <Button
          variant={kindFilter === "meal" ? "secondary" : "outline"}
          onPress={() => setKindFilter("meal")}
        >
          <Button.Label>{i18n._(COPY.meals)}</Button.Label>
        </Button>
        <Button
          variant={kindFilter === "recipe" ? "secondary" : "outline"}
          onPress={() => setKindFilter("recipe")}
        >
          <Button.Label>{i18n._(COPY.recipes)}</Button.Label>
        </Button>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button
          isDisabled={!props.canMutate || !props.networkAvailable}
          onPress={() => startCreate("meal")}
        >
          <Button.Label>{i18n._(COPY.createMeal)}</Button.Label>
        </Button>
        <Button
          isDisabled={!props.canMutate || !props.networkAvailable}
          onPress={() => startCreate("recipe")}
        >
          <Button.Label>{i18n._(COPY.createRecipe)}</Button.Label>
        </Button>
      </View>
      {active.length === 0 ? (
        <Text className="text-sm text-ink-3">{i18n._(COPY.empty)}</Text>
      ) : (
        active.map((template) => {
          const recipeServings = servings[template.id] ?? "1";
          const scale =
            template.kind === "recipe" &&
            Number.isFinite(Number(recipeServings)) &&
            template.yieldServings
              ? Number(recipeServings) / template.yieldServings
              : 1;
          return (
            <View
              key={`${template.id}:${template.revision}`}
              className="gap-2 rounded-2xl border border-rule bg-sheet p-4"
            >
              <Text className="font-display text-base font-medium text-ink">{template.name}</Text>
              <Text className="text-sm text-ink-2">{coverageText(template)}</Text>
              {template.ingredients.map((ingredient, index) => (
                <Text key={`${template.id}-nutrients-${index}`} className="text-xs text-ink-3">
                  {i18n._(COPY.ingredientNutrients.id, {
                    name: ingredient.food.name,
                    energy:
                      typeof ingredient.nutrients.energyKcal === "number"
                        ? `${ingredient.nutrients.energyKcal * scale} kcal`
                        : i18n._(COPY.unknown),
                    protein:
                      typeof ingredient.nutrients.proteinG === "number"
                        ? `${ingredient.nutrients.proteinG * scale} g`
                        : i18n._(COPY.unknown),
                  })}
                </Text>
              ))}
              {template.kind === "recipe" ? (
                <View className="min-h-11 flex-row items-center gap-2">
                  <Text>{i18n._(COPY.servings)}</Text>
                  <TextInput
                    value={templateAmountValue(Number(recipeServings), hidden)}
                    editable={!hidden}
                    onChangeText={(value) =>
                      setServings((current) => ({ ...current, [template.id]: value }))
                    }
                    keyboardType="decimal-pad"
                    accessibilityLabel={i18n._(COPY.servings)}
                    className="min-h-11 min-w-20 rounded-xl border border-rule px-3 text-ink"
                  />
                </View>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                <Button
                  isDisabled={
                    !props.canMutate ||
                    (template.kind === "recipe" &&
                      (!Number.isFinite(Number(recipeServings)) || Number(recipeServings) <= 0))
                  }
                  onPress={() =>
                    props.onLog(
                      template,
                      template.kind === "recipe" ? Number(recipeServings) : undefined,
                    )
                  }
                >
                  <Button.Label>{i18n._(COPY.log)}</Button.Label>
                </Button>
                <Button
                  variant="outline"
                  isDisabled={!props.canMutate || !props.networkAvailable}
                  onPress={() => startEdit(template)}
                >
                  <Button.Label>{i18n._(COPY.edit)}</Button.Label>
                </Button>
                <Button
                  variant="ghost"
                  isDisabled={!props.canMutate || !props.networkAvailable || busy}
                  onPress={() => void archive(template)}
                >
                  <Button.Label>{i18n._(COPY.archive)}</Button.Label>
                </Button>
              </View>
            </View>
          );
        })
      )}
      {editable ? (
        <ScrollView
          className="max-h-[70%] rounded-2xl border border-rule bg-sheet p-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-3">
            <TextInput
              value={name}
              onChangeText={setName}
              accessibilityLabel={i18n._(COPY.name)}
              placeholder={i18n._(COPY.name)}
              className="min-h-11 rounded-xl border border-rule px-3 text-ink"
            />
            {formKind === "recipe" ? (
              <TextInput
                value={templateAmountValue(Number(yieldText), hidden)}
                editable={!hidden}
                onChangeText={setYieldText}
                keyboardType="decimal-pad"
                accessibilityLabel={i18n._(COPY.yield)}
                className="min-h-11 rounded-xl border border-rule px-3 text-ink"
              />
            ) : null}
            {ingredients.map((item, index) => (
              <View key={item.key} className="gap-2 rounded-xl bg-paper-2 p-3">
                <Text>
                  {i18n._(COPY.ingredient)} {index + 1}
                </Text>
                {item.food ? (
                  <Text className="min-h-11 py-2 text-ink">
                    {item.foodName || i18n._(COPY.chooseFood)}
                  </Text>
                ) : (
                  <>
                    <TextInput
                      value={item.foodName}
                      onChangeText={(value) => {
                        updateIngredient(item.key, { foodName: value });
                        void findFoods(value);
                      }}
                      accessibilityLabel={i18n._(COPY.searchFood)}
                      placeholder={i18n._(COPY.searchFood)}
                      className="min-h-11 rounded-xl border border-rule px-3 text-ink"
                    />
                    {(searchResults.length ? searchResults : (props.foodChoices ?? []))
                      .slice(0, 8)
                      .map((choice, choiceIndex) => (
                        <Button
                          key={`${item.key}-${choiceIndex}`}
                          variant="outline"
                          onPress={() => {
                            const unit =
                              choice.defaultUnit ??
                              (choice.basis ? (unitsFor(choice.basis)[0] ?? "serving") : "serving");
                            updateIngredient(item.key, {
                              food: choice.food,
                              foodName: choice.name,
                              unit,
                              amount: choice.defaultAmount ?? 1,
                            });
                          }}
                        >
                          <Button.Label>{choice.name}</Button.Label>
                        </Button>
                      ))}
                  </>
                )}
                <View className="flex-row flex-wrap gap-2">
                  <TextInput
                    value={templateAmountValue(item.amount, hidden)}
                    onChangeText={(value) =>
                      updateIngredient(item.key, { amount: value === "" ? null : Number(value) })
                    }
                    editable={!hidden}
                    keyboardType="decimal-pad"
                    accessibilityLabel={i18n._(hidden ? COPY.amountHidden : COPY.amount)}
                    className="min-h-11 flex-1 rounded-xl border border-rule px-3 text-ink"
                  />
                  {ingredientUnits(item).map((unit) => (
                    <Button
                      key={unit}
                      variant={item.unit === unit ? "secondary" : "outline"}
                      onPress={() => updateIngredient(item.key, { unit })}
                    >
                      <Button.Label>{i18n._(UNIT_LABELS[unit])}</Button.Label>
                    </Button>
                  ))}
                </View>
                <Button
                  variant="ghost"
                  onPress={() =>
                    setIngredients((current) => current.filter((entry) => entry.key !== item.key))
                  }
                >
                  <Button.Label>{i18n._(COPY.remove)}</Button.Label>
                </Button>
              </View>
            ))}
            <Button variant="outline" onPress={addIngredient}>
              <Button.Label>{i18n._(COPY.addIngredient)}</Button.Label>
            </Button>
            {conflict ? (
              <View className="gap-2 rounded-xl border border-rule p-3">
                <Text accessibilityLiveRegion="polite">{i18n._(COPY.conflict)}</Text>
                <Text>
                  {conflict.name} · {coverageText(conflict)}
                </Text>
                <Button variant="outline" onPress={() => startEdit(conflict)}>
                  <Button.Label>{i18n._(COPY.edit)}</Button.Label>
                </Button>
              </View>
            ) : null}
            {notice ? (
              <Text accessibilityLiveRegion="polite" className="text-sm text-ink-2">
                {notice}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                isDisabled={busy || !props.canMutate || !props.networkAvailable}
                onPress={() => void save()}
              >
                <Button.Label>{i18n._(COPY.save)}</Button.Label>
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  generation.current += 1;
                  setEditing(null);
                  setCreating(null);
                }}
              >
                <Button.Label>{i18n._(COPY.cancel)}</Button.Label>
              </Button>
            </View>
          </View>
        </ScrollView>
      ) : null}
      {!editable && notice ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-ink-2">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
