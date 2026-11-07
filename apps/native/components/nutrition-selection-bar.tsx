import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Button } from "heroui-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { NutritionDatePicker } from "@/components/nutrition-date-picker";

/**
 * The bar that replaces the search bar while foods are selected (#398):
 * copy to today, tomorrow or a date, move to a date, or delete. Every action
 * is a button, so nothing needs a gesture.
 */
export function NutritionSelectionBar({
  count,
  shownDate,
  today,
  tomorrow,
  onCopy,
  onMove,
  onDelete,
  onCancel,
}: {
  count: number;
  shownDate: string;
  today: string;
  tomorrow: string;
  onCopy: (date: string) => void;
  onMove: (date: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [picking, setPicking] = useState<"copy" | "move" | null>(null);
  const [date, setDate] = useState(shownDate);
  const none = count === 0;
  return (
    <View className="gap-2 border-t border-rule bg-background px-4 py-2" testID="selection-bar">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-sans text-sm font-semibold text-ink" accessibilityLiveRegion="polite">
          {t`${plural(count, { one: "# food selected", other: "# foods selected" })}`}
        </Text>
        <Button variant="ghost" size="sm" className="min-h-11" onPress={onCancel}>
          <Button.Label>{t`Done`}</Button.Label>
        </Button>
      </View>
      {picking ? (
        <View className="gap-2">
          <NutritionDatePicker
            value={date}
            onChange={setDate}
            label={picking === "copy" ? t`Copy to` : t`Move to`}
          />
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" className="min-h-11" onPress={() => setPicking(null)}>
              <Button.Label>{t`Cancel`}</Button.Label>
            </Button>
            <Button
              className="min-h-11"
              isDisabled={none || date === shownDate}
              onPress={() => {
                if (picking === "copy") onCopy(date);
                else onMove(date);
                setPicking(null);
              }}
            >
              <Button.Label>{picking === "copy" ? t`Copy` : t`Move`}</Button.Label>
            </Button>
          </View>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            isDisabled={none || shownDate === today}
            onPress={() => onCopy(today)}
          >
            <Button.Label>{t`To today`}</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            isDisabled={none || shownDate === tomorrow}
            onPress={() => onCopy(tomorrow)}
          >
            <Button.Label>{t`To tomorrow`}</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            isDisabled={none}
            onPress={() => {
              setDate(shownDate);
              setPicking("copy");
            }}
          >
            <Button.Label>{t`Copy to a date`}</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            isDisabled={none}
            onPress={() => {
              setDate(shownDate);
              setPicking("move");
            }}
          >
            <Button.Label>{t`Move to a date`}</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            isDisabled={none}
            onPress={onDelete}
          >
            <Button.Label>{t`Delete`}</Button.Label>
          </Button>
        </View>
      )}
    </View>
  );
}
