import type {
  InsightPreferences,
  InsightPreferencesUpdate,
} from "@openvalens/api/insight-contract";

/** The server's default zone for a member who never saved one. */
const DEFAULT_ZONE = "UTC";

/** Whether this change turns a delivery on or sets a delivery time. */
function startsOrTimesDelivery(patch: InsightPreferencesUpdate): boolean {
  return (
    patch.push?.enabled === true ||
    patch.pushOffer === "accepted" ||
    patch.email?.enabled === true ||
    patch.dailyReminders?.email === true ||
    patch.dailyReminders?.hour !== undefined ||
    patch.deliveryHour !== undefined
  );
}

/**
 * Reminders and insights go out at a local hour in the saved time zone. A
 * member who never chose one has the server default (UTC), so a 09:00
 * reminder would reach Los Angeles at 1:00. The first time they turn a
 * delivery on or pick a time, the browser's zone is saved with it. A zone the
 * member already saved is never replaced.
 */
export function withBrowserTimeZone(
  preferences: Pick<InsightPreferences, "timeZone">,
  patch: InsightPreferencesUpdate,
  browserZone: string | undefined,
): InsightPreferencesUpdate {
  if (patch.timeZone !== undefined) return patch;
  if (preferences.timeZone !== DEFAULT_ZONE) return patch;
  if (!browserZone || browserZone === DEFAULT_ZONE) return patch;
  if (!startsOrTimesDelivery(patch)) return patch;
  return { ...patch, timeZone: browserZone };
}
