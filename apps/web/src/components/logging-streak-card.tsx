import type { LoggingStreakOutput } from "@openvalens/api/contracts/nutrition-targets";
import { presentLoggingStreak, STREAK_COPY } from "@openvalens/api/presenters/logging-streak";
import { useLingui } from "@lingui/react/macro";
import { Flame } from "lucide-react";

import { ToneIcon } from "@/components/page";

/**
 * The opt-in logging streak (Issue #90). Renders nothing unless the server
 * says the streak is on: hidden, off, loading and errors all show nothing.
 */
export function LoggingStreakCard({ streak }: { streak: LoggingStreakOutput | undefined }) {
  const { i18n } = useLingui();
  const view = presentLoggingStreak(streak);
  if (!view) return null;
  return (
    <section
      aria-label={i18n._(STREAK_COPY.title)}
      className="sheet flex min-w-0 items-center gap-4 p-5"
    >
      <ToneIcon icon={Flame} tone="food" size="lg" />
      <div className="grid min-w-0 gap-0.5">
        <p className="font-display text-lg leading-snug font-medium text-ink">
          {i18n._(view.headline)}
        </p>
        {view.lines.length
          ? view.lines
              .map((line) => i18n._(line))
              .map((line) => (
                <p key={line} className="text-sm text-ink-3">
                  {line}
                </p>
              ))
          : null}
      </div>
    </section>
  );
}
