/**
 * Logging streak presentation shared by web and mobile (Issue #90). Pure
 * TypeScript; imports only zod-only contracts — safe for app bundles.
 *
 * Copy rules (docs/nutrition-targets.md, #80 safeguards): calm and neutral.
 * No shame, no "you broke it", no streak-at-risk or lost-streak messages and
 * no comparison with anyone. After a break the non-resetting count for the
 * month leads. Hidden or off renders nothing at all.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";

import type { LoggingStreakOutput } from "../contracts/nutrition-targets";

export const STREAK_COPY = Object.freeze({
  title: msg`Logging streak`,
  settingLabel: msg`Show a logging streak`,
  settingDescription: msg`Counts days with at least one diary entry. It is about the habit of logging, not about what you eat. Hidden in hide-numbers mode and after any declaration.`,
});

export type StreakView = { headline: MessageDescriptor; lines: MessageDescriptor[] };

/** Text for the streak card, or `null` when nothing should be shown. */
export function presentLoggingStreak(streak: LoggingStreakOutput | undefined): StreakView | null {
  if (!streak || streak.state !== "on") return null;
  const month = msg`${plural(streak.daysLoggedThisMonth, { one: "# day", other: "# days" })} logged this month`;
  const run = msg`${plural(streak.current, { one: "# day", other: "# days" })} in a row`;
  const lines: MessageDescriptor[] = [];
  let headline: MessageDescriptor;
  if (streak.current > 0 && streak.repairAvailableUntil === null) {
    headline = run;
    lines.push(month);
  } else {
    headline = month;
    if (streak.current > 0) lines.push(run);
  }
  if (streak.milestone !== null)
    lines.push(
      msg`${plural(streak.milestone, { one: "# day", other: "# days" })} of logging. Nicely done.`,
    );
  if (streak.repairAvailableUntil !== null) {
    const until = streak.repairAvailableUntil;
    lines.push(msg`If you missed a day, you can still add it until the end of ${until}.`);
  }
  if (streak.current > 0 && streak.freezesAvailable > 0)
    lines.push(
      msg`${plural(streak.freezesAvailable, { one: "# rest day", other: "# rest days" })} available: a day without logging won't reset the count.`,
    );
  return { headline, lines };
}
