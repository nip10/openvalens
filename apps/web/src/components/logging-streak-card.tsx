import type { LoggingStreakOutput } from "@openvalens/api/contracts/nutrition-targets";
import { presentLoggingStreak, STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { useLingui } from "@lingui/react/macro";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";

/**
 * The opt-in logging streak (Issue #90). Renders nothing unless the server
 * says the streak is on: hidden, off, loading and errors all show nothing.
 */
export function LoggingStreakCard({ streak }: { streak: LoggingStreakOutput | undefined }) {
  const { i18n } = useLingui();
  const view = presentLoggingStreak(streak);
  if (!view) return null;
  return (
    <Card aria-label={i18n._(STREAK_COPY.title)}>
      <CardHeader>
        <CardTitle className="text-base">{i18n._(view.headline)}</CardTitle>
      </CardHeader>
      {view.lines.length ? (
        <CardContent className="grid gap-1 text-sm text-muted-foreground">
          {view.lines
            .map((line) => i18n._(line))
            .map((line) => (
              <p key={line}>{line}</p>
            ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
