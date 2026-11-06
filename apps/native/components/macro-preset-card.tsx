import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import {
  MACRO_PRESETS,
  PRESET_COPY,
  PRESET_LABELS,
  type MacroPreset,
  energyTargetOf,
  formatGPerKg,
  presetTargets,
  proteinOptions,
} from "@openvalens/api/presenters/macro-presets";
import {
  MACRO_LETTERS,
  NUTRIENT_LABELS,
  ROW_MACRO_KEYS,
  deviceTimeZone,
  localDateIn,
  shiftLocalDate,
} from "@openvalens/api/presenters/nutrition-diary";
import { TARGET_COPY } from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, cn } from "heroui-native";
import { PieChart } from "lucide-react-native";
import { useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";

import { Section } from "@/components/bloom";
import { MACRO_TEXT } from "@/components/nutrition-macro-line";
import { orpc } from "@/utils/orpc";

function Choice({
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
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={cn(
        "min-h-11 justify-center rounded-full border px-4",
        selected ? "border-food bg-food-soft" : "border-rule bg-sheet",
      )}
    >
      <Text className={cn("font-sans text-sm", selected ? "font-semibold text-ink" : "text-ink-2")}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Diet-style presets with protein per kg (#399). A proposal the member
 * saves or leaves: it works out P/C/F targets from their own energy target
 * and recent weight, inside the server's protein reference (which already
 * applies the active opt-in, the 65+ minimum and the kidney cap).
 */
export function MacroPresetCard({
  targets,
  proteinReference,
  proteinCapped,
  onSaved,
}: {
  targets: readonly NutritionTargetWire[];
  proteinReference: { minGPerKg: number; maxGPerKg: number } | null;
  proteinCapped: boolean;
  onSaved: () => void;
}) {
  const { t, i18n } = useLingui();
  const today = localDateIn(deviceTimeZone());
  const [preset, setPreset] = useState<MacroPreset>("balanced");
  const options = proteinOptions(proteinReference);
  const [perKg, setPerKg] = useState<number | null>(null);
  const chosenPerKg = perKg !== null && options.includes(perKg) ? perKg : (options[0] ?? null);
  const trend = useQuery({
    ...orpc.body.weightTrend.queryOptions({
      input: { from: shiftLocalDate(today, -27), to: today },
    }),
    retry: false,
  });
  const weightKg =
    [...(trend.data?.points ?? [])].reverse().find((point) => point.trendKg !== null)?.trendKg ??
    null;
  const energy = energyTargetOf(targets.find((target) => target.nutrient === "energyKcal") ?? null);
  const result =
    chosenPerKg === null
      ? ({ ok: false, reason: "needs_weight" } as const)
      : presetTargets({ preset, energyKcal: energy, weightKg, proteinGPerKg: chosenPerKg });
  const setTarget = useMutation(orpc.nutritionTargets.setTarget.mutationOptions());
  const [status, setStatus] = useState("");

  const save = async () => {
    if (!result.ok) return;
    try {
      // Protein as a minimum, carbohydrate and fat as single values: each "entered by you".
      await setTarget.mutateAsync({
        nutrient: "proteinG",
        minAmount: result.proteinG,
        maxAmount: null,
        effectiveFrom: today,
      });
      await setTarget.mutateAsync({
        nutrient: "carbohydrateG",
        minAmount: result.carbohydrateG,
        maxAmount: result.carbohydrateG,
        effectiveFrom: today,
      });
      await setTarget.mutateAsync({
        nutrient: "fatG",
        minAmount: result.fatG,
        maxAmount: result.fatG,
        effectiveFrom: today,
      });
      const text = i18n._(PRESET_COPY.saved);
      setStatus(text);
      AccessibilityInfo.announceForAccessibility(text);
      onSaved();
    } catch {
      setStatus(i18n._(TARGET_COPY.networkError));
    }
  };

  const grams = result.ok
    ? { proteinG: result.proteinG, carbohydrateG: result.carbohydrateG, fatG: result.fatG }
    : null;
  const reason = result.ok
    ? null
    : result.reason === "needs_energy"
      ? PRESET_COPY.needsEnergy
      : result.reason === "needs_weight"
        ? PRESET_COPY.needsWeight
        : PRESET_COPY.doesNotFit;

  return (
    <Section
      icon={PieChart}
      tone="food"
      sheet
      title={i18n._(PRESET_COPY.title)}
      description={i18n._(PRESET_COPY.description)}
    >
      <View
        className="flex-row flex-wrap gap-2"
        accessibilityRole="radiogroup"
        testID="macro-presets"
      >
        {MACRO_PRESETS.map((key) => (
          <Choice
            key={key}
            label={i18n._(PRESET_LABELS[key])}
            selected={preset === key}
            onPress={() => setPreset(key)}
          />
        ))}
      </View>
      {options.length > 0 ? (
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-3">{i18n._(PRESET_COPY.proteinPerKg)}</Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {options.map((value) => (
              <Choice
                key={value}
                label={formatGPerKg(value, i18n)}
                selected={chosenPerKg === value}
                onPress={() => setPerKg(value)}
              />
            ))}
          </View>
          {proteinCapped ? (
            <Text className="font-sans text-xs text-ink-3">{i18n._(PRESET_COPY.kidneyCap)}</Text>
          ) : options.length === 1 ? (
            <Text className="font-sans text-xs text-ink-3">{i18n._(PRESET_COPY.activeHint)}</Text>
          ) : null}
        </View>
      ) : null}
      {grams ? (
        <View className="gap-1">
          {ROW_MACRO_KEYS.map((key) => (
            <View
              key={key}
              className="min-h-11 flex-row items-center justify-between border-t border-rule"
              accessible
              accessibilityLabel={`${i18n._(NUTRIENT_LABELS[key].label)}: ${grams[key]} g`}
            >
              <Text className={cn("font-sans text-sm font-semibold", MACRO_TEXT[key])}>
                {i18n._(MACRO_LETTERS[key])} · {i18n._(NUTRIENT_LABELS[key].label)}
              </Text>
              <Text
                className="font-sans text-base font-semibold text-ink"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {key === "proteinG" ? t`at least ${grams[key]} g` : `${grams[key]} g`}
              </Text>
            </View>
          ))}
        </View>
      ) : reason ? (
        <Text className="font-sans text-sm text-ink-2">{i18n._(reason)}</Text>
      ) : null}
      <Button
        className="self-start"
        variant="outline"
        testID="macro-presets-save"
        isDisabled={!grams || setTarget.isPending}
        onPress={() => void save()}
      >
        <Button.Label>{i18n._(PRESET_COPY.save)}</Button.Label>
      </Button>
      {status ? (
        <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
    </Section>
  );
}
