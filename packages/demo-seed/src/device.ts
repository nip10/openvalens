import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { round, type Random } from "./random";

/**
 * Phone and watch data for the demo person (Issue #301), sent through
 * `mobile.ingestBatch` exactly as the Android app syncs Health Connect: steps,
 * distance, active energy, heart rate, sleep sessions with stages, cardio
 * workouts, weight and body fat. Every value is synthetic and drawn from
 * plausible ranges for a moderately active adult.
 */

/** Fixed, made-up device id, so reruns produce the same records. */
export const DEMO_DEVICE_ID = "3d0f4a52-9c1e-4c6b-8e21-5a7d00000301";
const SOURCE_APP = "app.openvalens.demo.tracker";
const SOURCE_DEVICE = { type: "watch", model: "Demo Watch" };
const MAX_UPSERTS = 1000;

type Upsert = Record<string, unknown> & { type: string; externalRecordId: string };

export type DeviceDay = {
  offset: number;
  steps: number;
  /** Cardio workout of the day, if any. */
  workout: { activity: string; title: string; start: number; minutes: number } | null;
  /** Hours (wall clock, relative to the day) the person fell asleep the night before and woke. */
  sleep: { start: number; end: number };
};

const iso = (date: Date) => date.toISOString();

/** The day-level plan the other generators (score, insights) can agree on. */
export function planDeviceDays(calendar: DemoCalendar, random: Random): DeviceDay[] {
  return calendar.offsets().map((offset) => {
    const weekday = new Date(`${calendar.day(offset)}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    let workout: DeviceDay["workout"] = null;
    if (weekday === 2 || weekday === 4) {
      workout = {
        activity: "running",
        title: "Morning run",
        start: 7.25,
        minutes: random.int(28, 42),
      };
    } else if (weekday === 6) {
      workout = {
        activity: "biking",
        title: "Weekend ride",
        start: 9.5,
        minutes: random.int(55, 95),
      };
    } else if (weekday === 0 && random.chance(0.6)) {
      workout = { activity: "yoga", title: "Yoga", start: 10, minutes: random.int(30, 50) };
    }
    // The last week is clearly better than the four before it (more sleep,
    // more steps), so the insight rules have a real change to report. The
    // sleep lift must clear the change rule's noise threshold on any "today":
    // weekday/weekend sleep differ, so the threshold moves with where the
    // weekends fall, and a smaller lift fired only on some dates.
    const lastWeek = offset < 7;
    const base = weekend
      ? random.normal(10_500, 2_400, 4_000, 19_000)
      : random.normal(8_200, 1_700, 3_500, 14_000);
    const steps = Math.round(
      (base + (workout?.activity === "running" ? 4_500 : 0)) * (lastWeek ? 1.3 : 1),
    );
    const bedtime =
      (weekend ? 23.4 : 22.9) + random.normal(0, 0.35, -0.8, 1.2) - (lastWeek ? 0.4 : 0);
    const duration = random.normal(weekend ? 7.9 : 7.1, 0.4, 5.6, 9.2) + (lastWeek ? 1.25 : 0);
    return { offset, steps, workout, sleep: { start: bedtime - 24, end: bedtime - 24 + duration } };
  });
}

/**
 * An instant during the night before `day`, `hour` on the plan's clock. Hours
 * count from falling asleep in elapsed time, so a night with a daylight-saving
 * change keeps its stages in order (the wake-up clock time moves instead).
 */
export function sleepInstant(calendar: DemoCalendar, day: DeviceDay, hour: number): Date {
  const start = calendar.at(day.offset, day.sleep.start);
  return new Date(
    start.getTime() + Math.round(hour * 3_600_000) - Math.round(day.sleep.start * 3_600_000),
  );
}

function sleepStages(calendar: DemoCalendar, day: DeviceDay, random: Random) {
  const stages: { stage: string; startTime: string; endTime: string }[] = [];
  let cursor = day.sleep.start;
  const end = day.sleep.end;
  let cycle = 0;
  while (cursor < end - 0.1) {
    // ~90-minute cycles: light, deep (more early in the night), light, REM (more late).
    const deep = Math.max(0.05, (cycle < 2 ? 0.45 : 0.15) + random.normal(0, 0.06));
    const rem = Math.max(0.1, (cycle < 2 ? 0.2 : 0.45) + random.normal(0, 0.06));
    const parts: [string, number][] = [
      ["light", 0.35 + random.normal(0, 0.05)],
      ["deep", deep],
      ["light", 0.25 + random.normal(0, 0.05)],
      ["rem", rem],
    ];
    if (random.chance(0.35)) parts.push(["awake", random.between(0.03, 0.12)]);
    for (const [stage, hours] of parts) {
      const next = Math.min(end, cursor + Math.max(0.05, hours));
      if (next <= cursor) break;
      stages.push({
        stage,
        startTime: iso(sleepInstant(calendar, day, cursor)),
        endTime: iso(sleepInstant(calendar, day, next)),
      });
      cursor = next;
    }
    cycle += 1;
  }
  return stages;
}

function heartRateSamples(calendar: DemoCalendar, day: DeviceDay, random: Random, resting: number) {
  const samples: { time: string; bpm: number }[] = [];
  let last = -Infinity;
  // Every 15 minutes across the whole day, from midnight to midnight, up to
  // the moment of seeding.
  for (let quarter = 0; quarter < 96; quarter += 1) {
    const hour = quarter / 4;
    const asleep = hour < day.sleep.end || hour >= day.sleep.start + 24;
    let bpm = asleep
      ? resting + random.normal(1, 2.5, -4, 6)
      : resting + 16 + random.normal(6, 8, -6, 30);
    const workout = day.workout;
    if (workout && hour >= workout.start && hour < workout.start + workout.minutes / 60) {
      bpm =
        workout.activity === "yoga"
          ? random.normal(92, 8, 75, 115)
          : random.normal(148, 10, 120, 178);
    }
    const time = calendar.at(day.offset, hour);
    // On a spring daylight-saving day the skipped hour lands on the next
    // one: keep one sample per time.
    if (time.getTime() <= last || !calendar.past(time)) continue;
    last = time.getTime();
    samples.push({ time: iso(time), bpm: Math.round(bpm) });
  }
  return samples;
}

/** Resting heart rate before noise: slowly improving, 3.5 bpm lower in the last week. */
export function demoRestingHeartRate(offset: number): number {
  return 62 - 2.5 * (1 - offset / 89) - (offset < 7 ? 3.5 : 0);
}

/** Morning weight: a slow, noisy downward trend (68.4 kg to about 66.3 kg). */
export function demoWeightKg(offset: number, random: Random): number {
  const progress = 1 - offset / 89;
  return round(68.4 - 2.1 * progress + random.normal(0, 0.28, -0.7, 0.7), 1);
}

export async function seedDeviceData(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  days: readonly DeviceDay[],
  random: Random,
): Promise<void> {
  await api.call(
    "mobile/registerDevice",
    {
      deviceId: DEMO_DEVICE_ID,
      platform: "android",
      deviceModel: "Demo Phone",
      appVersion: "1.0.0",
    },
    actor,
  );

  const records = new Map<string, Upsert[]>();
  const add = (record: Upsert) => {
    const list = records.get(record.type) ?? [];
    list.push(record);
    records.set(record.type, list);
  };
  const base = (id: string) => ({
    externalRecordId: id,
    sourceApp: SOURCE_APP,
    sourceDevice: SOURCE_DEVICE,
  });

  for (const day of days) {
    const date = calendar.day(day.offset);
    const fitness = 1 - day.offset / 89;
    const resting = demoRestingHeartRate(day.offset);

    // Steps, distance and active energy in four blocks across the waking day.
    // Today's stop at the start of the current hour: a block still going is
    // cut there, with its share of the steps.
    const blocks: [number, number, number][] = [
      [7, 9, 0.2],
      [9, 13, 0.3],
      [13, 18, 0.3],
      [18, 22, 0.2],
    ];
    const hourStart = Math.floor(calendar.until.getTime() / 3_600_000) * 3_600_000;
    blocks.forEach(([from, to, share], index) => {
      const start = calendar.at(day.offset, from).getTime();
      const planned = calendar.at(day.offset, to);
      const end = calendar.past(planned) ? planned.getTime() : hourStart;
      const covered = Math.max(0, end - start) / (planned.getTime() - start);
      const steps = Math.round(day.steps * share * covered);
      // Drawn for every block, so the values after it stay the same.
      const kcal = round(steps * 0.042 + random.between(5, 25));
      if (steps <= 0) return;
      const interval = { startTime: iso(new Date(start)), endTime: iso(new Date(end)) };
      add({ ...base(`steps-${date}-${index}`), ...interval, type: "steps", count: steps });
      add({
        ...base(`distance-${date}-${index}`),
        ...interval,
        type: "distance",
        meters: round(steps * 0.71),
      });
      add({ ...base(`energy-${date}-${index}`), ...interval, type: "active_calories", kcal });
    });

    const samples = heartRateSamples(calendar, day, random, resting);
    if (samples.length > 0)
      add({
        ...base(`hr-${date}`),
        type: "heart_rate",
        startTime: iso(calendar.at(day.offset, 0)),
        endTime: iso(calendar.clamp(calendar.at(day.offset, 23.99))),
        samples,
      });

    // A night still going when the seed runs has not synced yet.
    const stages = sleepStages(calendar, day, random);
    const wake = sleepInstant(calendar, day, day.sleep.end);
    if (calendar.past(wake))
      add({
        ...base(`sleep-${date}`),
        type: "sleep_session",
        startTime: iso(calendar.at(day.offset, day.sleep.start)),
        endTime: iso(wake),
        stages,
      });

    if (day.workout) {
      const start = calendar.at(day.offset, day.workout.start);
      const end = new Date(start.getTime() + day.workout.minutes * 60_000);
      if (calendar.past(end))
        add({
          ...base(`workout-${date}`),
          type: "workout",
          startTime: iso(start),
          endTime: iso(end),
          activity: day.workout.activity,
          title: day.workout.title,
        });
    }

    // A smart scale most mornings.
    if (day.offset === 0 || random.chance(0.85)) {
      const weighed = calendar.at(day.offset, 7 + random.between(0, 0.5));
      const valueKg = demoWeightKg(day.offset, random);
      const percent = round(27.2 - 1.4 * fitness + random.normal(0, 0.35, -0.9, 0.9), 1);
      if (calendar.past(weighed)) {
        const at = iso(weighed);
        add({ ...base(`weight-${date}`), type: "weight", startTime: at, valueKg });
        add({ ...base(`fat-${date}`), type: "body_fat", startTime: at, percent });
      }
    }
  }

  for (const [recordType, upserts] of records) {
    for (let i = 0; i < upserts.length; i += MAX_UPSERTS) {
      const result = await api.call<{ status: string; rejected: number }>(
        "mobile/ingestBatch",
        {
          schemaVersion: 1,
          deviceId: DEMO_DEVICE_ID,
          provider: "health_connect",
          recordType,
          mode: "backfill",
          upserts: upserts.slice(i, i + MAX_UPSERTS),
          deletions: [],
          clientTimezone: calendar.timeZone,
        },
        actor,
      );
      if (result.status !== "applied" || result.rejected > 0) {
        throw new Error(`Demo seed: the ${recordType} batch was not applied.`);
      }
    }
  }
}
