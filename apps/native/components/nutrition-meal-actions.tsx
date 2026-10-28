import { NUTRITION_MEAL_ACTIONS_COPY as COPY } from "@openvalens/api/presenters/nutrition-meal-actions";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { MoreHorizontal } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { NutritionDatePicker } from "@/components/nutrition-date-picker";
import { Icon, Sheet } from "@/components/bloom";

export type NutritionMealActionsProps = {
  mealLabel: string;
  localDate: string;
  disabled?: boolean;
  hasEntries: boolean;
  onCopyYesterday: () => void;
  onCopyToDate: (date: string) => void;
  onSaveAsMeal: () => void;
};

/** A quiet, meal-scoped overflow menu; actions stay outside the meal heading's primary controls. */
export function NutritionMealActions({
  mealLabel,
  localDate,
  disabled = false,
  hasEntries,
  onCopyYesterday,
  onCopyToDate,
  onSaveAsMeal,
}: NutritionMealActionsProps) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [choosingDate, setChoosingDate] = useState(false);
  const [date, setDate] = useState(localDate);

  const close = () => {
    setOpen(false);
    setChoosingDate(false);
  };
  const copyYesterday = () => {
    close();
    onCopyYesterday();
  };
  const saveMeal = () => {
    close();
    onSaveAsMeal();
  };
  const copyDate = () => {
    close();
    onCopyToDate(date);
  };

  return (
    <View className="items-end">
      <Button
        variant="ghost"
        isIconOnly
        className="min-h-11 min-w-11"
        accessibilityRole="button"
        accessibilityLabel={`${i18n._(COPY.open)}: ${mealLabel}`}
        isDisabled={disabled}
        onPress={() => {
          setDate(localDate);
          setChoosingDate(false);
          setOpen((value) => !value);
        }}
      >
        <Icon icon={MoreHorizontal} size={20} color="ink-2" />
      </Button>
      {open ? (
        <Sheet className="absolute right-0 top-12 z-20 w-64 gap-2 border border-rule bg-sheet p-3 shadow-lg">
          <Text className="px-1 font-display text-base font-semibold text-ink">{mealLabel}</Text>
          {!choosingDate ? (
            <>
              <Button
                variant="outline"
                className="min-h-11 justify-start"
                isDisabled={disabled}
                onPress={copyYesterday}
              >
                <Button.Label>{i18n._(COPY.copyYesterday)}</Button.Label>
              </Button>
              <Button
                variant="outline"
                className="min-h-11 justify-start"
                isDisabled={disabled || !hasEntries}
                onPress={() => setChoosingDate(true)}
              >
                <Button.Label>{i18n._(COPY.copyToDate)}</Button.Label>
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 justify-start"
                isDisabled={disabled || !hasEntries}
                onPress={saveMeal}
              >
                <Button.Label>{i18n._(COPY.saveAsMeal)}</Button.Label>
              </Button>
            </>
          ) : (
            <>
              <NutritionDatePicker
                value={date}
                onChange={setDate}
                label={i18n._(COPY.destination)}
              />
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" className="min-h-11" onPress={close}>
                  <Button.Label>{i18n._(COPY.cancel)}</Button.Label>
                </Button>
                <Button
                  className="min-h-11"
                  isDisabled={disabled || date === localDate}
                  onPress={copyDate}
                >
                  <Button.Label>{i18n._(COPY.confirmCopy)}</Button.Label>
                </Button>
              </View>
            </>
          )}
        </Sheet>
      ) : null}
    </View>
  );
}
