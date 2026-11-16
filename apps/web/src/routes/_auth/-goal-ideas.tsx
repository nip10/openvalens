import { useLingui } from "@lingui/react/macro";
import {
  GOAL_IDEAS_COPY,
  goalProjectionText,
  goalSuggestionSeed,
  goalSuggestionView,
} from "@openvalens/api/presenters/goal-ideas";
import { GOAL_SOURCE_MODULES } from "@openvalens/api/presenters/modules";
import type { GoalDefinition } from "@openvalens/plans/goal-model";
import { projectGoalTarget } from "@openvalens/plans/goal-projection";
import { freshGoalSuggestions } from "@openvalens/plans/goal-suggestions";
import type { GoalSummary } from "@openvalens/plans/personal-goals";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Plus } from "lucide-react";

import { InfoTip, Section } from "@/components/page";
import { useEnabledModules } from "@/utils/modules";
import { orpc } from "@/utils/orpc";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localDate = () => new Intl.DateTimeFormat("en-CA").format(new Date());

/**
 * goals#4 (owner decision 2026-11-16): "On track for 23 Nov (estimate)" under
 * a one-time target, from a straight line through the last 4 weeks of values.
 * Nothing shows when the estimate would mislead (`projectGoalTarget`).
 */
export function GoalProjectionLine({
  goal,
}: {
  goal: Pick<GoalSummary, "definition" | "evaluation">;
}) {
  const { i18n } = useLingui();
  const projection = projectGoalTarget(goal.definition, goal.evaluation);
  if (!projection) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-sm text-ink-3">
      <span className="min-w-0">{goalProjectionText(i18n, projection)}</span>
      <InfoTip>
        <p>{i18n._(GOAL_IDEAS_COPY.projectionExplanation)}</p>
      </InfoTip>
    </p>
  );
}

/**
 * goals#7 (owner decision 2026-11-16): one-tap goal ideas from the member's
 * own records. A tap opens the goal editor with the idea filled in; nothing
 * is saved until the member saves. Ideas they already have a goal for are
 * left out, and nothing shows without data.
 */
export function GoalIdeas({
  goals,
  onPick,
  bare = false,
}: {
  goals: readonly Pick<GoalSummary, "definition">[];
  onPick: (seed: GoalDefinition) => void;
  /** Inside the Add goal dialog: a short line of chips, no section heading. */
  bare?: boolean;
}) {
  const { i18n } = useLingui();
  const ideas = useQuery(
    orpc.goals.suggestions.queryOptions({ input: { timeZone: deviceZone() } }),
  );
  const modules = useEnabledModules();
  // A module that is switched off offers no ideas, as it shows no insights (#500).
  const fresh = freshGoalSuggestions(
    (ideas.data ?? []).filter((idea) => {
      const module = GOAL_SOURCE_MODULES[idea.source];
      return module === null || modules.isEnabled(module);
    }),
    goals,
  );
  if (!fresh.length) return null;
  const chips = (
    <ul className="flex flex-wrap gap-2" aria-label={i18n._(GOAL_IDEAS_COPY.ideasTitle)}>
      {fresh.map((idea) => {
        const view = goalSuggestionView(i18n, idea);
        return (
          <li key={view.key}>
            <button
              type="button"
              onClick={() =>
                onPick(
                  goalSuggestionSeed(i18n, idea, {
                    id: globalThis.crypto.randomUUID(),
                    startDate: localDate(),
                    timeZone: deviceZone(),
                  }),
                )
              }
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3.5 py-1.5 text-left text-sm transition-colors hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus className="size-4 shrink-0 text-signal" aria-hidden="true" />
              <span className="font-medium text-ink">{view.label}</span>
              <span className="text-xs text-ink-3">{view.basis}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  if (bare)
    return (
      <div className="grid gap-2">
        <p className="flex items-center gap-1 text-sm text-ink-3">
          <span>{i18n._(GOAL_IDEAS_COPY.ideasTitle)}</span>
          <InfoTip>
            <p>{i18n._(GOAL_IDEAS_COPY.ideasExplanation)}</p>
          </InfoTip>
        </p>
        {chips}
      </div>
    );
  return (
    <Section
      icon={Lightbulb}
      tone="weight"
      title={i18n._(GOAL_IDEAS_COPY.ideasTitle)}
      info={<p>{i18n._(GOAL_IDEAS_COPY.ideasExplanation)}</p>}
    >
      {chips}
    </Section>
  );
}
