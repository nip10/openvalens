import type { GoalDefinition } from "@openvalens/plans/goal-model";

/**
 * A goal typed in the person's own words (the setup step and the profile),
 * saved through `goals.create` so it shows on the Goals page. It starts as a
 * daily "did it" check-in the person ticks themselves; nothing is measured or
 * suggested for them, and they can set a target and date later on Goals.
 */
export function freeTextGoalDefinition(
  title: string,
  now: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): GoalDefinition {
  return {
    id: globalThis.crypto.randomUUID(),
    title: title.trim(),
    source: "manual",
    metric: "personal",
    unit: null,
    rule: { kind: "recurring", cadence: "daily" },
    startDate: new Intl.DateTimeFormat("en-CA", { timeZone }).format(now),
    timeZone,
    dayCutoff: null,
    status: "active",
    milestones: [],
  };
}

/** The `goals.create` input for a goal typed in the person's own words. */
export function freeTextGoalInput(title: string) {
  return {
    definition: freeTextGoalDefinition(title),
    clientMutationId: globalThis.crypto.randomUUID(),
  };
}
