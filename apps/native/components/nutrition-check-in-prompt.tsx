import type { TargetSettingsWire } from "@openvalens/api/contracts/nutrition-targets";
import { CHECK_IN_COPY, checkInState } from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { Button } from "heroui-native";
import { CalendarCheck } from "lucide-react-native";
import { Text, View } from "react-native";

import { Sheet, ToneIcon } from "@/components/bloom";
import { friendlyDate } from "@/utils/friendly";

/**
 * A quiet card on the Food tab when the weekly check-in is open (#397), or
 * can be opened early. Never a reminder to eat less or more: it only opens
 * the proposal for the member to accept or keep.
 */
export function NutritionCheckInPrompt({
  settings,
  today,
  suggestionsOff,
}: {
  settings: TargetSettingsWire | undefined;
  today: string;
  suggestionsOff: boolean;
}) {
  const { t, i18n } = useLingui();
  const router = useRouter();
  if (!settings || suggestionsOff) return null;
  const state = checkInState({
    checkInDay: settings.checkInDay,
    today,
    lastCheckInOn: settings.lastCheckInOn,
  });
  if (state.state !== "due" && state.state !== "early") return null;
  const date = friendlyDate(i18n, state.checkInDate);
  return (
    <Sheet className="flex-row items-center gap-3 px-4 py-3" testID="check-in-prompt">
      <ToneIcon icon={CalendarCheck} tone="food" size="sm" />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans text-sm font-semibold text-ink">
          {i18n._(CHECK_IN_COPY.ready)}
        </Text>
        <Text className="font-sans text-xs text-ink-3">
          {state.state === "early" ? t`Check-in day: ${date}. You can do it now.` : date}
        </Text>
      </View>
      <Button size="sm" className="min-h-11" onPress={() => router.push("/check-in")}>
        <Button.Label>{i18n._(CHECK_IN_COPY.open)}</Button.Label>
      </Button>
    </Sheet>
  );
}
