import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { GoalSummary } from "@openvalens/plans/personal-goals";
import type { GoalComparator, GoalRule } from "@openvalens/plans/goal-model";
import { trackerIdFromGoalMetric } from "@openvalens/plans/goal-tracker";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  Meter,
  Page,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/page";
import { orpc } from "@/utils/orpc";
import { GoalEditor } from "./-goal-editor";
import { goalListGroup, parseManualAmount, quickActionKind } from "./-goals-ui";

export const Route = createFileRoute("/_auth/goals/")({ component: GoalsPage });

const mutationId = () => globalThis.crypto.randomUUID();
const goalDate = (timeZone: string, cutoff?: string | null) => {
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
};

function GoalsPage() {
  const { t } = useLingui();
  const client = useQueryClient();
  const goals = useQuery(orpc.goals.list.queryOptions({ input: {} }));
  const [creating, setCreating] = useState(false);
  const refresh = () => void client.invalidateQueries({ queryKey: orpc.goals.key() });
  const setStatus = useMutation(orpc.goals.setStatus.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(orpc.goals.delete.mutationOptions({ onSuccess: refresh }));

  if (goals.isPending)
    return (
      <Page>
        <PageHeader title={<Trans>Goals</Trans>} />
        <div className="sheet h-48 animate-pulse" />
      </Page>
    );
  if (goals.isError || !goals.data)
    return (
      <Page>
        <PageHeader title={<Trans>Goals</Trans>} />
        <ErrorState
          title={<Trans>Could not load goals.</Trans>}
          action={
            <Button variant="outline" onClick={() => void goals.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
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

  return (
    <Page>
      <PageHeader
        title={<Trans>Goals</Trans>}
        info={
          <p>
            <Trans>
              Your personal goals, separate from workout plans. Missing records stay unknown—not
              zero.
            </Trans>
          </p>
        }
      />
      <section className="grid gap-4" aria-labelledby="today-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="today-heading"
              className="font-display text-2xl font-medium text-ink"
            >{t`Today`}</h2>
            <p className="mt-1 text-sm text-ink-3">{t`See what needs attention, then browse longer-term progress below.`}</p>
          </div>
          <Button onClick={() => setCreating((value) => !value)}>
            <Plus className="mr-2 size-4" />
            {creating ? t`Close` : t`Add a goal`}
          </Button>
        </div>
        {creating ? (
          <Section title={<Trans>New goal</Trans>}>
            <GoalEditor
              onSaved={() => {
                setCreating(false);
                refresh();
              }}
            />
          </Section>
        ) : null}
        {active.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onRefresh={refresh}
                onStatus={(status) =>
                  setStatus.mutate({
                    id: goal.id,
                    version: goal.version,
                    status,
                    clientMutationId: mutationId(),
                  })
                }
                onDelete={() => {
                  if (window.confirm(t`Delete this goal? Its source records will remain.`))
                    remove.mutate({
                      id: goal.id,
                      version: goal.version,
                      clientMutationId: mutationId(),
                    });
                }}
              />
            ))}
          </ul>
        ) : !creating ? (
          <EmptyState
            icon={Check}
            title={<Trans>Nothing active today</Trans>}
            description={<Trans>Add a goal or review paused and completed goals below.</Trans>}
            action={<Button onClick={() => setCreating(true)}>{t`Create a goal`}</Button>}
          />
        ) : null}
      </section>
      <GoalGroup title={t`Paused`} goals={paused} />
      <GoalGroup title={t`Completed`} goals={completed} />
      {setStatus.isError || remove.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {setStatus.error?.message ??
            remove.error?.message ??
            t`Could not update this goal. Refresh and try again.`}
        </p>
      ) : null}
    </Page>
  );
}

function GoalCard({
  goal,
  onRefresh,
  onStatus,
  onDelete,
}: {
  goal: GoalSummary;
  onRefresh: () => void;
  onStatus: (status: "paused" | "completed" | "active") => void;
  onDelete: () => void;
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
  const sourceLabel = trackingCue(rule, day?.state, weekly, today, i18n);

  return (
    <li className="sheet grid content-start gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to="/goals/$goalId"
            params={{ goalId: String(goal.id) }}
            className="inline-flex items-center gap-1 font-semibold text-ink hover:text-signal"
          >
            {goal.title}
            <ChevronRight className="size-4" />
          </Link>
          <p className="mt-1 text-sm text-ink-3">
            {ruleDescription(rule)}
            {goal.definition.unit ? ` · ${goal.definition.unit}` : ""}
          </p>
        </div>
        <StatusPill tone={detail.overdue ? "neutral" : "good"}>
          {detail.overdue ? t`Overdue · still active` : t`Active`}
        </StatusPill>
      </div>
      <RuleProgress goal={goal} />
      <p className="text-sm text-ink-3">{sourceLabel}</p>
      <QuickAction goal={goal} onSaved={onRefresh} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <Link
          to="/goals/$goalId"
          params={{ goalId: String(goal.id) }}
          className="inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-medium text-signal hover:bg-muted"
        >{t`Progress and history`}</Link>
        <Button size="sm" variant="outline" onClick={() => onStatus("paused")}>{t`Pause`}</Button>
        {!detail.achieved ? (
          <Button size="sm" variant="outline" onClick={() => onStatus("completed")}>
            <Check className="mr-1 size-4" />
            {t`Complete`}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-label={t`Delete goal`} onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function RuleProgress({ goal }: { goal: GoalSummary }) {
  const { t, i18n } = useLingui();
  const rule = goal.definition.rule;
  const evaluation = goal.evaluation;
  if (rule.kind === "average") {
    const coverage = evaluation.windowCoverage;
    const shown =
      evaluation.currentValue === null
        ? t`No data yet`
        : `${evaluation.currentValue} ${goal.definition.unit ?? ""}`;
    return (
      <div className="rounded-xl bg-paper-2 p-3">
        <p className="font-semibold text-ink">{shown}</p>
        <p className="text-xs text-ink-3">
          {coverage?.complete
            ? t`Complete ${rule.windowDays ?? 7}-day average`
            : t`Provisional · ${coverage?.coveredDays ?? 0} of ${coverage?.requiredDays ?? rule.windowDays ?? 7} days covered`}
        </p>
      </div>
    );
  }
  if (rule.kind === "streak")
    return (
      <div className="grid gap-1">
        <p className="font-semibold text-ink">{t`${evaluation.currentStreak} of ${rule.targetDays} consecutive days`}</p>
        <p className="text-xs text-ink-3">{t`Best run: ${evaluation.bestStreak} days`}</p>
        <Meter value={Math.min(1, evaluation.currentStreak / rule.targetDays)} tone="weight" />
      </div>
    );
  if (rule.kind === "recurring") {
    if (rule.cadence === "daily")
      return (
        <p className="font-semibold text-ink">
          {dailyStateLabel(
            evaluation.days.find((day) => day.date === evaluation.asOf)?.state,
            i18n,
          )}
        </p>
      );
    const week = evaluation.recurringWeeks.find(
      (item) => item.weekStart <= evaluation.asOf && item.weekEnd >= evaluation.asOf,
    );
    if (!week)
      return (
        <p className="text-sm text-ink-3">{t`This week's tracking starts with the next eligible week.`}</p>
      );
    return (
      <div className="rounded-xl bg-paper-2 p-3">
        <p className="font-semibold text-ink">{t`${week.qualifyingDays} of ${week.requiredDays} days this week`}</p>
        <p className="text-xs text-ink-3">
          {week.complete ? t`Week complete` : t`Week still in progress`} · {week.weekStart}–
          {week.weekEnd}
        </p>
      </div>
    );
  }
  const target = comparatorDescription(rule.target, goal.definition.unit, i18n);
  const current = evaluation.currentValue;
  return (
    <div className="rounded-xl bg-paper-2 p-3">
      <p className="font-semibold text-ink">
        {current === null ? t`No data yet` : `${current} ${goal.definition.unit ?? ""}`}
      </p>
      <p className="text-xs text-ink-3">
        {target}
        {rule.targetDate ? ` · ${rule.targetDate}` : ""}
      </p>
    </div>
  );
}

function QuickAction({ goal, onSaved }: { goal: GoalSummary; onSaved: () => void }) {
  const { t } = useLingui();
  const [value, setValue] = useState("");
  const date = goalDate(goal.definition.timeZone, goal.definition.dayCutoff);
  const actionKind = quickActionKind(
    goal.definition.source,
    goal.definition.status,
    goal.definition.rule,
    goal.definition.unit,
  );
  const checkin = useMutation(
    orpc.goals.createCheckin.mutationOptions({
      onSuccess: () => {
        setValue("");
        onSaved();
      },
    }),
  );
  if (actionKind === "none") return null;
  if (actionKind === "supplement-intake") {
    const supplementId = Number(goal.definition.metric.slice("supplement:".length));
    return (
      <SupplementGoalLogger
        supplementId={supplementId}
        timeZone={goal.definition.timeZone}
        onSaved={onSaved}
      />
    );
  }
  if (actionKind === "water-diary")
    return (
      <Link
        to="/nutrition"
        className="inline-flex min-h-9 w-fit items-center rounded-xl bg-food-soft px-3 text-sm font-medium text-ink"
      >{t`Log water`}</Link>
    );
  if (actionKind === "tracker-entries") {
    const trackerId = trackerIdFromGoalMetric(goal.definition.metric);
    return trackerId ? (
      <Link
        to="/trackers/$trackerId"
        params={{ trackerId }}
        className="inline-flex min-h-9 w-fit items-center rounded-xl bg-paper-2 px-3 text-sm font-medium text-ink"
      >{t`Log in the tracker`}</Link>
    ) : null;
  }
  if (actionKind === "sleep-records" || actionKind === "workout-records")
    return (
      <p className="text-xs text-ink-3">
        {actionKind === "sleep-records"
          ? t`Sleep records are imported automatically.`
          : t`Matched workout lifts are counted automatically.`}
      </p>
    );
  if (actionKind === "manual-completion")
    return (
      <div className="grid justify-items-start gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={checkin.isPending}
          onClick={() =>
            checkin.mutate({
              goalId: goal.id,
              date,
              completed: true,
              clientMutationId: mutationId(),
            })
          }
        >
          <Check className="mr-1 size-4" />
          {checkin.isPending ? t`Saving…` : t`Mark done today`}
        </Button>
        {checkin.isError ? (
          <span role="alert" className="text-xs text-destructive">
            {checkin.error.message ?? t`Could not save. Try again.`}
          </span>
        ) : null}
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const amount = parseManualAmount(value);
        if (amount !== null)
          checkin.mutate({ goalId: goal.id, date, value: amount, clientMutationId: mutationId() });
      }}
    >
      <Input
        aria-label={t`Today's value`}
        className="h-9 w-32"
        type="number"
        step="any"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={goal.definition.unit ? t`Today (${goal.definition.unit})` : t`Log today`}
      />
      <Button
        size="sm"
        variant="outline"
        type="submit"
        disabled={!value.trim() || checkin.isPending}
      >
        {checkin.isPending ? t`Saving…` : t`Log today`}
      </Button>
      {checkin.isError ? (
        <span role="alert" className="text-xs text-destructive">
          {checkin.error?.message ?? t`Could not save. Try again.`}
        </span>
      ) : null}
    </form>
  );
}

function SupplementGoalLogger({
  supplementId,
  timeZone,
  onSaved,
}: {
  supplementId: number;
  timeZone: string;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const supplements = useQuery(orpc.plans.listSupplements.queryOptions({ input: {} }));
  const client = useQueryClient();
  const [dose, setDose] = useState("");
  const [when, setWhen] = useState(() => {
    const date = new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [clientMutationId, setClientMutationId] = useState("");
  const selected = supplements.data?.find((item) => item.id === supplementId);
  const log = useMutation(
    orpc.supplementIntake.create.mutationOptions({
      onSuccess: async () => {
        setDose("");
        setClientMutationId("");
        await client.invalidateQueries({ queryKey: orpc.supplementIntake.key() });
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        onSaved();
      },
    }),
  );
  if (supplements.isPending)
    return <p className="text-xs text-ink-3">{t`Loading selected supplement…`}</p>;
  if (supplements.isError || !selected)
    return (
      <p
        role="alert"
        className="text-xs text-destructive"
      >{t`Could not load the selected supplement. Open Supplements to retry.`}</p>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const actualDose = dose.trim() || selected.dose;
        if (!actualDose) return;
        const id = clientMutationId || mutationId();
        setClientMutationId(id);
        log.mutate({
          supplementId,
          occurredAt: new Date(when).toISOString(),
          timeZone,
          dose: actualDose,
          clientMutationId: id,
        });
      }}
    >
      <Input
        aria-label={t`Dose actually taken`}
        className="h-9 w-32"
        value={dose}
        onChange={(event) => {
          setDose(event.target.value);
          if (log.isError) setClientMutationId("");
        }}
        placeholder={selected.dose ?? undefined}
      />
      <Input
        aria-label={t`When taken`}
        className="h-9 w-48"
        type="datetime-local"
        value={when}
        onChange={(event) => {
          setWhen(event.target.value);
          if (log.isError) setClientMutationId("");
        }}
      />
      <Button size="sm" variant="outline" type="submit" disabled={log.isPending}>
        {log.isPending ? t`Saving…` : t`Log actual dose`}
      </Button>
      {log.isError ? (
        <span role="alert" className="text-xs text-destructive">
          {log.error.message ?? t`Could not save. Retry the same dose.`}
        </span>
      ) : null}
    </form>
  );
}

function GoalGroup({ title, goals }: { title: string; goals: GoalSummary[] }) {
  const { t } = useLingui();
  if (!goals.length) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-3 md:grid-cols-2">
        {goals.map((goal) => (
          <li key={goal.id} className="sheet grid gap-2 p-4">
            <Link
              to="/goals/$goalId"
              params={{ goalId: String(goal.id) }}
              className="font-semibold text-ink hover:text-signal"
            >
              {goal.title}
            </Link>
            <p className="text-sm text-ink-3">
              {goal.definition.status === "paused"
                ? t`Paused. Resume when you're ready.`
                : goal.evaluation.achieved
                  ? t`Evidence supports this achievement.`
                  : t`Completed by you.`}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ruleDescription(rule: GoalRule) {
  if (rule.kind === "target") return <Trans>One-time target</Trans>;
  if (rule.kind === "average") return <Trans>Rolling {rule.windowDays ?? 7}-day average</Trans>;
  if (rule.kind === "streak") return <Trans>{rule.targetDays}-day streak</Trans>;
  if (rule.cadence === "daily") return <Trans>Every day</Trans>;
  if (rule.cadence === "any-days-per-week")
    return <Trans>{rule.daysPerWeek} days each Monday–Sunday week</Trans>;
  return <Trans>Selected weekdays</Trans>;
}

function comparatorDescription(
  comparator: GoalComparator,
  unit: string | null | undefined,
  i18n: I18n,
) {
  const suffix = unit ? ` ${unit}` : "";
  if (comparator.kind === "minimum") return i18n._(msg`At least ${comparator.value}${suffix}`);
  if (comparator.kind === "maximum") return i18n._(msg`At most ${comparator.value}${suffix}`);
  return i18n._(msg`Between ${comparator.minimum} and ${comparator.maximum}${suffix}`);
}

function dailyStateLabel(state: string | undefined, i18n: I18n) {
  if (state === "qualifies") return i18n._(msg`Today’s target met`);
  if (state === "does-not-qualify") return i18n._(msg`Below target so far`);
  if (state === "not-scheduled") return i18n._(msg`Not scheduled today`);
  if (state === "paused") return i18n._(msg`Tracking paused`);
  return i18n._(msg`No record yet`);
}

function trackingCue(
  rule: GoalRule,
  dailyState: string | undefined,
  week: GoalSummary["evaluation"]["recurringWeeks"][number] | undefined,
  today: string,
  i18n: I18n,
) {
  if (rule.kind !== "recurring") return i18n._(msg`Progress is based on the current goal rule.`);
  if (rule.cadence === "daily") return dailyStateLabel(dailyState, i18n);
  if (dailyState === "not-scheduled")
    return i18n._(msg`Not scheduled today; this is not a missed goal day.`);
  if (!week) return i18n._(msg`No current week yet. The next Monday–Sunday period starts soon.`);
  if (week.weekStart > today) return i18n._(msg`The next Monday–Sunday period has not started.`);
  return i18n._(
    msg`${week.qualifyingDays} of ${week.requiredDays} days counted this Monday–Sunday week.`,
  );
}
