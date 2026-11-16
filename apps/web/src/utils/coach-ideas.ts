import type { I18n } from "@lingui/core";
import { msg, plural, select } from "@lingui/core/macro";
import type { InsightsResult } from "@openvalens/api/insight-contract";
import { formatInsightValue } from "@openvalens/api/presenters/insights";
import type { PersonModule } from "@openvalens/api/presenters/modules";
import type { ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";

/**
 * #coach-4 — questions to ask the coach, built from the person's own records:
 * the changes the insight rules found, their goals and their readiness index.
 * They are prompts only: tapping one fills the message box to edit, nothing is
 * sent, and nothing here reads health data beyond what the screens show.
 */

export type CoachIdeaSubject = "sleep" | "heart" | "body" | "training" | "food" | "goals";

export type CoachIdea = { key: string; text: string };
export type CoachIdeaGroup = { subject: CoachIdeaSubject; ideas: CoachIdea[] };

/** The order groups appear in. */
const SUBJECTS: readonly CoachIdeaSubject[] = [
  "sleep",
  "heart",
  "body",
  "training",
  "food",
  "goals",
];

/** The module each group needs switched on. */
const SUBJECT_MODULES: Record<CoachIdeaSubject, PersonModule | null> = {
  sleep: "sleep",
  heart: "heart",
  body: "body",
  training: "activity",
  food: "food",
  goals: null,
};

export const COACH_IDEA_SUBJECT_LABELS = {
  sleep: msg`Sleep`,
  heart: msg`Heart`,
  body: msg`Body`,
  training: msg`Training`,
  food: msg`Food`,
  goals: msg`Goals`,
} as const;

/** One general question per subject, for when the records suggest none. */
const FALLBACKS = {
  sleep: msg`How has my sleep been this week?`,
  heart: msg`How has my resting heart rate looked lately?`,
  body: msg`How is my weight trending this month?`,
  training: msg`How active have I been this week compared with last week?`,
  food: msg`What could I eat tonight to round out today's meals?`,
} as const;

export type CoachIdeaInput = {
  insights: InsightsResult["insights"];
  goals: ReadonlyArray<{ id: number; title: string; definition: { status?: string } }>;
  /** The readiness index, 0 to 100, or null when it is not available. */
  readinessScore: number | null;
  isEnabled: (module: PersonModule) => boolean;
  settings?: ProductDisplaySettings | null;
};

/** The most ideas a group holds. */
const PER_GROUP = 3;

export function coachIdeas(i18n: I18n, input: CoachIdeaInput): CoachIdeaGroup[] {
  const groups = new Map<CoachIdeaSubject, CoachIdea[]>();
  const add = (subject: CoachIdeaSubject, key: string, text: string) => {
    const list = groups.get(subject) ?? [];
    if (list.length < PER_GROUP && !list.some((idea) => idea.key === key)) {
      list.push({ key, text });
    }
    groups.set(subject, list);
  };

  for (const insight of input.insights) {
    const detail = insight.detail;
    if (detail.type === "change") {
      const difference = formatInsightValue(i18n, detail.difference, detail.unit, input.settings);
      const recent = formatInsightValue(i18n, detail.recentValue, detail.unit, input.settings);
      const direction = detail.direction;
      if (detail.metric === "sleep_duration") {
        add(
          "sleep",
          insight.id,
          i18n._(
            msg`Why is my sleep ${difference} ${select(direction, { higher: "above", other: "below" })} my usual this week?`,
          ),
        );
      } else if (detail.metric === "resting_heart_rate") {
        add(
          "heart",
          insight.id,
          i18n._(
            msg`What changed when my resting heart rate went ${select(direction, { higher: "up", other: "down" })} to ${recent}?`,
          ),
        );
      } else if (detail.metric === "steps") {
        add(
          "training",
          insight.id,
          i18n._(
            msg`Why are my steps ${select(direction, { higher: "up", other: "down" })} by ${difference} this week?`,
          ),
        );
      }
    } else if (detail.type === "trend") {
      const weeks = Math.max(1, Math.round(detail.windowDays / 7));
      add(
        "body",
        insight.id,
        i18n._(
          msg`What's behind my weight trend over the last ${plural(weeks, { one: "week", other: "# weeks" })}?`,
        ),
      );
    }
  }

  for (const goal of input.goals) {
    const status = goal.definition.status;
    if (status === "paused" || status === "completed") continue;
    const title = goal.title;
    add("goals", `goal:${goal.id}`, i18n._(msg`Am I on track for “${title}”?`));
  }

  if (input.readinessScore !== null) {
    const score = input.readinessScore;
    add(
      "training",
      "readiness",
      i18n._(msg`Plan this week's workouts around a readiness of ${score}`),
    );
  }

  // Every switched-on subject offers at least its general question; goals
  // only show when there are some.
  return SUBJECTS.flatMap((subject) => {
    const module = SUBJECT_MODULES[subject];
    if (module !== null && !input.isEnabled(module)) return [];
    if (subject !== "goals") add(subject, `general:${subject}`, i18n._(FALLBACKS[subject]));
    const ideas = groups.get(subject) ?? [];
    return ideas.length > 0 ? [{ subject, ideas }] : [];
  });
}
