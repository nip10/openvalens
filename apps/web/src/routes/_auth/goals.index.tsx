import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { GoalSummary } from "@openvalens/plans/personal-goals";
import type { GoalComparator, GoalRule } from "@openvalens/plans/goal-model";
import { Button } from "@openvalens/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronRight, Pause, Play, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { MoreMenu, type MoreMenuItem } from "@/components/more-menu";
import {
  EmptyState,
  ErrorState,
  Meter,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { useLogDialog } from "@/components/quick-log/log-launcher";
import { orpc } from "@/utils/orpc";
import { GoalCheckinDialog } from "./-goal-checkin-dialog";
import { GoalEditor } from "./-goal-editor";
import {
  formatGoalValue,
  goalDate,
  goalDateLabel,
  goalListGroup,
  goalTargetGap,
  quickActionKind,
} from "./-goals-ui";

export const Route = createFileRoute("/_auth/goals/")({ component: GoalsPage });

const mutationId = () => globalThis.crypto.randomUUID();

/** Goals that take a typed value: the check-in dialog's list. */
function takesCheckin(goal: GoalSummary) {
  return (
    quickActionKind(
      goal.definition.source,
      goal.definition.status,
      goal.definition.rule,
      goal.definition.unit,
    ) === "manual-value"
  );
}

function GoalsPage() {
  const { t } = useLingui();
  const client = useQueryClient();
  const goals = useQuery(orpc.goals.list.queryOptions({ input: {} }));
  const [creating, setCreating] = useState(false);
  const [checkin, setCheckin] = useState<{ goalId: number | null } | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: orpc.goals.key() });
  const setStatus = useMutation(orpc.goals.setStatus.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(orpc.goals.delete.mutationOptions({ onSuccess: refresh }));

  const checkinGoals = (goals.data ?? []).filter(
    (goal) => goalListGroup(goal.definition, goal.evaluation) === "active" && takesCheckin(goal),
  );
  // The "+" and the palette's goal check-in open this page's dialog (goals#5).
  useLogDialog(
    "goal_checkin",
    checkinGoals.length > 0
      ? (target) => {
          const values = "values" in target ? target.values : undefined;
          const wanted = Number(values?.goal);
          setCheckin({
            goalId: checkinGoals.some((goal) => goal.id === wanted) ? wanted : null,
          });
        }
      : null,
  );

  const header = (
    <PageHeader
      title={<Trans>Goals</Trans>}
      info={
        <p>
          <Trans>
            Your personal goals, separate from workout plans. Missing records stay unknown, not
            zero.
          </Trans>
        </p>
      }
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          <Trans>Add a goal</Trans>
        </Button>
      }
    />
  );
  const createDialog = (
    <FormDialog
      open={creating}
      onOpenChange={setCreating}
      size="lg"
      title={<Trans>New goal</Trans>}
    >
      {creating ? (
        <GoalEditor
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      ) : null}
    </FormDialog>
  );

  if (goals.isPending)
    return (
      <Page>
        {header}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="sheet h-56 animate-pulse" />
          <div className="sheet h-56 animate-pulse" />
        </div>
        {createDialog}
      </Page>
    );
  if (goals.isError || !goals.data)
    return (
      <Page>
        {header}
        <ErrorState
          title={<Trans>Could not load goals.</Trans>}
          action={
            <Button variant="outline" onClick={() => void goals.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
        {createDialog}
      </Page>
    );

  const active = goals.data.filter(
    (goal) => goalListGroup(goal.definition, goal.evaluation) === "active",
  );
  const paused = goals.data.filter(
    (goal) => goalListGroup(goal.definition, goal.evaluation) === "paused",
  );
  const completed = goals.data.filter(
    (goal) => goalListGroup(goal.definition, goal.evaluation) === "completed",
  );
  const status = (goal: GoalSummary, next: "paused" | "completed" | "active") =>
    setStatus.mutate({
      id: goal.id,
      version: goal.version,
      status: next,
      clientMutationId: mutationId(),
    });
  const del = (goal: GoalSummary) => {
    if (window.confirm(t`Delete this goal? Its source records will remain.`))
      remove.mutate({ id: goal.id, version: goal.version, clientMutationId: mutationId() });
  };

  return (
    <Page>
      {header}
      <Section icon={Target} tone="weight" title={<Trans>Active</Trans>}>
        {active.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onRefresh={refresh}
                onCheckin={() => setCheckin({ goalId: goal.id })}
                menu={[
                  { label: t`Pause`, icon: Pause, onSelect: () => status(goal, "paused") },
                  ...(!goal.evaluation.achieved
                    ? [
                        {
                          label: t`Complete`,
                          icon: Check,
                          onSelect: () => status(goal, "completed"),
                        },
                      ]
                    : []),
                  { label: t`Delete`, icon: Trash2, destructive: true, onSelect: () => del(goal) },
                ]}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Target}
            title={<Trans>Nothing active</Trans>}
            description={<Trans>Add a goal, or resume a paused one below.</Trans>}
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                {t`Add a goal`}
              </Button>
            }
          />
        )}
      </Section>
      <GoalGroup
        title={t`Paused`}
        goals={paused}
        menu={(goal) => [
          { label: t`Resume`, icon: Play, onSelect: () => status(goal, "active") },
          { label: t`Delete`, icon: Trash2, destructive: true, onSelect: () => del(goal) },
        ]}
      />
      <GoalGroup
        title={t`Completed`}
        goals={completed}
        menu={(goal) => [
          { label: t`Delete`, icon: Trash2, destructive: true, onSelect: () => del(goal) },
        ]}
      />
      {setStatus.isError || remove.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {setStatus.error?.message ??
            remove.error?.message ??
            t`Could not update this goal. Refresh and try again.`}
        </p>
      ) : null}
      {createDialog}
      <GoalCheckinDialog
        open={checkin !== null}
        onOpenChange={(open) => {
          if (!open) setCheckin(null);
        }}
        goals={checkinGoals}
        goalId={checkin?.goalId ?? null}
        onSaved={refresh}
      />
    </Page>
  );
}

/** Every goal card has the same parts, with the footer pinned to the bottom (goals#5). */
function GoalCard({
  goal,
  onRefresh,
  onCheckin,
  menu,
}: {
  goal: GoalSummary;
  onRefresh: () => void;
  onCheckin: () => void;
  menu: MoreMenuItem[];
}) {
  const { t, i18n } = useLingui();
  const detail = goal.evaluation;
  const rule = goal.definition.rule;
  const today = goalDate(goal.definition.timeZone, goal.definition.dayCutoff);
  const day = detail.days.find((item) => item.date === today);
  const weekly =
    rule.kind === "recurring" && rule.cadence !== "daily"
      ? detail.recurringWeeks.find((item) => item.weekStart <= today && item.weekEnd >= today)
      : undefined;
  const cue = trackingCue(rule, day?.state, weekly, today, i18n);

  return (
    <li className="sheet flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <ToneIcon icon={Target} tone="weight" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Link
            to="/goals/$goalId"
            params={{ goalId: String(goal.id) }}
            className="font-semibold break-words text-ink hover:text-signal"
          >
            {goal.title}
          </Link>
          <p className="text-sm text-ink-3">{ruleDescription(rule, goal.definition.unit, i18n)}</p>
        </div>
        <StatusPill tone={detail.overdue ? "neutral" : "good"}>
          {detail.overdue ? t`Overdue · still active` : t`Active`}
        </StatusPill>
      </div>
      <RuleProgress goal={goal} />
      {cue ? <p className="text-sm text-ink-3">{cue}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <Link
          to="/goals/$goalId"
          params={{ goalId: String(goal.id) }}
          className="inline-flex min-h-9 items-center gap-1 rounded-full px-1 text-sm font-medium text-signal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t`Progress and history`}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <GoalAction goal={goal} onSaved={onRefresh} onCheckin={onCheckin} />
          <MoreMenu label={t`More for ${goal.title}`} items={menu} />
        </div>
      </div>
    </li>
  );
}

function RuleProgress({ goal }: { goal: GoalSummary }) {
  const { t, i18n } = useLingui();
  const rule = goal.definition.rule;
  const unit = goal.definition.unit;
  const evaluation = goal.evaluation;
  const box = (figure: string, line: string | null) => (
    <div className="grid gap-0.5 rounded-xl bg-paper-2 p-3">
      <p className="num font-display text-xl font-medium text-ink">{figure}</p>
      {line ? <p className="text-xs text-ink-3">{line}</p> : null}
    </div>
  );
  if (rule.kind === "streak")
    return (
      <div className="grid gap-1.5 rounded-xl bg-paper-2 p-3">
        <p className="num font-display text-xl font-medium text-ink">{t`${evaluation.currentStreak} of ${rule.targetDays} days in a row`}</p>
        <Meter value={Math.min(1, evaluation.currentStreak / rule.targetDays)} tone="weight" />
        <p className="text-xs text-ink-3">{t`Best run: ${evaluation.bestStreak} days`}</p>
      </div>
    );
  if (rule.kind === "recurring") {
    if (rule.cadence === "daily")
      return box(
        dailyStateLabel(evaluation.days.find((day) => day.date === evaluation.asOf)?.state, i18n),
        null,
      );
    const week = evaluation.recurringWeeks.find(
      (item) => item.weekStart <= evaluation.asOf && item.weekEnd >= evaluation.asOf,
    );
    if (!week) return box(t`Starts next week`, null);
    return box(
      t`${week.qualifyingDays} of ${week.requiredDays} days`,
      week.complete ? t`Week complete` : t`This week so far`,
    );
  }
  const current = evaluation.currentValue;
  const figure = current === null ? t`No data yet` : formatGoalValue(current, unit, i18n.locale);
  const gap = goalTargetGap(rule, current);
  const gapLine = gap
    ? gap.met
      ? t`Within your target`
      : t`${formatGoalValue(gap.gap, unit, i18n.locale)} to go`
    : null;
  if (rule.kind === "average") {
    const coverage = evaluation.windowCoverage;
    const partial =
      coverage && !coverage.complete
        ? t`${coverage.coveredDays} of ${coverage.requiredDays} days so far`
        : null;
    return box(figure, [gapLine, partial].filter(Boolean).join(" · ") || null);
  }
  return box(figure, gapLine);
}

/**
 * The card's one action, in the footer beside the ⋯: "Check in" for a goal you
 * type a value for, "Mark done today" for a yes-or-no goal, and a note for
 * goals that follow your records.
 */
function GoalAction({
  goal,
  onSaved,
  onCheckin,
}: {
  goal: GoalSummary;
  onSaved: () => void;
  onCheckin: () => void;
}) {
  const { t } = useLingui();
  const date = goalDate(goal.definition.timeZone, goal.definition.dayCutoff);
  const actionKind = quickActionKind(
    goal.definition.source,
    goal.definition.status,
    goal.definition.rule,
    goal.definition.unit,
  );
  const done = useMutation(orpc.goals.createCheckin.mutationOptions({ onSuccess: onSaved }));
  if (actionKind === "none") return null;
  if (actionKind === "manual-value")
    return (
      <Button size="sm" variant="outline" onClick={onCheckin}>
        {t`Check in`}
      </Button>
    );
  if (actionKind === "manual-completion")
    return (
      <span className="inline-flex items-center gap-2">
        {done.isError ? (
          <span role="alert" className="text-xs text-destructive">
            {done.error.message ?? t`Could not save. Try again.`}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={done.isPending}
          onClick={() =>
            done.mutate({
              goalId: goal.id,
              date,
              completed: true,
              clientMutationId: mutationId(),
            })
          }
        >
          <Check className="size-4" aria-hidden="true" />
          {done.isPending ? t`Saving…` : t`Mark done today`}
        </Button>
      </span>
    );
  return <span className="text-xs text-ink-3">{t`Updates from your records`}</span>;
}

function GoalGroup({
  title,
  goals,
  menu,
}: {
  title: string;
  goals: GoalSummary[];
  menu: (goal: GoalSummary) => MoreMenuItem[];
}) {
  const { t, i18n } = useLingui();
  if (!goals.length) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-3 md:grid-cols-2">
        {goals.map((goal) => (
          <li key={goal.id} className="sheet flex min-w-0 flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <ToneIcon icon={Target} tone="weight" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Link
                  to="/goals/$goalId"
                  params={{ goalId: String(goal.id) }}
                  className="font-semibold break-words text-ink hover:text-signal"
                >
                  {goal.title}
                </Link>
                <p className="text-sm text-ink-3">
                  {ruleDescription(goal.definition.rule, goal.definition.unit, i18n)}
                </p>
              </div>
              <StatusPill tone="neutral">
                {goal.definition.status === "paused" ? t`Paused` : t`Completed`}
              </StatusPill>
            </div>
            <p className="text-sm text-ink-3">
              {goal.definition.status === "paused"
                ? t`Paused. Resume when you're ready.`
                : goal.evaluation.achieved
                  ? t`Evidence supports this achievement.`
                  : t`Completed by you.`}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-rule pt-3">
              <Link
                to="/goals/$goalId"
                params={{ goalId: String(goal.id) }}
                className="inline-flex min-h-9 items-center gap-1 rounded-full px-1 text-sm font-medium text-signal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t`Progress and history`}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
              <div className="ml-auto">
                <MoreMenu label={t`More for ${goal.title}`} items={menu(goal)} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The goal's rule in one line, with its target (goals#6): "Average over 7 days · target 7h 30m". */
function ruleDescription(rule: GoalRule, unit: string | null | undefined, i18n: I18n) {
  if (rule.kind === "target") {
    const target = comparatorDescription(rule.target, unit, i18n);
    return rule.targetDate
      ? i18n._(msg`${target} by ${goalDateLabel(rule.targetDate, i18n.locale)}`)
      : target;
  }
  if (rule.kind === "average") {
    const days = rule.windowDays ?? 7;
    const target = comparatorDescription(rule.target, unit, i18n);
    return i18n._(msg`Average over ${days} days · ${target}`);
  }
  if (rule.kind === "streak") return i18n._(msg`${rule.targetDays} days in a row`);
  if (rule.cadence === "daily") return i18n._(msg`Every day`);
  if (rule.cadence === "any-days-per-week") {
    const days = rule.daysPerWeek ?? 0;
    return i18n._(msg`${days} days a week`);
  }
  return i18n._(msg`Selected weekdays`);
}

function comparatorDescription(
  comparator: GoalComparator,
  unit: string | null | undefined,
  i18n: I18n,
) {
  const value = (amount: number) => formatGoalValue(amount, unit, i18n.locale);
  if (comparator.kind === "minimum") return i18n._(msg`Target at least ${value(comparator.value)}`);
  if (comparator.kind === "maximum") return i18n._(msg`Target at most ${value(comparator.value)}`);
  const low = value(comparator.minimum);
  const high = value(comparator.maximum);
  return i18n._(msg`Target ${low} to ${high}`);
}

function dailyStateLabel(state: string | undefined, i18n: I18n) {
  if (state === "qualifies") return i18n._(msg`Today’s target met`);
  if (state === "does-not-qualify") return i18n._(msg`Below target so far`);
  if (state === "not-scheduled") return i18n._(msg`Not scheduled today`);
  if (state === "paused") return i18n._(msg`Tracking paused`);
  return i18n._(msg`No record yet`);
}

/** One line under the figure for weekly goals; nothing for the rest (no boilerplate, goals#6). */
function trackingCue(
  rule: GoalRule,
  dailyState: string | undefined,
  week: GoalSummary["evaluation"]["recurringWeeks"][number] | undefined,
  today: string,
  i18n: I18n,
): string | null {
  if (rule.kind !== "recurring" || rule.cadence === "daily") return null;
  if (dailyState === "not-scheduled")
    return i18n._(msg`Not scheduled today; this is not a missed goal day.`);
  if (!week || week.weekStart > today)
    return i18n._(msg`The next Monday to Sunday week has not started.`);
  return null;
}
