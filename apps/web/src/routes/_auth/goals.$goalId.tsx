import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { GoalDetail } from "@openvalens/plans/personal-goals";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ErrorState, Page, PageHeader, Section, StatusPill } from "@/components/page";
import { orpc } from "@/utils/orpc";
import { GoalEditor } from "./-goal-editor";
import { checkinCorrectionPayload, goalDetailParams, parseManualAmount } from "./-goals-ui";

export const Route = createFileRoute("/_auth/goals/$goalId")({ component: GoalDetailPage });

const mutationId = () => globalThis.crypto.randomUUID();

function localGoalDate(timeZone: string, cutoff?: string | null) {
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

function GoalDetailPage() {
  const { t, i18n } = useLingui();
  const { goalId } = Route.useParams();
  const id = Number(goalId);
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery(orpc.goals.detail.queryOptions({ input: { id } }));
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: orpc.goals.key() });
    await client.invalidateQueries({
      queryKey: orpc.goals.detail.queryOptions({ input: { id } }).queryKey,
    });
  };
  const status = useMutation(orpc.goals.setStatus.mutationOptions({ onSuccess: refresh }));
  const removeGoal = useMutation(
    orpc.goals.delete.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        await router.navigate({ to: "/goals" });
      },
    }),
  );

  if (query.isPending)
    return (
      <Page>
        <PageHeader title={<Trans>Goal</Trans>} />
        <div className="sheet h-48 animate-pulse" />
      </Page>
    );
  if (query.isError || !query.data)
    return (
      <Page>
        <PageHeader title={<Trans>Goal</Trans>} />
        <ErrorState
          title={<Trans>Could not load this goal.</Trans>}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>{t`Retry`}</Button>
          }
        />
      </Page>
    );

  const goal = query.data;
  const evaluation = goal.evaluation;
  const isActive = goal.definition.status === "active" && evaluation.state !== "completed";
  const manualCompletion =
    goal.definition.source === "manual" &&
    !goal.definition.unit &&
    (goal.definition.rule.kind === "recurring" || goal.definition.rule.kind === "streak");

  return (
    <Page>
      <Link
        to="/goals"
        className="inline-flex items-center gap-2 text-sm text-ink-3 hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        {t`All goals`}
      </Link>
      <PageHeader
        title={goal.title}
        info={
          <p>
            {sourceDescription(goal, i18n)} · {goal.definition.timeZone}
            {goal.definition.dayCutoff ? ` · ${goal.definition.dayCutoff}` : ""}
          </p>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={evaluation.state === "completed" ? "good" : "neutral"}>
          {statusLabel(goal, i18n)}
        </StatusPill>
        {isActive ? (
          <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
            <Pencil className="mr-1 size-4" />
            {editing ? t`Close editor` : t`Edit goal`}
          </Button>
        ) : null}
        {isActive ? (
          <Button
            size="sm"
            variant="outline"
            disabled={status.isPending}
            onClick={() =>
              status.mutate({
                id,
                version: goal.version,
                status: "paused",
                clientMutationId: mutationId(),
              })
            }
          >{t`Pause`}</Button>
        ) : goal.definition.status === "paused" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={status.isPending}
            onClick={() =>
              status.mutate({
                id,
                version: goal.version,
                status: "active",
                clientMutationId: mutationId(),
              })
            }
          >{t`Resume`}</Button>
        ) : null}
        {isActive && !evaluation.achieved ? (
          <Button
            size="sm"
            variant="outline"
            disabled={status.isPending}
            onClick={() =>
              status.mutate({
                id,
                version: goal.version,
                status: "completed",
                clientMutationId: mutationId(),
              })
            }
          >
            <Check className="mr-1 size-4" />
            {t`Complete`}
          </Button>
        ) : null}
        {goal.definition.status !== "deleted" ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t`Delete goal`}
            disabled={removeGoal.isPending}
            onClick={() => {
              if (window.confirm(t`Delete this goal? Its source records will remain.`))
                removeGoal.mutate({ id, version: goal.version, clientMutationId: mutationId() });
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setReplacing((value) => !value)}>
          <Plus className="mr-1 size-4" />
          {t`Create a replacement`}
        </Button>
      </div>
      {status.isError || removeGoal.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {status.error?.message ??
            removeGoal.error?.message ??
            t`Could not update this goal. Try again.`}
        </p>
      ) : null}
      {editing ? (
        <Section title={<Trans>Edit goal</Trans>}>
          <p className="mb-4 text-sm text-ink-3">
            <Trans>
              Rule edits apply going forward. Evidence source and metric stay fixed after evidence.
              A higher achieved target needs a replacement goal.
            </Trans>
          </p>
          <GoalEditor
            initial={{
              recordId: goal.id,
              version: goal.version,
              definition: goal.definition,
              sourceLocked: goal.sourceLocked,
            }}
            onSaved={() => {
              setEditing(false);
              void refresh();
            }}
          />
        </Section>
      ) : null}
      {goal.replacement.replacedById ? (
        <p className="text-sm text-ink-3">
          <Trans>This goal was replaced.</Trans>{" "}
          <Link
            className="text-signal underline"
            to="/goals/$goalId"
            params={goalDetailParams(goal.replacement.replacedById)}
          >{t`View replacement goal`}</Link>
        </p>
      ) : null}
      {replacing ? (
        <Section title={<Trans>New replacement goal</Trans>}>
          <p className="mb-4 text-sm text-ink-3">
            <Trans>
              Creating a replacement ends this goal. Its history and source records remain
              available.
            </Trans>
          </p>
          <GoalEditor
            seed={goal.definition}
            replacesId={goal.id}
            replacesVersion={goal.version}
            onSaved={(createdId) => {
              setReplacing(false);
              if (createdId)
                void router.navigate({
                  to: "/goals/$goalId",
                  params: goalDetailParams(createdId),
                });
              else void refresh();
            }}
          />
        </Section>
      ) : null}
      <TodayPanel goal={goal} manualCompletion={manualCompletion} onSaved={refresh} />
      <Milestones goal={goal} />
      <History goal={goal} onRefresh={refresh} />
      <RuleVersions goal={goal} />
    </Page>
  );
}

function TodayPanel({
  goal,
  manualCompletion,
  onSaved,
}: {
  goal: GoalDetail;
  manualCompletion: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const [date, setDate] = useState(() =>
    localGoalDate(goal.definition.timeZone, goal.definition.dayCutoff),
  );
  const [value, setValue] = useState("");
  const client = useQueryClient();
  const save = useMutation(
    orpc.goals.createCheckin.mutationOptions({
      onSuccess: async () => {
        setValue("");
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        await onSaved();
      },
    }),
  );
  const evaluation = goal.evaluation;
  return (
    <Section
      title={<Trans>Today</Trans>}
      description={
        <Trans>
          Missing data is unknown, not zero. Dates follow this goal’s timezone and cutoff.
        </Trans>
      }
    >
      <div className="sheet grid gap-2 p-5">
        <p className="text-3xl font-semibold text-ink">
          {evaluation.currentValue === null
            ? t`No data yet`
            : `${evaluation.windowCoverage && !evaluation.windowCoverage.complete ? `${t`Provisional`} · ` : ""}${evaluation.currentValue}${goal.definition.unit ? ` ${goal.definition.unit}` : ""}`}
        </p>
        <p className="text-sm text-ink-3">
          {evaluation.windowCoverage && !evaluation.windowCoverage.complete
            ? t`Provisional: ${evaluation.windowCoverage.coveredDays} of ${evaluation.windowCoverage.requiredDays} days covered.`
            : evaluation.unknownReasons.includes("no-evidence")
              ? t`Waiting for a record.`
              : evaluation.overdue
                ? t`Past the target date. Still active until you choose otherwise.`
                : t`Started ${goal.definition.startDate}.`}
        </p>
        {evaluation.currentStreak > 0 ? (
          <p className="text-sm text-ink-3">{t`${evaluation.currentStreak} day streak · best ${evaluation.bestStreak}`}</p>
        ) : null}
      </div>
      {goal.definition.source === "manual" && goal.definition.status === "active" ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (manualCompletion)
              save.mutate({
                goalId: goal.id,
                date,
                completed: true,
                clientMutationId: mutationId(),
              });
            else {
              const amount = parseManualAmount(value);
              if (amount !== null)
                save.mutate({
                  goalId: goal.id,
                  date,
                  value: amount,
                  clientMutationId: mutationId(),
                });
            }
          }}
        >
          <Field label={t`Date (backdate if needed)`}>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          {manualCompletion ? (
            <Button type="submit" disabled={save.isPending}>
              <Check className="mr-1 size-4" />
              {t`Mark done`}
            </Button>
          ) : (
            <>
              <Field label={goal.definition.unit ? t`Value (${goal.definition.unit})` : t`Value`}>
                <Input
                  type="number"
                  step="any"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={!value.trim() || save.isPending}>
                <Plus className="mr-1 size-4" />
                {save.isPending ? t`Saving…` : t`Save check-in`}
              </Button>
            </>
          )}
          {save.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message ?? t`Could not save this check-in. Try again.`}
            </p>
          ) : null}
        </form>
      ) : (
        <SourceAction goal={goal} />
      )}
    </Section>
  );
}

function SourceAction({ goal }: { goal: GoalDetail }) {
  const { t } = useLingui();
  if (goal.definition.source === "water")
    return (
      <p className="mt-3 text-sm text-ink-3">
        {t`Water entries count automatically.`}{" "}
        <Link className="text-signal underline" to="/nutrition">{t`Log water`}</Link>
      </p>
    );
  if (goal.definition.source === "supplement")
    return (
      <p className="mt-3 text-sm text-ink-3">
        {t`Actual intake only; each dose is preserved and the goal credits a day once.`}{" "}
        <Link className="text-signal underline" to="/supplements">{t`Log or correct intake`}</Link>
      </p>
    );
  if (goal.definition.source === "sleep")
    return (
      <p className="mt-3 text-sm text-ink-3">
        {t`Reliable sleep imports count automatically. Uncertain history is not included.`}{" "}
        <Link className="text-signal underline" to="/records/sleep">{t`View sleep records`}</Link>
      </p>
    );
  if (goal.definition.source === "workout")
    return (
      <p className="mt-3 text-sm text-ink-3">
        {t`Matched actual lifts with at least one rep count automatically.`}{" "}
        <Link className="text-signal underline" to="/workouts">{t`View workouts`}</Link>
      </p>
    );
  return null;
}

function Milestones({ goal }: { goal: GoalDetail }) {
  const { t } = useLingui();
  if (!goal.definition.milestones?.length) return null;
  return (
    <Section title={<Trans>Milestones</Trans>}>
      <ul className="grid gap-2">
        {goal.evaluation.milestones.map((milestone) => (
          <li
            key={milestone.id}
            className="sheet flex flex-wrap items-center justify-between gap-2 p-4"
          >
            <span>
              {milestone.value} {goal.definition.unit} · {milestone.targetDate}
            </span>
            <StatusPill tone={milestone.achieved ? "good" : "neutral"}>
              {milestone.achieved
                ? t`Reached ${milestone.achievedDate}`
                : milestone.overdue
                  ? t`Overdue · not failed`
                  : t`Upcoming`}
            </StatusPill>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function History({ goal, onRefresh }: { goal: GoalDetail; onRefresh: () => void | Promise<void> }) {
  const { t, i18n } = useLingui();
  const client = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const update = useMutation(
    orpc.goals.updateCheckin.mutationOptions({
      onSuccess: async () => {
        setEditingId(null);
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        await onRefresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.goals.deleteCheckin.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        await onRefresh();
      },
    }),
  );
  const evidence = goal.evidence;
  const retiredCheckins = goal.checkinHistory.filter((item) => item.deletedAt !== null);
  const isManual = goal.definition.source === "manual";
  return (
    <Section title={<Trans>History</Trans>}>
      {goal.evaluation.days.length ? (
        <ol className="grid gap-1">
          {[...goal.evaluation.days]
            .reverse()
            .slice(0, 45)
            .map((day) => (
              <li
                key={day.date}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm"
              >
                <span className="num text-ink-2">{day.date}</span>
                <span className="text-ink-3">
                  {day.value === null
                    ? stateCopy(day.state, i18n)
                    : `${day.value}${goal.definition.unit ? ` ${goal.definition.unit}` : ""} · ${stateCopy(day.state, i18n)}`}
                </span>
              </li>
            ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-3">{t`No daily history yet.`}</p>
      )}
      {!isManual && evidence.length ? (
        <div className="mt-4 grid gap-2">
          <h3 className="font-semibold text-ink">{t`Recorded evidence`}</h3>
          {evidence.map((item) => (
            <div
              key={item.id}
              className="sheet flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <span className="text-sm">
                {item.dateOnly ?? item.occurredAt ?? t`Date unavailable`} ·{" "}
                {item.value ??
                  (item.completed === true
                    ? t`Done`
                    : item.completed === false
                      ? t`Not done`
                      : t`Value unavailable`)}
              </span>
              <span className="text-xs text-ink-3">
                {item.source}
                {item.sourceRecordId ? ` · ${t`Source record`} ${item.sourceRecordId}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {isManual ? (
        <div className="mt-4 grid gap-2">
          <h3 className="font-semibold text-ink">
            {goal.definition.status === "deleted"
              ? t`Manual check-ins`
              : t`Correct manual check-ins`}
          </h3>
          {goal.checkins.length ? (
            goal.checkins.map((checkin) =>
              goal.definition.status === "deleted" ? (
                <div key={checkin.id} className="sheet p-3 text-sm text-ink-3">
                  {checkin.date} ·{" "}
                  {checkin.value ??
                    (checkin.completed === true
                      ? t`Done`
                      : checkin.completed === false
                        ? t`Not done`
                        : t`No value`)}
                </div>
              ) : (
                <CheckinEditor
                  key={checkin.id}
                  checkin={checkin}
                  goalId={goal.id}
                  editing={editingId === checkin.id}
                  onEdit={() => setEditingId(checkin.id)}
                  onCancel={() => setEditingId(null)}
                  onSave={(input) => update.mutate(input)}
                  onDelete={() => {
                    if (window.confirm(t`Delete this check-in? Progress will be recalculated.`))
                      remove.mutate({
                        id: checkin.id,
                        goalId: goal.id,
                        version: checkin.version,
                        clientMutationId: mutationId(),
                      });
                  }}
                />
              ),
            )
          ) : (
            <p className="text-sm text-ink-3">{t`No manual check-ins yet.`}</p>
          )}
        </div>
      ) : null}
      {isManual && retiredCheckins.length ? (
        <div className="mt-4 grid gap-2">
          <h3 className="font-semibold text-ink">{t`Earlier check-in versions`}</h3>
          {retiredCheckins.map((item) => (
            <div key={item.id} className="sheet p-3 text-sm text-ink-3">
              <span>
                {item.date} ·{" "}
                {item.value ??
                  (item.completed === true
                    ? t`Done`
                    : item.completed === false
                      ? t`Not done`
                      : t`No value`)}
              </span>
              <span className="ml-2">
                {item.correctedFromId
                  ? t`Replaced check-in ${item.correctedFromId}`
                  : item.deletedAt
                    ? t`Deleted`
                    : t`Retired version`}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {update.isError || remove.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {update.error?.message ??
            remove.error?.message ??
            t`Could not update history. Refresh and try again.`}
        </p>
      ) : null}
    </Section>
  );
}

function CheckinEditor({
  checkin,
  goalId,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  checkin: GoalDetail["checkins"][number];
  goalId: number;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (input: {
    id: number;
    goalId: number;
    version: number;
    date: string;
    value?: number;
    completed?: boolean;
    notes?: string | null;
    clientMutationId: string;
  }) => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const [date, setDate] = useState(checkin.date);
  const [value, setValue] = useState(checkin.value === null ? "" : String(checkin.value));
  const [completed, setCompleted] = useState(checkin.completed === true);
  const completionOnly = checkin.value === null;
  return (
    <div className="sheet grid gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {checkin.date} ·{" "}
          {checkin.value ??
            (checkin.completed === true
              ? t`Done`
              : checkin.completed === false
                ? t`Not done`
                : t`No value`)}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={editing ? onCancel : onEdit}>
            {editing ? t`Cancel` : t`Correct`}
          </Button>
          <Button size="sm" variant="ghost" aria-label={t`Delete check-in`} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t`Date`}>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          {completionOnly ? (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={completed}
                onChange={(event) => setCompleted(event.target.checked)}
              />
              {t`Completed`}
            </label>
          ) : (
            <Field label={t`Value`}>
              <Input
                type="number"
                step="any"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          )}
          <Button
            size="sm"
            disabled={!completionOnly && !checkinCorrectionPayload(value, false, completed)}
            onClick={() => {
              const correction = checkinCorrectionPayload(value, completionOnly, completed);
              if (!correction) return;
              onSave({
                id: checkin.id,
                goalId,
                version: checkin.version,
                date,
                ...correction,
                notes: checkin.notes,
                clientMutationId: mutationId(),
              });
            }}
          >
            <Trans>Save correction</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RuleVersions({ goal }: { goal: GoalDetail }) {
  const { t, i18n } = useLingui();
  const history = goal.history ?? [];
  if (history.length <= 1) return null;
  return (
    <Section title={<Trans>Rule history</Trans>}>
      <ol className="grid gap-2">
        {history.map((version) => {
          const effectiveLabel = version.effectiveUntil
            ? ` – ${version.effectiveUntil}`
            : ` · ${t`Current`}`;
          return (
            <li key={version.revision} className="sheet p-3">
              <p className="font-medium text-ink">
                {t`Version ${version.revision}`} · {version.effectiveFrom}
                {effectiveLabel}
              </p>
              <p className="text-sm text-ink-3">{ruleLabel(version.definition.rule, i18n)}</p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium text-ink-3">{label}</label>
      {children}
    </div>
  );
}

function sourceDescription(goal: GoalDetail, i18n: I18n) {
  const source = goal.definition.source;
  if (source === "manual") return i18n._(msg`Manual records`);
  if (source === "water") return i18n._(msg`Water diary · linked daily target`);
  if (source === "sleep") return i18n._(msg`Sleep imports · local wake dates`);
  if (source === "supplement") return i18n._(msg`Actual supplement intake`);
  return i18n._(msg`Matched exercise · actual lifts only`);
}

function statusLabel(goal: GoalDetail, i18n: I18n) {
  if (goal.definition.status === "paused") return i18n._(msg`Paused`);
  if (goal.definition.status === "deleted") return i18n._(msg`Ended · history retained`);
  if (goal.definition.status === "completed" || goal.evaluation.achieved)
    return i18n._(msg`Completed`);
  if (goal.evaluation.overdue) return i18n._(msg`Overdue · still active`);
  return i18n._(msg`Active`);
}

function stateCopy(state: string, i18n: I18n) {
  if (state === "qualifies") return i18n._(msg`Met`);
  if (state === "does-not-qualify") return i18n._(msg`Below target`);
  if (state === "not-scheduled") return i18n._(msg`Not scheduled`);
  if (state === "paused") return i18n._(msg`Paused`);
  return i18n._(msg`Unknown`);
}

function ruleLabel(rule: GoalDetail["history"][number]["definition"]["rule"], i18n: I18n) {
  if (rule.kind === "target") return i18n._(msg`One-time target`);
  if (rule.kind === "average") return i18n._(msg`Rolling average · ${rule.windowDays ?? 7} days`);
  if (rule.kind === "streak") return i18n._(msg`Consecutive days · ${rule.targetDays}`);
  if (rule.cadence === "daily") return i18n._(msg`Every day`);
  if (rule.cadence === "weekdays")
    return i18n._(msg`Selected weekdays · ${rule.weekdays!.join(", ")}`);
  return i18n._(msg`${rule.daysPerWeek!} days per Monday–Sunday week`);
}
