import type { LoggingStreakOutput } from "@openvalens/api/contracts/nutrition-targets";
import { presentLoggingStreak, STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { Card } from "heroui-native";
import { Text } from "react-native";

/**
 * The opt-in logging streak (Issue #90). Renders nothing unless the server
 * says the streak is on: hidden, off, offline, loading and errors all show
 * nothing. The copy is shared with the web app.
 */
export function LoggingStreakCard({ streak }: { streak: LoggingStreakOutput | undefined }) {
  const view = presentLoggingStreak(streak);
  if (!view) return null;
  return (
    <Card variant="secondary" className="gap-1 p-4" accessibilityLabel={STREAK_COPY.title}>
      <Text className="font-medium text-foreground">{view.headline}</Text>
      {view.lines.map((line) => (
        <Text key={line} className="text-sm text-muted-foreground">
          {line}
        </Text>
      ))}
    </Card>
  );
}
