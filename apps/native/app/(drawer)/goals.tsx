import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { GoalSummary } from "@openvalens/plans/personal-goals";
import type { GoalComparator, GoalRule } from "@openvalens/plans/goal-model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button, Spinner } from "heroui-native";
import { Check, Plus, Target, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatusPill,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { GoalEditor } from "@/components/goal-editor";
import { orpc } from "@/utils/orpc";
import { goalActionKind, parseManualGoalValue } from "@/utils/goal-ui";

const mutationId = () => globalThis.crypto.randomUUID();

export default function GoalsScreen() {
  const { t } = useLingui();
  const client = useQueryClient();
  const goals = useQuery(orpc.goals.list.queryOptions({ input: {} }));
  const [creating, setCreating] = useState(false);
  const refresh = () => void client.invalidateQueries({ queryKey: orpc.goals.key() });
  const status = useMutation(orpc.goals.setStatus.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(orpc.goals.delete.mutationOptions({ onSuccess: refresh }));

  if (goals.isPending)
    return (
      <Container>
        <Page>
          <PageHeader title={<Trans>Goals</Trans>} />
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );
  if (goals.isError || !goals.data)
    return (
      <Container>
        <Page>
          <PageHeader title={<Trans>Goals</Trans>} />
          <ErrorState
            title={<Trans>Could not load goals.</Trans>}
            action={
              <Button variant="outline" onPress={() => void goals.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const active = goals.data.filter(
    (goal) => goal.definition.status === "active" && !goal.evaluation.achieved,
  );
  const paused = goals.data.filter((goal) => goal.definition.status === "paused");
  const completed = goals.data.filter(
    (goal) =>
      goal.definition.status === "completed" ||
      (goal.definition.status === "active" && goal.evaluation.achieved),
  );

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl refreshing={goals.isRefetching} onRefresh={() => void goals.refetch()} />
        ),
      }}
    >
      <Page>
        <PageHeader title={<Trans>Goals</Trans>} />
        <View className="gap-3">
          <View>
            <Text className="font-display text-2xl font-medium text-ink">{t`Today`}</Text>
            <Text className="text-sm text-ink-3">{t`What needs attention today, followed by your longer-term progress.`}</Text>
          </View>
          <Button onPress={() => setCreating((value) => !value)}>
            <Plus size={17} />
            <Button.Label>{creating ? t`Close` : t`Add a goal`}</Button.Label>
          </Button>
        </View>
        {creating ? (
          <GoalEditor
            onSaved={() => {
              setCreating(false);
              refresh();
            }}
          />
        ) : null}
        {active.length ? (
          <GoalSection
            goals={active}
            onRefresh={refresh}
            onStatus={(goal, next) =>
              status.mutate({
                id: goal.id,
                version: goal.version,
                status: next,
                clientMutationId: mutationId(),
              })
            }
            onDelete={(goal) =>
              Alert.alert(t`Delete this goal?`, t`Its source records will remain.`, [
                { text: t`Cancel`, style: "cancel" },
                {
                  text: t`Delete`,
                  style: "destructive",
                  onPress: () =>
                    remove.mutate({
                      id: goal.id,
                      version: goal.version,
                      clientMutationId: mutationId(),
                    }),
                },
              ])
            }
          />
        ) : !creating ? (
          <EmptyState
            icon={Target}
            title={<Trans>Nothing active today</Trans>}
            description={<Trans>Create a goal or review paused and completed goals below.</Trans>}
          />
        ) : null}
        <GoalArchive title={t`Paused`} goals={paused} />
        <GoalArchive title={t`Completed`} goals={completed} />
        {status.isError || remove.isError ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {status.error?.message ?? remove.error?.message ?? t`Could not update goal. Try again.`}
          </Text>
        ) : null}
      </Page>
    </Container>
  );
}

function GoalSection({
  goals,
  onRefresh,
  onStatus,
  onDelete,
}: {
  goals: GoalSummary[];
  onRefresh: () => void;
  onStatus: (goal: GoalSummary, status: "paused" | "completed") => void;
  onDelete: (goal: GoalSummary) => void;
}) {
  const { t } = useLingui();
  return (
    <Section title={t`Active`}>
      <View className="gap-3">
        {goals.map((goal) => (
          <GoalTodayCard
            key={goal.id}
            goal={goal}
            onRefresh={onRefresh}
            onStatus={onStatus}
            onDelete={onDelete}
          />
        ))}
      </View>
    </Section>
  );
}

function GoalTodayCard({
  goal,
  onRefresh,
  onStatus,
  onDelete,
}: {
  goal: GoalSummary;
  onRefresh: () => void;
  onStatus: (goal: GoalSummary, status: "paused" | "completed") => void;
  onDelete: (goal: GoalSummary) => void;
}) {
  const { t, i18n } = useLingui();
  const day = goal.evaluation.days.find(
    (item) => item.date === localDate(goal.definition.timeZone, goal.definition.dayCutoff),
  );
  const rule = goal.definition.rule;
  const currentWeek =
    rule.kind === "recurring" && rule.cadence !== "daily"
      ? goal.evaluation.recurringWeeks.find(
          (week) => week.weekStart <= goal.evaluation.asOf && week.weekEnd >= goal.evaluation.asOf,
        )
      : undefined;
  const status = goal.evaluation.overdue ? t`Overdue · still active` : t`Active`;
  return (
    <Sheet className="gap-3 p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Link href={{ pathname: "/goals/[goalId]", params: { goalId: String(goal.id) } }} asChild>
            <Pressable accessibilityRole="link">
              <Text className="font-display text-lg font-semibold text-ink">{goal.title}</Text>
            </Pressable>
          </Link>
          <Text className="text-sm text-ink-3">
            {ruleText(rule, i18n)}
            {goal.definition.unit ? ` · ${goal.definition.unit}` : ""}
          </Text>
        </View>
        <StatusPill tone={goal.evaluation.overdue ? "neutral" : "good"}>{status}</StatusPill>
      </View>
      <RuleProgress goal={goal} currentWeek={currentWeek} dayState={day?.state} />
      <Text className="text-sm text-ink-3">{todayCopy(day?.state, currentWeek, i18n)}</Text>
      <Action goal={goal} onRefresh={onRefresh} />
      <View className="flex-row flex-wrap gap-2">
        <Link href={{ pathname: "/goals/[goalId]", params: { goalId: String(goal.id) } }} asChild>
          <Pressable className="min-h-10 justify-center rounded-xl px-3" accessibilityRole="link">
            <Text className="font-semibold text-signal">{t`Progress and history`}</Text>
          </Pressable>
        </Link>
        <Button size="sm" variant="outline" onPress={() => onStatus(goal, "paused")}>
          <Button.Label>{t`Pause`}</Button.Label>
        </Button>
        {!goal.evaluation.achieved ? (
          <Button size="sm" variant="outline" onPress={() => onStatus(goal, "completed")}>
            <Check size={15} />
            <Button.Label>{t`Complete`}</Button.Label>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onPress={() => onDelete(goal)}>
          <Trash2 size={16} />
          <Button.Label>{t`Delete`}</Button.Label>
        </Button>
      </View>
    </Sheet>
  );
}

function Action({ goal, onRefresh }: { goal: GoalSummary; onRefresh: () => void }) {
  const { t } = useLingui();
  const [value, setValue] = useState("");
  const save = useMutation(
    orpc.goals.createCheckin.mutationOptions({
      onSuccess: () => {
        setValue("");
        onRefresh();
      },
    }),
  );
  const date = localDate(goal.definition.timeZone, goal.definition.dayCutoff);
  const actionKind = goalActionKind(
    goal.definition.source,
    goal.definition.status,
    goal.definition.rule,
    goal.definition.unit,
  );
  if (actionKind === "none") return null;
  if (actionKind === "supplement-intake")
    return <SupplementGoalAction goal={goal} onRefresh={onRefresh} />;
  if (actionKind === "water-diary")
    return (
      <Link href="/(drawer)/(tabs)/nutrition" asChild>
        <Pressable className="self-start rounded-xl bg-food-soft px-3 py-2">
          <Text className="font-semibold text-ink">{t`Log water`}</Text>
        </Pressable>
      </Link>
    );
  if (actionKind === "sleep-records")
    return (
      <Text className="text-xs text-ink-3">{t`Sleep imports count automatically. Uncertain history is not included.`}</Text>
    );
  if (actionKind === "workout-records")
    return (
      <Text className="text-xs text-ink-3">{t`Matched actual lifts count automatically.`}</Text>
    );
  if (actionKind === "manual-completion")
    return (
      <View className="gap-1">
        <Button
          size="sm"
          variant="outline"
          isDisabled={save.isPending}
          onPress={() =>
            save.mutate({ goalId: goal.id, date, completed: true, clientMutationId: mutationId() })
          }
        >
          <Check size={15} />
          <Button.Label>{save.isPending ? t`Saving…` : t`Mark done today`}</Button.Label>
        </Button>
        {save.isError ? (
          <Text accessibilityRole="alert" className="text-xs text-destructive">
            {save.error.message ?? t`Could not save. Try again.`}
          </Text>
        ) : null}
      </View>
    );
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <TextInput
        accessibilityLabel={t`Today's goal value`}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder={goal.definition.unit ? `${t`Today`} (${goal.definition.unit})` : t`Log today`}
        className="min-w-32 flex-1 rounded-xl border border-border p-3 text-ink"
      />
      <Button
        size="sm"
        variant="outline"
        isDisabled={!value.trim() || save.isPending}
        onPress={() => {
          const amount = parseManualGoalValue(value);
          if (amount !== null)
            save.mutate({ goalId: goal.id, date, value: amount, clientMutationId: mutationId() });
        }}
      >
        <Button.Label>{save.isPending ? t`Saving…` : t`Log today`}</Button.Label>
      </Button>
      {save.isError ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {save.error.message ?? t`Could not save. Try again.`}
        </Text>
      ) : null}
    </View>
  );
}

function SupplementGoalAction({ goal, onRefresh }: { goal: GoalSummary; onRefresh: () => void }) {
  const { t } = useLingui();
  const client = useQueryClient();
  const [dose, setDose] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString());
  const [mutationKey, setMutationKey] = useState("");
  const supplementId = Number(goal.definition.metric.slice("supplement:".length));
  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const selected = supplements.data?.find((item) => item.id === supplementId);
  const save = useMutation(
    orpc.supplementIntake.create.mutationOptions({
      onSuccess: async () => {
        setMutationKey("");
        setDose("");
        await client.invalidateQueries({ queryKey: orpc.supplementIntake.key() });
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        onRefresh();
      },
    }),
  );
  if (supplements.isPending)
    return <Text className="text-sm text-ink-3">{t`Loading selected supplement…`}</Text>;
  if (supplements.isError || !selected)
    return (
      <Text
        accessibilityRole="alert"
        className="text-sm text-destructive"
      >{t`Could not load the selected supplement. Open Supplements to retry.`}</Text>
    );
  return (
    <View className="gap-2">
      <Text className="text-xs text-ink-3">{t`Log the dose actually taken. Each dose is kept; goal credit is once per day.`}</Text>
      <TextInput
        accessibilityLabel={t`Dose actually taken`}
        value={dose}
        onChangeText={setDose}
        placeholder={selected.dose ?? undefined}
        className="rounded-xl border border-border p-3 text-ink"
      />
      <TextInput
        accessibilityLabel={t`Date and time taken`}
        value={occurredAt}
        onChangeText={setOccurredAt}
        placeholder="2026-11-02T09:00:00.000Z"
        className="rounded-xl border border-border p-3 text-ink"
      />
      <Button
        size="sm"
        variant="outline"
        isDisabled={save.isPending}
        onPress={() => {
          const id = mutationKey || mutationId();
          setMutationKey(id);
          save.mutate({
            supplementId,
            occurredAt,
            timeZone: goal.definition.timeZone,
            dose: dose.trim() || selected.dose || "",
            clientMutationId: id,
          });
        }}
      >
        <Button.Label>{save.isPending ? t`Saving…` : t`Log actual dose`}</Button.Label>
      </Button>
      {save.isError ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {save.error.message ?? t`Could not save. Retry the same dose.`}
        </Text>
      ) : null}
    </View>
  );
}

function RuleProgress({
  goal,
  currentWeek,
  dayState,
}: {
  goal: GoalSummary;
  currentWeek?: GoalSummary["evaluation"]["recurringWeeks"][number];
  dayState?: string;
}) {
  const { t, i18n } = useLingui();
  const rule = goal.definition.rule;
  const evaluation = goal.evaluation;
  if (rule.kind === "average") {
    const coverage = evaluation.windowCoverage;
    return (
      <Sheet className="gap-1 bg-paper-2 p-3">
        <Text className="font-semibold text-ink">
          {evaluation.currentValue === null
            ? t`No average yet`
            : `${evaluation.currentValue} ${goal.definition.unit ?? ""}`}
        </Text>
        <Text className="text-xs text-ink-3">
          {coverage?.complete
            ? t`Complete ${rule.windowDays ?? 7}-day average`
            : t`Provisional · ${coverage?.coveredDays ?? 0} of ${coverage?.requiredDays ?? rule.windowDays ?? 7} days covered`}
        </Text>
      </Sheet>
    );
  }
  if (rule.kind === "streak")
    return (
      <View className="gap-1">
        <Text className="font-semibold text-ink">{t`${evaluation.currentStreak} of ${rule.targetDays} consecutive days`}</Text>
        <Text className="text-xs text-ink-3">{t`Best run: ${evaluation.bestStreak} days`}</Text>
      </View>
    );
  if (rule.kind === "recurring") {
    if (rule.cadence === "daily")
      return <Text className="font-semibold text-ink">{dayLabel(dayState, i18n)}</Text>;
    return (
      <Text className="font-semibold text-ink">
        {currentWeek
          ? t`${currentWeek.qualifyingDays} of ${currentWeek.requiredDays} days this Monday–Sunday week`
          : t`Weekly tracking starts next Monday.`}
      </Text>
    );
  }
  return (
    <Text className="font-semibold text-ink">
      {comparatorLabel(rule.target, goal.definition.unit, i18n)}
      {evaluation.currentValue === null
        ? ` · ${t`No data yet`}`
        : ` · ${evaluation.currentValue} ${goal.definition.unit ?? ""}`}
    </Text>
  );
}

function GoalArchive({ title, goals }: { title: string; goals: GoalSummary[] }) {
  const { t } = useLingui();
  if (!goals.length) return null;
  return (
    <Section title={title}>
      <View className="gap-2">
        {goals.map((goal) => (
          <Link
            key={goal.id}
            href={{ pathname: "/goals/[goalId]", params: { goalId: String(goal.id) } }}
            asChild
          >
            <Pressable>
              <ListCard
                icon={Target}
                title={goal.title}
                subtitle={
                  goal.definition.status === "paused"
                    ? t`Paused`
                    : goal.evaluation.achieved
                      ? t`Evidence supports this achievement.`
                      : t`Completed`
                }
              />
            </Pressable>
          </Link>
        ))}
      </View>
    </Section>
  );
}

function dayLabel(state: string | undefined, i18n: I18n) {
  if (state === "qualifies") return i18n._(msg`Today's goal met`);
  if (state === "does-not-qualify") return i18n._(msg`Below target so far`);
  if (state === "not-scheduled") return i18n._(msg`Not scheduled today`);
  if (state === "paused") return i18n._(msg`Tracking paused`);
  return i18n._(msg`No record yet`);
}

function ruleText(rule: GoalRule, i18n: I18n) {
  if (rule.kind === "target") return i18n._(msg`One-time target`);
  if (rule.kind === "average") return i18n._(msg`Rolling average · ${rule.windowDays ?? 7} days`);
  if (rule.kind === "streak") return i18n._(msg`Consecutive days · ${rule.targetDays}`);
  if (rule.cadence === "daily") return i18n._(msg`Every day`);
  if (rule.cadence === "weekdays") return i18n._(msg`Selected weekdays`);
  return i18n._(msg`${rule.daysPerWeek!} days per Monday–Sunday week`);
}

function todayCopy(
  state: string | undefined,
  week: GoalSummary["evaluation"]["recurringWeeks"][number] | undefined,
  i18n: I18n,
) {
  if (state === "not-scheduled") return i18n._(msg`A non-scheduled day is not a miss.`);
  if (week) return i18n._(msg`The week remains open until Sunday.`);
  if (state === "unknown") return i18n._(msg`Missing data is unknown, not a miss.`);
  return i18n._(msg`Goal dates follow the goal timezone and cutoff.`);
}

function comparatorLabel(comparator: GoalComparator, unit: string | null | undefined, i18n: I18n) {
  const suffix = unit ? ` ${unit}` : "";
  if (comparator.kind === "minimum") return i18n._(msg`At least ${comparator.value}${suffix}`);
  if (comparator.kind === "maximum") return i18n._(msg`At most ${comparator.value}${suffix}`);
  return i18n._(msg`Between ${comparator.minimum} and ${comparator.maximum}${suffix}`);
}

function localDate(timeZone: string, cutoff?: string | null) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  if (cutoff && `${values.hour}:${values.minute}` < cutoff) {
    const previous = new Date(`${date}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
  }
  return date;
}
