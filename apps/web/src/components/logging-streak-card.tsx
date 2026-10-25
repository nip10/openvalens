import type { LoggingStreakOutput } from "@openvalens/api/contracts/nutrition-targets";
import { presentLoggingStreak, STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { useLingui } from "@lingui/react/macro";

/**
 * The opt-in logging streak (Issue #90). Renders nothing unless the server
 * says the streak is on: hidden, off, loading and errors all show nothing.
 */
export function LoggingStreakCard({ streak }: { streak: LoggingStreakOutput | undefined }) {
  const { i18n } = useLingui();
  const view = presentLoggingStreak(streak);
  if (!view) return null;
  return (
    <section aria-label={i18n._(STREAK_COPY.title)} className="well grid gap-1 px-4 py-3">
      <p className="font-display text-base font-medium text-ink">{i18n._(view.headline)}</p>
      {view.lines.length
        ? view.lines
            .map((line) => i18n._(line))
            .map((line) => (
              <p key={line} className="text-sm text-ink-3">
                {line}
              </p>
            ))
        : null}
    </section>
  );
}
