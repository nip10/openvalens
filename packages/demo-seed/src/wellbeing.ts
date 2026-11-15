import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { demoUuid } from "./ids";
import type { Random } from "./random";

/**
 * Custom trackers and the pain log (Issue #301), through the same `trackers.*`
 * and `pain.*` procedures the apps call. Entries end yesterday: both refuse a
 * time in the future, and the seed never reads the real clock.
 */

const TIMEZONE = "Europe/London";
/** `trackers.importFeed` takes at most this many entries per call. */
const FEED_BATCH = 200;

/**
 * Two trackers. Meditation is linked to the Health Connect mindfulness feed
 * (READ_MINDFULNESS, app 1.2.0) and filled by an import, as the Android app
 * does; mood is a 1-5 rating typed in most evenings, a little higher in the
 * better last week.
 */
export async function seedTrackers(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  const meditation = await api.call<{ id: string }>(
    "trackers/create",
    {
      template: "meditation",
      name: "Meditation",
      icon: "leaf",
      type: "duration",
      aggregation: "sum",
      // Seconds: an hour a week.
      target: { value: 3600, period: "week" },
    },
    actor,
  );
  await api.call(
    "trackers/linkFeed",
    { trackerId: meditation.id, feed: "health_connect_mindfulness" },
    actor,
  );
  const sessions: { sourceRecordId: string; value: number; loggedAt: string }[] = [];
  for (const offset of calendar.offsets()) {
    if (offset === 0) continue;
    if (!random.chance(offset < 7 ? 0.9 : 0.65)) continue;
    const minutes = random.int(8, 20);
    sessions.push({
      sourceRecordId: demoUuid(`mindfulness-${calendar.day(offset)}`),
      value: minutes * 60,
      loggedAt: calendar.at(offset, 7 + random.between(0, 0.5)).toISOString(),
    });
  }
  for (let i = 0; i < sessions.length; i += FEED_BATCH) {
    const result = await api.call<{ imported: number }>(
      "trackers/importFeed",
      {
        feed: "health_connect_mindfulness",
        trackerId: meditation.id,
        timeZone: TIMEZONE,
        entries: sessions.slice(i, i + FEED_BATCH),
      },
      actor,
    );
    if (result.imported !== Math.min(FEED_BATCH, sessions.length - i))
      throw new Error("Demo seed: the mindfulness import was not applied.");
  }

  const mood = await api.call<{ id: string }>(
    "trackers/create",
    { template: "mood", name: "Mood", icon: "smile", type: "scale", aggregation: "average" },
    actor,
  );
  for (const offset of calendar.offsets()) {
    if (offset === 0 || random.chance(0.15)) continue;
    const value = Math.round(random.normal(offset < 7 ? 4.2 : 3.6, 0.7, 1, 5));
    await api.call(
      "trackers/log",
      {
        trackerId: mood.id,
        value,
        loggedAt: calendar.at(offset, 21 + random.between(0, 1)).toISOString(),
        timeZone: TIMEZONE,
      },
      actor,
    );
  }
}

/**
 * The pain layer of the body map: lower-back stiffness the morning after the
 * Friday deadlift day, and an occasional right-knee ache after a run. The last
 * Saturday is always logged, so the default seven-day map has an entry.
 */
export async function seedPain(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  await api.call("pain/setPreference", { enabled: true }, actor);
  for (const offset of calendar.offsets()) {
    if (offset === 0) continue;
    const weekday = new Date(`${calendar.day(offset)}T00:00:00Z`).getUTCDay();
    const loggedAt = (hour: number) => calendar.at(offset, hour).toISOString();
    if (weekday === 6 && (offset <= 7 || random.chance(0.6))) {
      await api.call(
        "pain/log",
        {
          regions: ["back.lower_back_left", "back.lower_back_right"],
          rating: random.int(2, 4),
          type: "stiffness",
          loggedAt: loggedAt(8.5),
          timeZone: TIMEZONE,
        },
        actor,
      );
    }
    if ((weekday === 2 || weekday === 4) && offset <= 45 && random.chance(0.3)) {
      await api.call(
        "pain/log",
        {
          regions: ["joint.knee_right"],
          rating: random.int(2, 3),
          type: "ache",
          loggedAt: loggedAt(12),
          timeZone: TIMEZONE,
          note: "After the morning run.",
        },
        actor,
      );
    }
  }
}
