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
import { Plus } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Icon, InfoTip, Prose } from "@/components/bloom";
import { useModules } from "@/lib/modules/use-modules";
import { orpc } from "@/utils/orpc";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localDate = () => new Intl.DateTimeFormat("en-CA").format(new Date());

/** goals#4: "On track for 23 Nov (estimate)", the same estimate the web shows. */
export function GoalProjectionLine({
  goal,
}: {
  goal: Pick<GoalSummary, "definition" | "evaluation">;
}) {
  const { i18n } = useLingui();
  const projection = projectGoalTarget(goal.definition, goal.evaluation);
  if (!projection) return null;
  const text = goalProjectionText(i18n, projection);
  return (
    <View className="flex-row flex-wrap items-center gap-1">
      <Text className="shrink font-sans text-sm text-ink-3">{text}</Text>
      <InfoTip title={text}>
        <Prose>{i18n._(GOAL_IDEAS_COPY.projectionExplanation)}</Prose>
      </InfoTip>
    </View>
  );
}

/** goals#7: one-tap goal ideas from the member's own records; a tap fills the editor. */
export function GoalIdeas({
  goals,
  onPick,
}: {
  goals: readonly Pick<GoalSummary, "definition">[];
  onPick: (seed: GoalDefinition) => void;
}) {
  const { i18n } = useLingui();
  const modules = useModules();
  const ideas = useQuery(
    orpc.goals.suggestions.queryOptions({ input: { timeZone: deviceZone() } }),
  );
  const fresh = freshGoalSuggestions(
    (ideas.data ?? []).filter((idea) => {
      const module = GOAL_SOURCE_MODULES[idea.source];
      return module === null || modules.isEnabled(module);
    }),
    goals,
  );
  if (!fresh.length) return null;
  const title = i18n._(GOAL_IDEAS_COPY.ideasTitle);
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1">
        <Text className="font-sans text-sm text-ink-3">{title}</Text>
        <InfoTip title={title}>
          <Prose>{i18n._(GOAL_IDEAS_COPY.ideasExplanation)}</Prose>
        </InfoTip>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {fresh.map((idea) => {
          const view = goalSuggestionView(i18n, idea);
          return (
            <Pressable
              key={view.key}
              accessibilityRole="button"
              accessibilityLabel={`${view.label}. ${view.basis}`}
              onPress={() =>
                onPick(
                  goalSuggestionSeed(i18n, idea, {
                    id: globalThis.crypto.randomUUID(),
                    startDate: localDate(),
                    timeZone: deviceZone(),
                  }),
                )
              }
              className="min-h-11 flex-row items-center gap-2 rounded-full border border-rule-2 bg-paper px-3.5 py-2"
            >
              <Icon icon={Plus} size={15} color="signal" />
              <View className="shrink">
                <Text className="font-sans text-sm font-semibold text-ink">{view.label}</Text>
                <Text className="font-sans text-xs text-ink-3">{view.basis}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
