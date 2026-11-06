import { DIARY_COPY } from "@openvalens/api/presenters/nutrition-diary";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { CircleCheck, ListChecks, MoreHorizontal } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { Icon, Sheet } from "@/components/bloom";

/**
 * The diary day's ⋯ menu (#394): the day marker lives here now, with its
 * neutral explanation, so the top of the diary is the week and the totals.
 */
export function NutritionDayMenu({
  statusLabel,
  statusDescription,
  complete,
  onToggleComplete,
  onSelectFoods,
}: {
  statusLabel: string;
  statusDescription: string;
  complete: boolean;
  onToggleComplete: () => void;
  /** Starts selecting foods to copy, move or delete (#398); absent when the day is empty. */
  onSelectFoods?: () => void;
}) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <View className="items-end">
      <Button
        variant="ghost"
        isIconOnly
        className="min-h-11 min-w-11"
        accessibilityLabel={t`Day options`}
        accessibilityState={{ expanded: open }}
        testID="diary-day-menu"
        onPress={() => setOpen((value) => !value)}
      >
        <Icon icon={MoreHorizontal} size={20} color="ink-2" />
      </Button>
      {open ? (
        <Sheet className="absolute right-0 top-12 z-20 w-72 gap-2 border border-rule bg-sheet p-3 shadow-lg">
          <Text
            className="px-1 font-sans text-sm font-semibold text-ink"
            accessibilityLiveRegion="polite"
          >
            {statusLabel}
          </Text>
          <Text className="px-1 font-sans text-xs text-ink-3">{statusDescription}</Text>
          <Button
            variant="outline"
            className="min-h-11 justify-start"
            testID="diary-day-complete"
            onPress={() => {
              setOpen(false);
              onToggleComplete();
            }}
          >
            <Icon icon={CircleCheck} size={16} color="ink-2" />
            <Button.Label>
              {i18n._(complete ? DIARY_COPY.clearComplete : DIARY_COPY.markComplete)}
            </Button.Label>
          </Button>
          {onSelectFoods ? (
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              testID="diary-select-foods"
              onPress={() => {
                setOpen(false);
                onSelectFoods();
              }}
            >
              <Icon icon={ListChecks} size={16} color="ink-2" />
              <Button.Label>{t`Select foods`}</Button.Label>
            </Button>
          ) : null}
        </Sheet>
      ) : null}
    </View>
  );
}
