/**
 * Reminder reaction mapping (Issue #14).
 *
 * Telegram delivers reactions on a reminder message as a `message_reaction`
 * update. The reaction emoji is mapped to a normalized reminder outcome so the
 * webhook can persist it against the owning `daily_reminder` row.
 */

export type ReminderReactionStatus = "completed" | "snoozed" | "dismissed" | "unknown";

/**
 * Maps a Telegram reaction emoji to a reminder outcome.
 *
 * - `✅` / `👍` / `✔️` → `completed`
 * - `⏸` / `⏸️` / `💤` → `snoozed`
 * - `❌` / `👎` → `dismissed`
 * - anything else (including `null` / `undefined`) → `unknown`
 */
export function mapReactionToReminderStatus(
  emoji: string | null | undefined,
): ReminderReactionStatus {
  if (!emoji) {
    return "unknown";
  }

  switch (emoji) {
    case "✅":
    case "👍":
    case "✔️":
      return "completed";
    case "⏸":
    case "⏸️":
    case "💤":
      return "snoozed";
    case "❌":
    case "👎":
      return "dismissed";
    default:
      return "unknown";
  }
}
