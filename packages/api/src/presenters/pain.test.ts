import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { PAIN_REGION_IDS, PAIN_TYPES } from "@openvalens/pain/model";

import { painLayer, painRegionLabel } from "./body-map";
import {
  PAIN_COPY,
  PAIN_TYPE_LABELS,
  painEntrySummary,
  painRatingText,
  painWorkoutFact,
} from "./pain";
import { timelineSummary, timelineTitle } from "./timeline";

/**
 * Pain is a record of what the member rated (#442): no screen names a cause
 * or a diagnosis, and nothing changes wording with the value. The one notice
 * is fixed and always shown.
 */
const CAUSAL_OR_DIAGNOSTIC =
  /\b(diagnos\w*|caus\w*|because|due to|injur\w*|symptom\w*|condition\w*|likely|pattern\w*|trigger\w*|overuse|strain\w*|sprain\w*|inflam\w*|arthrit\w*|tendin\w*|warning|alert|danger\w*|urgent|emergency|severe|serious|worse|should|recommend\w*|seek|risk\w*)\b/i;

const NOTICE =
  "This is a record, not a diagnosis. Talk to a healthcare professional about pain that is severe, sudden or not getting better.";

describe("pain copy", () => {
  test("the fixed notice reads exactly as settled", () => {
    expect(inEnglish(PAIN_COPY.notice)).toBe(NOTICE);
  });

  test("no other copy has causal, diagnostic or severity wording", () => {
    const messages = [
      ...Object.entries(PAIN_COPY)
        .filter(([key]) => key !== "notice")
        .map(([, message]) => inEnglish(message)),
      ...PAIN_TYPES.map((type) => inEnglish(PAIN_TYPE_LABELS[type])),
      ...PAIN_REGION_IDS.map((id) => inEnglish(painRegionLabel(id)!)),
    ];
    for (const message of messages) expect(message).not.toMatch(CAUSAL_OR_DIAGNOSTIC);
  });

  test("every rating reads the same way, number aside", () => {
    const shapes = new Set<string>();
    for (let rating = 0; rating <= 10; rating++) {
      const layer = painLayer(
        [{ region: "joint.knee_left", highest: rating, entryCount: 3 }],
        30,
        englishI18n,
      );
      const text = [
        painRatingText(rating, englishI18n),
        painEntrySummary({ rating, type: "ache" }, englishI18n),
        layer.fills["joint.knee_left"]!.valueText,
        layer.fills["joint.knee_left"]!.sourceText,
        ...layer.legend.map((step) => step.label),
      ].join(" | ");
      expect(text).not.toMatch(CAUSAL_OR_DIAGNOSTIC);
      shapes.add(text.replace(/\d+/g, "N"));
    }
    expect(shapes.size).toBe(1);
  });

  test("workouts near a rating are plain facts", () => {
    expect(
      painWorkoutFact({ type: "running", durationMinutes: 45, daysBefore: 1 }, englishI18n),
    ).toBe("Run, 45 min, the day before");
    expect(
      painWorkoutFact({ type: "weights", durationMinutes: null, daysBefore: 0 }, englishI18n),
    ).toBe("Strength, the same day");
    expect(
      painWorkoutFact({ type: "cycling", durationMinutes: 90, daysBefore: 2 }, englishI18n),
    ).toBe("Cycling, 90 min, 2 days before");
    for (const daysBefore of [0, 1, 2])
      for (const durationMinutes of [null, 30])
        expect(
          painWorkoutFact({ type: "running", durationMinutes, daysBefore }, englishI18n),
        ).not.toMatch(CAUSAL_OR_DIAGNOSTIC);
  });

  test("a rating reads as the number out of 10 with its type", () => {
    expect(painEntrySummary({ rating: 4, type: "ache" }, englishI18n)).toBe("4 of 10 · Ache");
    expect(painEntrySummary({ rating: 0, type: null }, englishI18n)).toBe("0 of 10");
  });

  test("on the timeline, a pain entry names the region and the rating", () => {
    const item = {
      id: "pain_entry:00000000-0000-4000-8000-000000000001",
      at: "2026-11-12T08:00:00.000Z",
      kind: "event",
      domain: "pain",
      title: "Pain",
      summary: "4 of 10",
      severity: "none",
      sourceRefs: [],
      canonical: {
        table: "pain_entry",
        region: "joint.knee_left",
        rating: 4,
        type: "ache",
        note: "stairs",
      },
    };
    expect(timelineTitle(item, englishI18n)).toBe("Pain: Left knee");
    expect(timelineSummary(item, englishI18n)).toBe("4 of 10 · Ache · stairs");
  });
});
