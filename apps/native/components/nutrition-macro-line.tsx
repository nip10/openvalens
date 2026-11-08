import {
  MACRO_LETTERS,
  ROW_MACRO_KEYS,
  compactNutrientFigure,
  type RowMacroKey,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  HIDDEN_VALUE,
  formatNutrientSummaryLine,
} from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { cn } from "heroui-native";
import { Text } from "react-native";

export type MacroValues = {
  energyKcal: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
};

/**
 * Nutrient identity colours (#393): protein, carbs and fat each keep one
 * colour beside their letter, energy stays in ink. Identity only: never a
 * verdict, never progress against a target.
 */
export const MACRO_TEXT: Readonly<Record<RowMacroKey, string>> = Object.freeze({
  proteinG: "text-protein",
  carbohydrateG: "text-carbs",
  fatG: "text-fat",
});

/**
 * `200 kcal · P 10 · C 30 · F 5` on one line, read out in full. In
 * hide-numbers mode only "Hidden".
 */
export function MacroLine({
  values,
  hideNumbers,
  className,
  emphasis = true,
}: {
  values: MacroValues;
  hideNumbers: boolean;
  className?: string;
  /** Energy in semibold ink (rows); off for quieter subtotals. */
  emphasis?: boolean;
}) {
  const { i18n } = useLingui();
  if (hideNumbers)
    return (
      <Text className={cn("font-sans text-sm text-ink-3", className)}>{i18n._(HIDDEN_VALUE)}</Text>
    );
  const spoken = formatNutrientSummaryLine(
    {
      energyKcal: values.energyKcal,
      proteinG: values.proteinG,
      carbohydrateG: values.carbohydrateG,
      fatG: values.fatG,
    },
    false,
    i18n,
  );
  return (
    <Text
      accessibilityLabel={spoken}
      className={cn("font-sans text-sm text-ink-2", className)}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      <Text className={cn("text-ink", emphasis && "font-semibold")}>
        {compactNutrientFigure("energyKcal", values.energyKcal, i18n.locale)}
      </Text>
      {ROW_MACRO_KEYS.map((key) => (
        <Text key={key}>
          {" · "}
          <Text className={cn("font-semibold", MACRO_TEXT[key])}>
            {i18n._(MACRO_LETTERS[key])}
          </Text>{" "}
          {compactNutrientFigure(key, values[key], i18n.locale)}
        </Text>
      ))}
    </Text>
  );
}
