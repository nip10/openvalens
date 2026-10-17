import type { CustomFood } from "@openvalens/api/contracts/nutrition-custom-foods";
import { AMOUNT_UNITS } from "@openvalens/api/contracts/nutrition-diary";
import {
  CUSTOM_FOOD_COPY,
  CUSTOM_FOOD_NUTRIENTS,
  EMPTY_CUSTOM_FOOD_FIELDS,
  describeBasis,
  describeCoverage,
  fieldsFromCustomFood,
  nutrientFieldLabel,
  parseCustomFood,
  type CustomFoodFields,
} from "@openvalens/api/presenters/custom-foods";
import {
  DIARY_COPY,
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  formatNutrientValue,
  newClientMutationId,
} from "@openvalens/api/presenters/nutrition-diary";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { AccessibilityInfo, Pressable, Switch, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";

/**
 * "My foods" (Issue #81): create, edit, archive and restore the member's
 * private custom foods, reached from the meal diary. Management is online
 * (logging stays offline-first through the diary outbox); a failed save keeps
 * the form and offers a retry with the same client mutation id, so a lost
 * response never saves a food twice. Edits never change logged meals.
 */

const inputClass =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-base text-foreground";

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-lg border px-3 ${selected ? "border-foreground bg-accent" : "border-border"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {children}
    </View>
  );
}

export default function FoodsScreen() {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CustomFood | "new" | null>(null);
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null);
  const queryClient = useQueryClient();
  const foods = useQuery(
    orpc.nutritionCustomFoods.list.queryOptions({ input: { includeArchived: showArchived } }),
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nutritionCustomFoods.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nutritionDiary.listFoods.key() }),
    ]);
  const archive = useMutation(orpc.nutritionCustomFoods.archive.mutationOptions());
  const restore = useMutation(orpc.nutritionCustomFoods.restore.mutationOptions());

  const setArchived = (food: CustomFood, archived: boolean) => {
    const send = () =>
      (archived ? archive : restore).mutate(
        { foodId: food.id },
        {
          onSuccess: () => {
            setError(null);
            announce(
              `${food.name}: ${archived ? CUSTOM_FOOD_COPY.archived : CUSTOM_FOOD_COPY.restored}`,
            );
            void refresh();
          },
          onError: () => {
            setError({ text: CUSTOM_FOOD_COPY.networkError, retry: send });
            announce(CUSTOM_FOOD_COPY.networkError);
          },
        },
      );
    send();
  };

  return (
    <Container>
      <View className="gap-5 p-4">
        <Text className="text-sm text-muted-foreground">{CUSTOM_FOOD_COPY.privacy}</Text>
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Link href="/nutrition" asChild>
            <Pressable accessibilityRole="link" className="min-h-11 justify-center">
              <Text className="text-sm text-foreground underline">
                Back to {DIARY_COPY.title.toLowerCase()}
              </Text>
            </Pressable>
          </Link>
          <Button size="sm" onPress={() => setEditing("new")} isDisabled={editing === "new"}>
            {CUSTOM_FOOD_COPY.create}
          </Button>
        </View>

        {error ? (
          <Card variant="secondary" className="flex-row items-center justify-between gap-2 p-3">
            <Text className="flex-1 text-sm text-foreground" accessibilityLiveRegion="polite">
              {error.text}
            </Text>
            <Button size="sm" variant="secondary" onPress={error.retry}>
              {CUSTOM_FOOD_COPY.retry}
            </Button>
          </Card>
        ) : null}

        {editing ? (
          <FoodForm
            key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
            food={editing === "new" ? null : editing}
            onDone={(message) => {
              setEditing(null);
              if (message) announce(message);
              void refresh();
            }}
          />
        ) : null}

        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-foreground">{CUSTOM_FOOD_COPY.showArchived}</Text>
          <Switch
            value={showArchived}
            onValueChange={setShowArchived}
            accessibilityLabel={CUSTOM_FOOD_COPY.showArchived}
          />
        </View>

        {foods.isPending ? (
          <Spinner />
        ) : foods.isError ? (
          <Pressable onPress={() => void foods.refetch()} accessibilityRole="button">
            <Text className="text-sm text-muted-foreground">
              {CUSTOM_FOOD_COPY.networkError} {CUSTOM_FOOD_COPY.retry}
            </Text>
          </Pressable>
        ) : foods.data.foods.length === 0 ? (
          <Text className="text-sm text-muted-foreground">{CUSTOM_FOOD_COPY.empty}</Text>
        ) : (
          foods.data.foods.map((food) => (
            <Card key={food.id} variant="secondary" className="gap-2 p-4">
              <Text className="font-medium text-foreground">
                {food.name}
                {food.brand ? ` · ${food.brand}` : ""}
                {food.archived ? ` · ${CUSTOM_FOOD_COPY.archivedBadge}` : ""}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {describeBasis(food.basis)} · {describeCoverage(food)} ·{" "}
                {CUSTOM_FOOD_COPY.provenance}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {SUMMARY_NUTRIENTS.map(
                  (key) =>
                    `${NUTRIENT_LABELS[key].label} ${formatNutrientValue(key, food.nutrientsPerBasis[key])}`,
                ).join(" · ")}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {food.archived ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => setArchived(food, false)}
                    accessibilityLabel={`${CUSTOM_FOOD_COPY.restore} ${food.name}`}
                  >
                    {CUSTOM_FOOD_COPY.restore}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => setEditing(food)}
                      accessibilityLabel={`${CUSTOM_FOOD_COPY.edit} ${food.name}`}
                    >
                      {CUSTOM_FOOD_COPY.edit}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => setArchived(food, true)}
                      accessibilityLabel={`${CUSTOM_FOOD_COPY.archive} ${food.name}`}
                    >
                      {CUSTOM_FOOD_COPY.archive}
                    </Button>
                  </>
                )}
              </View>
            </Card>
          ))
        )}
        <Text className="text-xs text-muted-foreground">{CUSTOM_FOOD_COPY.archiveNote}</Text>
      </View>
    </Container>
  );
}

function FoodForm({
  food,
  onDone,
}: {
  food: CustomFood | null;
  onDone: (message: string | null) => void;
}) {
  const [fields, setFields] = useState<CustomFoodFields>(() =>
    food ? fieldsFromCustomFood(food) : EMPTY_CUSTOM_FOOD_FIELDS,
  );
  const [conflict, setConflict] = useState<CustomFood | null>(null);
  const [failed, setFailed] = useState<(() => void) | null>(null);
  // One id per form: a retry after a lost response returns the food already saved.
  const [clientMutationId] = useState(newClientMutationId);
  const create = useMutation(orpc.nutritionCustomFoods.create.mutationOptions());
  const update = useMutation(orpc.nutritionCustomFoods.update.mutationOptions());
  const parsed = parseCustomFood(fields);
  const pending = create.isPending || update.isPending;
  const set = (patch: Partial<CustomFoodFields>) => setFields({ ...fields, ...patch });

  const onError = (retry: () => void) => {
    setFailed(() => retry);
    announce(CUSTOM_FOOD_COPY.networkError);
  };

  const save = (expectedRevision = food?.revision ?? 1) => {
    if (!parsed.ok) return;
    setFailed(null);
    if (!food) {
      const send = () =>
        create.mutate(
          { clientMutationId, food: parsed.food },
          {
            onSuccess: (result) => onDone(`${result.food.name}: ${CUSTOM_FOOD_COPY.saved}`),
            onError: () => onError(send),
          },
        );
      return send();
    }
    const send = () =>
      update.mutate(
        { foodId: food.id, expectedRevision, food: parsed.food },
        {
          onSuccess: (result) => {
            if (result.outcome === "conflict") {
              setConflict(result.server);
              announce(CUSTOM_FOOD_COPY.conflictTitle);
              return;
            }
            onDone(
              result.outcome === "unchanged"
                ? CUSTOM_FOOD_COPY.unchanged
                : `${result.food.name}: ${CUSTOM_FOOD_COPY.saved}`,
            );
          },
          onError: () => onError(send),
        },
      );
    send();
  };

  const textField = (
    label: string,
    key: "name" | "brand" | "basisAmount" | "servingLabel" | "servingSizeAmount" | "barcode",
    keyboardType: "default" | "decimal-pad" | "number-pad" = "default",
  ) => (
    <Field label={label}>
      <TextInput
        className={inputClass}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        value={fields[key]}
        onChangeText={(text) => set({ [key]: text })}
      />
    </Field>
  );

  return (
    <Card className="gap-3 p-4">
      <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
        {food ? `${CUSTOM_FOOD_COPY.edit} ${food.name}` : CUSTOM_FOOD_COPY.create}
      </Text>
      {food ? (
        <Text className="text-sm text-muted-foreground">{CUSTOM_FOOD_COPY.editNote}</Text>
      ) : null}
      {conflict ? (
        <Card variant="secondary" className="gap-2 p-3">
          <Text className="font-medium text-foreground" accessibilityLiveRegion="polite">
            {conflict.archived ? CUSTOM_FOOD_COPY.conflictArchived : CUSTOM_FOOD_COPY.conflictTitle}
          </Text>
          {conflict.archived ? null : (
            <Text className="text-sm text-foreground">
              Other version: {conflict.name} · {describeBasis(conflict.basis)} ·{" "}
              {describeCoverage(conflict)}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            {conflict.archived ? null : (
              <Button
                size="sm"
                onPress={() => {
                  setConflict(null);
                  save(conflict.revision);
                }}
              >
                {CUSTOM_FOOD_COPY.keepMine}
              </Button>
            )}
            <Button size="sm" variant="secondary" onPress={() => onDone(null)}>
              {CUSTOM_FOOD_COPY.keepServer}
            </Button>
          </View>
        </Card>
      ) : null}
      {textField("Food name", "name")}
      {textField("Brand (optional)", "brand")}
      {textField("Values per", "basisAmount", "decimal-pad")}
      <View className="flex-row flex-wrap gap-2" accessibilityLabel="Per unit">
        {AMOUNT_UNITS.map((unit) => (
          <Chip
            key={unit}
            label={`per ${unit}`}
            selected={fields.basisUnit === unit}
            onPress={() => set({ basisUnit: unit })}
          />
        ))}
      </View>
      {textField("Serving name (optional, e.g. 1 slice)", "servingLabel")}
      {textField("Serving size (optional)", "servingSizeAmount", "decimal-pad")}
      <View className="flex-row flex-wrap gap-2" accessibilityLabel="Serving unit">
        {(["g", "ml"] as const).map((unit) => (
          <Chip
            key={unit}
            label={unit}
            selected={fields.servingSizeUnit === unit}
            onPress={() => set({ servingSizeUnit: unit })}
          />
        ))}
      </View>
      {textField("Barcode (optional)", "barcode", "number-pad")}
      <Text className="text-sm font-medium text-foreground" accessibilityRole="header">
        Nutrients
      </Text>
      {CUSTOM_FOOD_NUTRIENTS.map((key) => (
        <Field key={key} label={nutrientFieldLabel(key)}>
          <TextInput
            className={inputClass}
            accessibilityLabel={nutrientFieldLabel(key)}
            keyboardType="decimal-pad"
            value={fields.nutrients[key] ?? ""}
            onChangeText={(text) => set({ nutrients: { ...fields.nutrients, [key]: text } })}
          />
        </Field>
      ))}
      <Text className="text-xs text-muted-foreground">{CUSTOM_FOOD_COPY.blankNote}</Text>
      {!parsed.ok && fields.name ? (
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {parsed.error}
        </Text>
      ) : null}
      {failed ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="flex-1 text-sm text-muted-foreground" accessibilityLiveRegion="polite">
            {CUSTOM_FOOD_COPY.networkError}
          </Text>
          <Button size="sm" variant="secondary" onPress={failed}>
            {CUSTOM_FOOD_COPY.retry}
          </Button>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={() => save()} isDisabled={!parsed.ok || pending}>
          {pending ? CUSTOM_FOOD_COPY.saving : CUSTOM_FOOD_COPY.save}
        </Button>
        <Button variant="secondary" onPress={() => onDone(null)}>
          {CUSTOM_FOOD_COPY.cancel}
        </Button>
      </View>
    </Card>
  );
}
