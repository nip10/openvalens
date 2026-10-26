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
import { localDateIn, newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import { formatNutrientValue } from "@openvalens/api/presenters/nutrition-diary";
import {
  formatNutrientSummaryLine,
  HIDDEN_VALUE,
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button } from "heroui-native";
import { Archive, ArchiveRestore, ArrowLeft, Bookmark, Pencil, Plus } from "lucide-react-native";
import { useState } from "react";
import { AccessibilityInfo, Pressable, Switch, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  Icon,
  InfoTip,
  ListCard,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
} from "@/components/bloom";
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
  "min-h-11 rounded-xl border border-rule bg-sheet px-3 font-sans text-base text-ink";

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
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? "border-food bg-food-soft" : "border-rule bg-sheet"}`}
    >
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="font-sans text-sm font-medium text-ink-3">{label}</Text>
      {children}
    </View>
  );
}

export default function FoodsScreen() {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CustomFood | "new" | null>(null);
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null);
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const foods = useQuery(
    orpc.nutritionCustomFoods.list.queryOptions({ input: { includeArchived: showArchived } }),
  );
  // Hide-numbers (#88): values stay hidden until this member's preference is known.
  const targets = useQuery(
    orpc.nutritionTargets.get.queryOptions({ input: { localDate: localDateIn(undefined) } }),
  );
  const hideNumbers = resolveHideNumbers(
    targets.isSuccess ? targets.data.settings.hideNumbers : undefined,
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
            const name = food.name;
            announce(
              archived
                ? t`${name}: Food archived. It no longer appears in search or quick logging.`
                : t`${name}: Food restored.`,
            );
            void refresh();
          },
          onError: () => {
            setError({ text: i18n._(CUSTOM_FOOD_COPY.networkError), retry: send });
            announce(i18n._(CUSTOM_FOOD_COPY.networkError));
          },
        },
      );
    send();
  };

  return (
    <Container>
      <Page>
        <PageHeader
          title={i18n._(CUSTOM_FOOD_COPY.title)}
          description={i18n._(CUSTOM_FOOD_COPY.privacy)}
          actions={
            <>
              <Link href="/nutrition" asChild>
                <Button variant="outline" size="sm" accessibilityRole="link">
                  <Icon icon={ArrowLeft} size={16} color="food" />
                  <Button.Label>
                    <Trans>Back to meal diary</Trans>
                  </Button.Label>
                </Button>
              </Link>
              <Button
                size="sm"
                variant={editing ? "secondary" : "primary"}
                onPress={() => setEditing("new")}
                isDisabled={editing === "new"}
              >
                <Icon icon={Plus} size={16} color={editing ? "ink-2" : "accent-foreground"} />
                <Button.Label>{i18n._(CUSTOM_FOOD_COPY.create)}</Button.Label>
              </Button>
            </>
          }
        />

        {error ? (
          <ErrorState
            title={error.text}
            action={
              <Button size="sm" variant="secondary" onPress={error.retry}>
                <Button.Label>{i18n._(CUSTOM_FOOD_COPY.retry)}</Button.Label>
              </Button>
            }
          />
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

        <Section
          icon={Bookmark}
          tone="food"
          title={<Trans>Saved foods</Trans>}
          info={
            <>
              <Prose>{i18n._(CUSTOM_FOOD_COPY.provenance)}</Prose>
              <Prose>{i18n._(CUSTOM_FOOD_COPY.archiveNote)}</Prose>
            </>
          }
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 font-sans text-sm text-ink-2">
              {i18n._(CUSTOM_FOOD_COPY.showArchived)}
            </Text>
            <Switch
              value={showArchived}
              onValueChange={setShowArchived}
              accessibilityLabel={i18n._(CUSTOM_FOOD_COPY.showArchived)}
            />
          </View>

          {foods.isPending ? (
            <Sheet>
              <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
            </Sheet>
          ) : foods.isError ? (
            <ErrorState
              title={i18n._(CUSTOM_FOOD_COPY.networkError)}
              action={
                <Button variant="outline" size="sm" onPress={() => void foods.refetch()}>
                  <Button.Label>{i18n._(CUSTOM_FOOD_COPY.retry)}</Button.Label>
                </Button>
              }
            />
          ) : foods.data.foods.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              tone="food"
              title={i18n._(CUSTOM_FOOD_COPY.empty)}
              action={
                <Button variant="outline" size="sm" onPress={() => setEditing("new")}>
                  <Button.Label>{i18n._(CUSTOM_FOOD_COPY.create)}</Button.Label>
                </Button>
              }
            />
          ) : (
            <View className="gap-3">
              {foods.data.foods.map((food) => (
                <ListCard
                  key={food.id}
                  icon={food.archived ? Archive : Bookmark}
                  tone="food"
                  title={food.name}
                  status={
                    food.archived
                      ? { label: i18n._(CUSTOM_FOOD_COPY.archivedBadge), tone: "neutral" }
                      : undefined
                  }
                  subtitle={`${food.brand ? `${food.brand} · ` : ""}${describeBasis(food.basis, i18n)}`}
                  chip={
                    hideNumbers
                      ? i18n._(HIDDEN_VALUE)
                      : formatNutrientValue("energyKcal", food.nutrientsPerBasis.energyKcal, i18n)
                  }
                >
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <View className="flex-row items-center gap-1">
                      <Text className="font-sans text-sm text-ink-3">
                        {i18n._(describeCoverage(food))}
                      </Text>
                      <InfoTip label={t`Nutrients`} title={food.name}>
                        <Prose>
                          {formatNutrientSummaryLine(food.nutrientsPerBasis, hideNumbers, i18n)}
                        </Prose>
                        <Prose className="text-ink-3">{i18n._(CUSTOM_FOOD_COPY.provenance)}</Prose>
                      </InfoTip>
                    </View>
                    <View className="flex-row flex-wrap gap-1">
                      {food.archived ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => setArchived(food, false)}
                          accessibilityLabel={t`Restore ${food.name}`}
                        >
                          <Icon icon={ArchiveRestore} size={16} color="ink-2" />
                          <Button.Label>{i18n._(CUSTOM_FOOD_COPY.restore)}</Button.Label>
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => setEditing(food)}
                            accessibilityLabel={t`Edit ${food.name}`}
                          >
                            <Icon icon={Pencil} size={16} color="ink-2" />
                            <Button.Label>{i18n._(CUSTOM_FOOD_COPY.edit)}</Button.Label>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => setArchived(food, true)}
                            accessibilityLabel={t`Archive ${food.name}`}
                          >
                            <Icon icon={Archive} size={16} color="ink-2" />
                            <Button.Label>{i18n._(CUSTOM_FOOD_COPY.archive)}</Button.Label>
                          </Button>
                        </>
                      )}
                    </View>
                  </View>
                </ListCard>
              ))}
            </View>
          )}
        </Section>
      </Page>
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
  const { t, i18n } = useLingui();
  const savedText = (name: string) => t`${name}: Food saved.`;
  const foodName = food?.name ?? "";

  const onError = (retry: () => void) => {
    setFailed(() => retry);
    announce(i18n._(CUSTOM_FOOD_COPY.networkError));
  };

  const save = (expectedRevision = food?.revision ?? 1) => {
    if (!parsed.ok) return;
    setFailed(null);
    if (!food) {
      const send = () =>
        create.mutate(
          { clientMutationId, food: parsed.food },
          {
            onSuccess: (result) => onDone(savedText(result.food.name)),
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
              announce(i18n._(CUSTOM_FOOD_COPY.conflictTitle));
              return;
            }
            onDone(
              result.outcome === "unchanged"
                ? i18n._(CUSTOM_FOOD_COPY.unchanged)
                : savedText(result.food.name),
            );
          },
          onError: () => onError(send),
        },
      );
    send();
  };

  const perUnit = (unit: (typeof AMOUNT_UNITS)[number]) =>
    unit === "serving" ? t`per serving` : t`per ${unit}`;

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
    <Section
      icon={food ? Pencil : Plus}
      tone="food"
      sheet
      title={food ? t`Edit ${foodName}` : i18n._(CUSTOM_FOOD_COPY.create)}
      info={food ? i18n._(CUSTOM_FOOD_COPY.editNote) : undefined}
    >
      {conflict ? (
        <View className="gap-2 rounded-2xl bg-warning/10 px-4 py-3">
          <Text
            className="font-display text-base font-medium text-ink"
            accessibilityLiveRegion="polite"
          >
            {i18n._(
              conflict.archived
                ? CUSTOM_FOOD_COPY.conflictArchived
                : CUSTOM_FOOD_COPY.conflictTitle,
            )}
          </Text>
          {conflict.archived ? null : (
            <Text className="font-sans text-sm text-ink-2">
              {t`Other version:`} {conflict.name} · {describeBasis(conflict.basis, i18n)} ·{" "}
              {i18n._(describeCoverage(conflict))}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            {conflict.archived ? null : (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  setConflict(null);
                  save(conflict.revision);
                }}
              >
                <Button.Label>{i18n._(CUSTOM_FOOD_COPY.keepMine)}</Button.Label>
              </Button>
            )}
            <Button size="sm" variant="outline" onPress={() => onDone(null)}>
              <Button.Label>{i18n._(CUSTOM_FOOD_COPY.keepServer)}</Button.Label>
            </Button>
          </View>
        </View>
      ) : null}
      {textField(t`Food name`, "name")}
      {textField(t`Brand (optional)`, "brand")}
      {textField(t`Values per`, "basisAmount", "decimal-pad")}
      <View className="flex-row flex-wrap gap-2" accessibilityLabel={t`Per unit`}>
        {AMOUNT_UNITS.map((unit) => (
          <Chip
            key={unit}
            label={perUnit(unit)}
            selected={fields.basisUnit === unit}
            onPress={() => set({ basisUnit: unit })}
          />
        ))}
      </View>
      {textField(t`Serving name (optional, e.g. 1 slice)`, "servingLabel")}
      {textField(t`Serving size (optional)`, "servingSizeAmount", "decimal-pad")}
      <View className="flex-row flex-wrap gap-2" accessibilityLabel={t`Serving unit`}>
        {(["g", "ml"] as const).map((unit) => (
          <Chip
            key={unit}
            label={unit}
            selected={fields.servingSizeUnit === unit}
            onPress={() => set({ servingSizeUnit: unit })}
          />
        ))}
      </View>
      {textField(t`Barcode (optional)`, "barcode", "number-pad")}
      <Text className="pt-2 font-display text-lg font-medium text-ink" accessibilityRole="header">
        <Trans>Nutrients</Trans>
      </Text>
      {CUSTOM_FOOD_NUTRIENTS.map((key) => (
        <Field key={key} label={i18n._(nutrientFieldLabel(key))}>
          <TextInput
            className={inputClass}
            accessibilityLabel={i18n._(nutrientFieldLabel(key))}
            keyboardType="decimal-pad"
            value={fields.nutrients[key] ?? ""}
            onChangeText={(text) => set({ nutrients: { ...fields.nutrients, [key]: text } })}
          />
        </Field>
      ))}
      <Text className="font-sans text-sm text-ink-3">{i18n._(CUSTOM_FOOD_COPY.blankNote)}</Text>
      {!parsed.ok && fields.name ? (
        <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
          {i18n._(parsed.error)}
        </Text>
      ) : null}
      {failed ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="flex-1 font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
            {i18n._(CUSTOM_FOOD_COPY.networkError)}
          </Text>
          <Button size="sm" variant="secondary" onPress={failed}>
            <Button.Label>{i18n._(CUSTOM_FOOD_COPY.retry)}</Button.Label>
          </Button>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={() => save()} isDisabled={!parsed.ok || pending}>
          <Button.Label>
            {i18n._(pending ? CUSTOM_FOOD_COPY.saving : CUSTOM_FOOD_COPY.save)}
          </Button.Label>
        </Button>
        <Button variant="ghost" onPress={() => onDone(null)}>
          <Button.Label>{i18n._(CUSTOM_FOOD_COPY.cancel)}</Button.Label>
        </Button>
      </View>
    </Section>
  );
}
