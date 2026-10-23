import { describe, expect, test } from "bun:test";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";

import {
  INSIGHT_KINDS,
  INSIGHT_RULE_IDS,
  INSIGHT_TOPICS,
  type Insight,
  type InsightDetail,
  type InsightRuleId,
  type InsightRuleReadiness,
} from "../insight-contract";
import { INSIGHT_RULE_KINDS, INSIGHT_RULE_VERSIONS } from "../insight-contract";
import {
  GENERIC_DELIVERY_KINDS,
  GENERIC_PUSH_BODY,
  INSIGHT_COPY,
  INSIGHT_EMAIL_COPY,
  INSIGHT_KIND_LABELS,
  insightPushContent,
  insightReadinessViews,
  insightView,
  type InsightView,
} from "./insights";

/**
 * Issue #92 — copy lint. Every rule's template is rendered for every
 * direction/state and checked against the wording rules: no advice, no
 * diagnosis, no risk or prediction, no judgement, no causal language.
 */
const BANNED = [
  /\bshould\b/i,
  /\bmust\b/i,
  /\bconsider\b/i,
  /\btry\b/i,
  /\brecommend/i,
  /\badvis/i,
  /\bdiagnos/i,
  /\brisk/i,
  /\bdanger/i,
  /\bwarning\b/i,
  /\balarm/i,
  /\b(ab)?normal\b/i,
  /\b(un)?healthy\b/i,
  /\bdisease/i,
  /\billness/i,
  /\bsick/i,
  /\binfection/i,
  /\bovertrain/i,
  /\binjur/i,
  /\bcaus(e|ed|es|ing)\b/i,
  /\bbecause\b/i,
  /\bdue to\b/i,
  /\bleads? to\b/i,
  /\bresult(s|ed)? in\b/i,
  /\bpredict/i,
  /\btreat/i,
  /\bimprov/i,
  /\bworse/i,
  /\bbetter\b/i,
  /\bgood\b/i,
  /\bbad\b/i,
  /\bpoor\b/i,
  /\burgent/i,
  /!/,
];

function lint(text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function make(ruleId: InsightRuleId, detail: InsightDetail, withFactors = false): Insight {
  return {
    id: `${ruleId}:w`,
    ruleId,
    ruleVersion: INSIGHT_RULE_VERSIONS[ruleId],
    kind: INSIGHT_RULE_KINDS[ruleId],
    topic: "sleep",
    windowKey: "w",
    windowEnd: "2026-10-15",
    detail,
    factors: withFactors
      ? [
          { metric: "steps", direction: "lower" },
          { metric: "resting_heart_rate", direction: "higher" },
        ]
      : [],
  };
}

const change = (
  metric: "sleep_duration" | "resting_heart_rate" | "steps",
  direction: "higher" | "lower",
  certainty: "clear" | "modest",
) =>
  ({
    type: "change",
    metric,
    direction,
    unit: metric === "sleep_duration" ? "minutes" : metric === "steps" ? "steps" : "bpm",
    recentValue: metric === "sleep_duration" ? 380 : metric === "steps" ? 5200 : 64,
    recentDays: 7,
    recentWindowDays: 7,
    baselineValue: metric === "sleep_duration" ? 430 : metric === "steps" ? 8100 : 59,
    baselineDays: 26,
    baselineWindowDays: 28,
    difference: direction === "higher" ? 5 : -50,
    threshold: 3,
    certainty,
  }) as const;

function everyInsight(): Insight[] {
  const out: Insight[] = [];
  for (const metric of ["sleep_duration", "resting_heart_rate", "steps"] as const)
    for (const direction of ["higher", "lower"] as const)
      for (const certainty of ["clear", "modest"] as const)
        out.push(make(`change.${metric}`, change(metric, direction, certainty), true));
  for (const direction of ["higher", "lower"] as const)
    for (const certainty of ["clear", "modest"] as const)
      out.push(
        make(
          "change.weight_trend",
          {
            type: "trend",
            metric: "weight",
            direction,
            unit: "kg",
            startValue: 81.2,
            endValue: direction === "higher" ? 82.6 : 79.8,
            windowDays: 28,
            days: 20,
            certainty,
          },
          true,
        ),
      );
  for (const state of ["reached", "toward_target", "away_from_target"] as const)
    out.push(
      make(`goal.${state}` as InsightRuleId, {
        type: "goal",
        goalId: 3,
        goalTitle: "Walk 10k steps",
        state,
        progress: 0.6,
        currentValue: 8000,
        targetValue: 10000,
      }),
    );
  for (const metric of ["sleep_duration", "resting_heart_rate", "steps", "weight"] as const) {
    out.push(
      make("data_quality.recording_gap", {
        type: "recording_gap",
        metric,
        lastRecordedDate: "2026-10-11",
        daysWithout: 4,
      }),
      make("data_quality.source_change", {
        type: "source_change",
        metric,
        sinceDate: "2026-10-09",
        baselineDays: 6,
        baselineMinDays: 14,
      }),
      make("streak.recording", { type: "streak", metric, days: 14, startDate: "2026-10-02" }),
    );
  }
  out.push(
    make("observation.meals_and_workouts", {
      type: "meals_and_workouts",
      window: { from: "2026-10-01", to: "2026-10-07", days: 7 },
      diaryCompleteDays: 5,
      workoutDays: 4,
      daysWithBoth: 3,
    }),
    make("observation.meals_near_sleep", {
      type: "meals_near_sleep",
      window: { from: "2026-10-01", to: "2026-10-07", days: 7 },
      evenings: 4,
      nearSleepEvenings: 3,
      nearSleepWindowMinutes: 240,
      medianGapMinutes: 90,
    }),
    make("observation.activity_energy_context", {
      type: "activity_energy_context",
      window: { from: "2026-10-01", to: "2026-10-07", days: 7 },
      activityDays: 4,
      activityEnergyKcal: 180,
    }),
  );
  return out;
}

function allText(view: InsightView): string {
  return [view.title, view.body, view.certaintyText, view.coverageText, view.factorsText]
    .filter(Boolean)
    .join(" ");
}

describe("insight templates (copy lint)", () => {
  test("every rule has at least one rendered fixture", () => {
    const covered = new Set(everyInsight().map((insight) => insight.ruleId));
    expect([...INSIGHT_RULE_IDS].filter((id) => !covered.has(id))).toEqual([]);
  });

  test("no template uses advice, diagnostic, risk, judging or causal wording", () => {
    const failures = everyInsight()
      .map((insight) => ({ id: insight.id, text: allText(insightView(englishI18n, insight)) }))
      .map(({ id, text }) => ({ id, text, hits: lint(text) }))
      .filter((entry) => entry.hits.length > 0);
    expect(failures).toEqual([]);
  });

  test("fixed copy passes the same lint", () => {
    const fixed = [
      ...Object.values(INSIGHT_COPY)
        .filter((value) => typeof value !== "function")
        .map(inEnglish),
      inEnglish(INSIGHT_COPY.hiddenSome(2)),
      inEnglish(INSIGHT_COPY.hiddenSome(1)),
      inEnglish(INSIGHT_COPY.suppressed(1)),
      inEnglish(INSIGHT_COPY.suppressed(3)),
      inEnglish(INSIGHT_EMAIL_COPY.intro),
      inEnglish(INSIGHT_EMAIL_COPY.none),
    ];
    expect(fixed.flatMap((text) => lint(text).map((hit) => `${hit}: ${text}`))).toEqual([]);
  });

  test("a change states what changed, against which usual, how sure, and coverage", () => {
    const view = insightView(
      englishI18n,
      make("change.resting_heart_rate", change("resting_heart_rate", "higher", "clear")),
    );
    expect(view.title).toBe("Resting heart rate higher than your usual");
    expect(view.body).toBe(
      "Your 7-day average resting heart rate was 64 bpm, 5 bpm higher than your usual of 59 bpm.",
    );
    expect(view.certaintyText).toContain("usual day-to-day variation");
    expect(view.coverageText).toBe(
      "Based on 7 of the last 7 days, compared with 26 days in the 28 days before.",
    );
    expect(view.ruleText).toBe("Rule change.resting_heart_rate v1");
  });

  test("co-occurring factors are worded as co-occurrence only", () => {
    const view = insightView(
      englishI18n,
      make("change.sleep_duration", change("sleep_duration", "lower", "modest"), true),
    );
    expect(view.factorsText).toBe(
      "In the same period, your step count was lower than usual and your resting heart rate was higher than usual. These changed at the same time; that does not mean one explains the other.",
    );
  });

  test("weight respects imperial display settings", () => {
    const view = insightView(
      englishI18n,
      make("change.weight_trend", {
        type: "trend",
        metric: "weight",
        direction: "lower",
        unit: "kg",
        startValue: 80,
        endValue: 78,
        windowDays: 28,
        days: 20,
        certainty: "clear",
      }),
      { units: "imperial", locale: "en-US" } as never,
    );
    expect(view.body).toContain("lb");
    expect(view.body).not.toContain("kg");
  });
});

describe("insight templates in pt-PT (#231)", () => {
  const pt = createAppI18n("pt-PT");
  const first = (type: InsightDetail["type"]) =>
    everyInsight().find((insight) => insight.detail.type === type)!;

  test("one insight of each detail type renders in European Portuguese", () => {
    const titles = Object.fromEntries(
      (
        [
          "change",
          "trend",
          "goal",
          "recording_gap",
          "source_change",
          "streak",
          "meals_and_workouts",
          "meals_near_sleep",
          "activity_energy_context",
        ] as const
      ).map((type) => [type, insightView(pt, first(type)).title]),
    );
    expect(titles).toEqual({
      change: "Sono acima do seu habitual",
      trend: "Peso em tendência de subida",
      goal: "Alvo atingido: Walk 10k steps",
      recording_gap: "Sem registos de sono desde 11 Oct",
      source_change: "Nova fonte de dados para o sono",
      streak: "14 dias seguidos com registo de sono",
      meals_and_workouts: "Refeições e treinos registados",
      meals_near_sleep: "Refeições e horário do sono registado",
      activity_energy_context: "Energia de atividade registada",
    });
    const view = insightView(
      pt,
      make("change.resting_heart_rate", change("resting_heart_rate", "lower", "clear"), true),
    );
    expect(view.body).toBe(
      "A sua média de frequência cardíaca em repouso nos últimos 7 dias foi de 64 bpm, 50 bpm abaixo do seu habitual de 59 bpm.",
    );
    expect(view.coverageText).toBe(
      "Com base em 7 dos últimos 7 dias, em comparação com 26 dias nos 28 dias anteriores.",
    );
    expect(view.factorsText).toBe(
      "No mesmo período, o seu número de passos esteve abaixo do habitual e a sua frequência cardíaca em repouso esteve acima do habitual. Estas alterações aconteceram ao mesmo tempo; isso não significa que uma explique a outra.",
    );
    expect(view.kindLabel).toBe("Alterações em comparação com o seu habitual");
    expect(view.ruleText).toBe("Regra change.resting_heart_rate v1");
  });

  test("no rendered sentence falls back to English", () => {
    for (const insight of everyInsight()) {
      const english = insightView(englishI18n, insight);
      const portuguese = insightView(pt, insight);
      for (const key of ["title", "body", "certaintyText", "coverageText", "factorsText"] as const)
        if (english[key] !== null)
          expect({ key, text: portuguese[key] }).not.toEqual({ key, text: english[key] });
    }
    expect(pt._(INSIGHT_COPY.hiddenSome(1))).toBe(
      "1 perspetiva está oculta pelo que dispensou ou pelas suas definições.",
    );
    expect(pt._(INSIGHT_COPY.sectionTitle)).toBe("Perspetivas");
  });
});

describe("not enough data", () => {
  test("readiness rows explain what is missing and never say zero or normal", () => {
    const readiness: InsightRuleReadiness[] = [
      {
        ruleId: "change.sleep_duration",
        metric: "sleep_duration",
        state: "building_baseline",
        baselineDays: 5,
        baselineMinDays: 14,
        recentDays: 5,
        recentMinDays: 5,
      },
      {
        ruleId: "change.steps",
        metric: "steps",
        state: "ready",
        baselineDays: 20,
        baselineMinDays: 14,
        recentDays: 6,
        recentMinDays: 5,
      },
    ];
    const views = insightReadinessViews(englishI18n, readiness);
    expect(views).toEqual([
      {
        key: "change.sleep_duration",
        label: "Sleep",
        stateLabel: "Building your usual",
        detail: "5 of 14 days with data so far.",
      },
    ]);
    expect(JSON.stringify(views)).not.toMatch(/normal|no change/i);
  });
});

describe("generic delivery kinds", () => {
  test("omit observation, keep every other kind listed in the same order", () => {
    // Observation is opted in only through its dedicated card and is never
    // delivered, so the generic settings matrix must not list it. Removing it
    // here is the honest-surface fix for #84; every other kind stays.
    expect(GENERIC_DELIVERY_KINDS).not.toContain("observation");
    expect(GENERIC_DELIVERY_KINDS).toEqual(INSIGHT_KINDS.filter((kind) => kind !== "observation"));
    expect(GENERIC_DELIVERY_KINDS).toEqual([
      "change",
      "goal_milestone",
      "data_quality",
      "streak",
      "reminder",
    ]);
    for (const kind of GENERIC_DELIVERY_KINDS) {
      expect(inEnglish(INSIGHT_KIND_LABELS[kind])).toBeTruthy();
      expect(inEnglish(INSIGHT_KIND_LABELS[kind])).not.toMatch(/observation/i);
    }
  });
});

describe("push content", () => {
  test("generic by default; never a value, title, date or digit", () => {
    for (const topic of [...INSIGHT_TOPICS, null]) {
      const generic = insightPushContent(englishI18n, topic, false);
      expect(generic.body).toBe(inEnglish(GENERIC_PUSH_BODY));
      const withTopic = insightPushContent(englishI18n, topic, true);
      for (const content of [generic, withTopic]) {
        expect(`${content.title} ${content.body}`).not.toMatch(/\d/);
        expect(lint(`${content.title} ${content.body}`)).toEqual([]);
      }
    }
    expect(insightPushContent(englishI18n, "sleep", true).body).toBe(
      "You have a new sleep insight",
    );
    expect(insightPushContent(englishI18n, null, false).body).toBe("You have a new insight");
  });

  test("is written in the recipient's language (#231), with no digit in any language", () => {
    const pt = createAppI18n("pt-PT");
    for (const topic of [...INSIGHT_TOPICS, null]) {
      for (const showTopic of [false, true]) {
        const english = insightPushContent(englishI18n, topic, showTopic);
        const portuguese = insightPushContent(pt, topic, showTopic);
        expect(portuguese.title).toBe("OpenValens");
        expect(portuguese.body).not.toBe(english.body);
        expect(portuguese.body).not.toMatch(/\d/);
      }
    }
    expect(insightPushContent(pt, null, false).body).toContain("perspetiva");
  });
});
