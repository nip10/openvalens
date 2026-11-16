import type { Database } from "@openvalens/db";
import { metricDefinition } from "@openvalens/db/schema/health-record";

import type { DemoApi, DemoActor } from "./api";
import type { DemoCalendar } from "./dates";
import { demoRestingHeartRate, sleepInstant, type DeviceDay } from "./device";
import { round, type Random } from "./random";

/**
 * Daily recovery metrics, overnight vitals, blood pressure and lab results
 * (Issue #301), written through `healthRecord.ingestMetricSample`, the
 * procedure the labs and vitals screens use to add a reading.
 */

/** Synthetic lab panel: three draws, so each marker has a small trend. */
const LAB_MARKERS = [
  {
    code: "vitamin_d",
    name: "Vitamin D (25-OH)",
    unit: "ng/mL",
    low: 30,
    high: 100,
    values: [22, 31, 44],
  },
  { code: "ferritin", name: "Ferritin", unit: "ng/mL", low: 15, high: 150, values: [28, 35, 41] },
  {
    code: "hemoglobin",
    name: "Hemoglobin",
    unit: "g/dL",
    low: 12,
    high: 15.5,
    values: [13.1, 13.4, 13.6],
  },
  { code: "hba1c", name: "HbA1c", unit: "%", low: 4, high: 5.6, values: [5.3, 5.2, 5.2] },
  {
    code: "glucose",
    name: "Glucose (fasting)",
    unit: "mg/dL",
    low: 70,
    high: 99,
    values: [91, 88, 86],
  },
  {
    code: "total_cholesterol",
    name: "Total cholesterol",
    unit: "mg/dL",
    low: 125,
    high: 200,
    values: [196, 188, 179],
  },
  {
    code: "ldl",
    name: "LDL cholesterol",
    unit: "mg/dL",
    low: 0,
    high: 100,
    values: [118, 109, 98],
  },
  { code: "hdl", name: "HDL cholesterol", unit: "mg/dL", low: 50, high: 90, values: [58, 61, 63] },
  {
    code: "triglycerides",
    name: "Triglycerides",
    unit: "mg/dL",
    low: 0,
    high: 150,
    values: [102, 94, 88],
  },
  { code: "tsh", name: "TSH", unit: "mIU/L", low: 0.4, high: 4, values: [1.9, 2.1, 1.8] },
  { code: "hs_crp", name: "hs-CRP", unit: "mg/L", low: 0, high: 3, values: [1.4, 1.1, 0.8] },
] as const;
const LAB_DRAW_OFFSETS = [84, 45, 5] as const;

export async function seedRecoveryMetrics(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  for (const metricCode of ["resting_heart_rate", "hrv_rmssd"] as const) {
    await api.call("healthRecord/ingestMetricDefinition", { metricCode }, actor);
  }
  for (const offset of calendar.offsets()) {
    const at = calendar.at(offset, 6.5);
    const morning = at.toISOString();
    const resting = demoRestingHeartRate(offset) + random.normal(0, 1.2, -3, 3);
    const hrv = 44 + 8 * (1 - offset / 89) + (offset < 7 ? 6 : 0) + random.normal(0, 4, -10, 10);
    if (!calendar.past(at)) continue;
    await api.call(
      "healthRecord/ingestMetricSample",
      { metricCode: "resting_heart_rate", observedAt: morning, valueNumeric: round(resting) },
      actor,
    );
    await api.call(
      "healthRecord/ingestMetricSample",
      { metricCode: "hrv_rmssd", observedAt: morning, valueNumeric: round(hrv) },
      actor,
    );
  }
}

export async function seedLabs(
  db: Database,
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
): Promise<void> {
  // No app path creates a marker with its lab unit yet (`ingestMetricDefinition`
  // stores the family's "varies"), so the definitions are inserted as a lab
  // import would leave them; every reading then goes through the API.
  await db.insert(metricDefinition).values(
    LAB_MARKERS.map((marker) => ({
      organizationId: actor.organizationId,
      code: `blood_marker_${marker.code}`,
      displayName: marker.name,
      category: "labs",
      unit: marker.unit,
      valueType: "number" as const,
      aggregationDefault: "latest",
    })),
  );
  for (const marker of LAB_MARKERS) {
    for (const [index, offset] of LAB_DRAW_OFFSETS.entries()) {
      await api.call(
        "healthRecord/ingestMetricSample",
        {
          metricCode: `blood_marker_${marker.code}`,
          observedAt: calendar.at(offset, 8.25).toISOString(),
          valueNumeric: marker.values[index],
          payload:
            marker.low > 0
              ? {
                  refRangeLow: marker.low,
                  refRangeHigh: marker.high,
                  refRangeText: `${marker.low}–${marker.high}`,
                }
              : { refRangeHigh: marker.high, refRangeText: `< ${marker.high}` },
        },
        actor,
      );
    }
  }
}

/**
 * Overnight blood oxygen (SpO₂) and respiration rate, the vitals added with
 * the direct-device metrics, through `healthRecord.ingestMetricSample` like the
 * recovery metrics: three SpO₂ readings and one respiration reading inside each
 * night's sleep. The calmer last week breathes a little slower.
 */
export async function seedNightVitals(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  days: readonly DeviceDay[],
  random: Random,
): Promise<void> {
  for (const metricCode of ["oxygen_saturation", "respiratory_rate"] as const) {
    await api.call("healthRecord/ingestMetricDefinition", { metricCode }, actor);
  }
  for (const day of days) {
    const { start, end } = day.sleep;
    const oxygen = [0.2, 0.5, 0.8].map((share) => ({
      at: sleepInstant(calendar, day, start + (end - start) * share),
      value: Math.round(random.normal(96, 1, 92, 99)),
    }));
    const breaths = (day.offset < 7 ? 13.9 : 14.6) + random.normal(0, 0.5, -1.2, 1.2);
    // Like the sleep session, a night still going when the seed runs has not
    // synced yet.
    if (!calendar.past(sleepInstant(calendar, day, end))) continue;
    for (const reading of oxygen) {
      await api.call(
        "healthRecord/ingestMetricSample",
        {
          metricCode: "oxygen_saturation",
          observedAt: reading.at.toISOString(),
          valueNumeric: reading.value,
        },
        actor,
      );
    }
    await api.call(
      "healthRecord/ingestMetricSample",
      {
        metricCode: "respiratory_rate",
        observedAt: sleepInstant(calendar, day, (start + end) / 2).toISOString(),
        valueNumeric: round(breaths, 1),
      },
      actor,
    );
  }
}

/**
 * Blood pressure typed in on Monday and Thursday mornings, as the vitals
 * screen's form writes it: a systolic and a diastolic sample at the same time.
 */
export async function seedBloodPressure(
  api: DemoApi,
  actor: DemoActor,
  calendar: DemoCalendar,
  random: Random,
): Promise<void> {
  for (const offset of calendar.offsets()) {
    const weekday = new Date(`${calendar.day(offset)}T00:00:00Z`).getUTCDay();
    if (weekday !== 1 && weekday !== 4) continue;
    const at = calendar.at(offset, 7.5);
    const observedAt = at.toISOString();
    const readings = [
      ["blood_pressure_systolic", Math.round(random.normal(117, 4, 106, 128))],
      ["blood_pressure_diastolic", Math.round(random.normal(75, 3, 66, 84))],
    ] as const;
    if (!calendar.past(at)) continue;
    for (const [metricCode, valueNumeric] of readings) {
      await api.call(
        "healthRecord/ingestMetricSample",
        { metricCode, observedAt, valueNumeric },
        actor,
      );
    }
  }
}
