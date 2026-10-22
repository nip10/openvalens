/**
 * Logging streak presentation shared by web and mobile (Issue #90). Pure
 * TypeScript; imports only zod-only contracts — safe for app bundles.
 *
 * Copy rules (docs/nutrition-targets.md, #80 safeguards): calm and neutral.
 * No shame, no "you broke it", no streak-at-risk or lost-streak messages and
 * no comparison with anyone. After a break the non-resetting count for the
 * month leads. Hidden or off renders nothing at all.
 */
import type { LoggingStreakOutput } from "../contracts/nutrition-targets";

export const STREAK_COPY = Object.freeze({
  title: "Logging streak",
  settingLabel: "Show a logging streak",
  settingDescription:
    "Counts days with at least one diary entry. It is about the habit of logging, not about what you eat. Hidden in hide-numbers mode and after any declaration.",
});

export type StreakView = { headline: string; lines: string[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Text for the streak card, or `null` when nothing should be shown. */
export function presentLoggingStreak(streak: LoggingStreakOutput | undefined): StreakView | null {
  if (!streak || streak.state !== "on") return null;
  const month = `${plural(streak.daysLoggedThisMonth, "day", "days")} logged this month`;
  const lines: string[] = [];
  let headline: string;
  if (streak.current > 0 && streak.repairAvailableUntil === null) {
    headline = `${plural(streak.current, "day", "days")} in a row`;
    lines.push(month);
  } else {
    headline = month;
    if (streak.current > 0) lines.push(`${plural(streak.current, "day", "days")} in a row`);
  }
  if (streak.milestone !== null)
    lines.push(`${plural(streak.milestone, "day", "days")} of logging. Nicely done.`);
  if (streak.repairAvailableUntil !== null)
    lines.push(
      `If you missed a day, you can still add it until the end of ${streak.repairAvailableUntil}.`,
    );
  if (streak.current > 0 && streak.freezesAvailable > 0)
    lines.push(
      `${plural(streak.freezesAvailable, "rest day", "rest days")} available: a day without logging won't reset the count.`,
    );
  return { headline, lines };
}
