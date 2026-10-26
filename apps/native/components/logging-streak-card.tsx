import type { LoggingStreakOutput } from "@openvalens/api/contracts/nutrition-targets";
import { presentLoggingStreak, STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { useLingui } from "@lingui/react/macro";
import { Flame } from "lucide-react-native";
import { Text, View } from "react-native";

import { Sheet, ToneIcon } from "@/components/bloom";

/**
 * The opt-in logging streak (Issue #90). Renders nothing unless the server
 * says the streak is on: hidden, off, offline, loading and errors all show
 * nothing. The copy is shared with the web app.
 */
export function LoggingStreakCard({ streak }: { streak: LoggingStreakOutput | undefined }) {
  const { i18n } = useLingui();
  const view = presentLoggingStreak(streak);
  if (!view) return null;
  return (
    <Sheet className="flex-row items-center gap-4" accessibilityLabel={i18n._(STREAK_COPY.title)}>
      <ToneIcon icon={Flame} tone="food" size="lg" />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-display text-lg font-medium leading-snug text-ink">
          {i18n._(view.headline)}
        </Text>
        {view.lines
          .map((line) => i18n._(line))
          .map((line) => (
            <Text key={line} className="font-sans text-sm text-ink-3">
              {line}
            </Text>
          ))}
      </View>
    </Sheet>
  );
}
