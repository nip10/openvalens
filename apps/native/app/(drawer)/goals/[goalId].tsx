import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { GoalDetail } from "@openvalens/plans/personal-goals";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner } from "heroui-native";
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { DecimalHint } from "@/components/decimal-hint";
import { ErrorState, Icon, Page, PageHeader, Section, Sheet, StatusPill } from "@/components/bloom";
import { Container } from "@/components/container";
import { GoalEditor } from "@/components/goal-editor";
import { orpc } from "@/utils/orpc";
import { checkinCorrectionPayload, goalDetailRouteParams } from "@/utils/goal-ui";
import { parseDecimal } from "@openvalens/i18n/numbers";

const mutationId = () => globalThis.crypto.randomUUID();

export default function GoalDetailScreen() {
  const { t, i18n } = useLingui();
  const { goalId } = useLocalSearchParams<{ goalId: string }>();
  const id = Number(goalId);
  const router = useRouter();
  const client = useQueryClient();
  const goal = useQuery(orpc.goals.detail.queryOptions({ input: { id } }));
  const [editing, setEditing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: orpc.goals.key() });
    await client.invalidateQueries({
      queryKey: orpc.goals.detail.queryOptions({ input: { id } }).queryKey,
    });
  };
  const setStatus = useMutation(orpc.goals.setStatus.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(
    orpc.goals.delete.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries({ queryKey: orpc.goals.key() });
        router.replace("/goals");
      },
    }),
  );

  if (goal.isPending)
    return (
      <Container>
        <Page>
          <PageHeader title={<Trans>Goal</Trans>} />
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );
  if (goal.isError || !goal.data)
    return (
      <Container>
        <Page>
          <PageHeader title={<Trans>Goal</Trans>} />
          <ErrorState
            title={<Trans>Could not load this goal.</Trans>}
            action={
              <Button variant="outline" onPress={() => void goal.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const detail = goal.data;
  const active = detail.definition.status === "active" && detail.evaluation.state !== "completed";
  const manualCompletion =
    detail.definition.source === "manual" &&
    !detail.definition.unit &&
    (detail.definition.rule.kind === "recurring" || detail.definition.rule.kind === "streak");

  return (
    <Container>
      <Page>
        <Link href="/goals" asChild>
          <Pressable className="mb-2 flex-row items-center gap-2">
            <Icon icon={ArrowLeft} size={17} color="ink-2" />
            <Text className="text-ink-3">{t`All goals`}</Text>
          </Pressable>
        </Link>
        <PageHeader title={detail.title} />
        {detail.replacement.replacedById ? (
          <Link
            href={{
              pathname: "/goals/[goalId]",
              params: goalDetailRouteParams(detail.replacement.replacedById).params,
            }}
            className="mb-2 text-signal"
          >{t`View replacement goal`}</Link>
        ) : null}
        <Text className="mb-2 text-sm text-ink-3">
          {sourceDescription(detail, i18n)} · {detail.definition.timeZone}
          {detail.definition.dayCutoff ? ` · ${detail.definition.dayCutoff}` : ""}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <StatusPill tone={detail.evaluation.state === "completed" ? "good" : "neutral"}>
            {statusLabel(detail, i18n)}
          </StatusPill>
          {active ? (
            <Button size="sm" variant="outline" onPress={() => setEditing((value) => !value)}>
              <Icon icon={Pencil} size={14} color="ink-2" />
              <Button.Label>{editing ? t`Close editor` : t`Edit`}</Button.Label>
            </Button>
          ) : null}
          {active ? (
            <Button
              size="sm"
              variant="outline"
              isDisabled={setStatus.isPending}
              onPress={() =>
                setStatus.mutate({
                  id,
                  version: detail.version,
                  status: "paused",
                  clientMutationId: mutationId(),
                })
              }
            >
              <Button.Label>{t`Pause`}</Button.Label>
            </Button>
          ) : detail.definition.status === "paused" ? (
            <Button
              size="sm"
              variant="outline"
              isDisabled={setStatus.isPending}
              onPress={() =>
                setStatus.mutate({
                  id,
                  version: detail.version,
                  status: "active",
                  clientMutationId: mutationId(),
                })
              }
            >
              <Button.Label>{t`Resume`}</Button.Label>
            </Button>
          ) : null}
          {active && !detail.evaluation.achieved ? (
            <Button
              size="sm"
              variant="outline"
              isDisabled={setStatus.isPending}
              onPress={() =>
                setStatus.mutate({
                  id,
                  version: detail.version,
                  status: "completed",
                  clientMutationId: mutationId(),
                })
              }
            >
              <Icon icon={Check} size={15} color="ink-2" />
              <Button.Label>{t`Complete`}</Button.Label>
            </Button>
          ) : null}
          {detail.definition.status !== "deleted" ? (
            <Button
              size="sm"
              variant="ghost"
              isDisabled={remove.isPending}
              onPress={() =>
                Alert.alert(t`Delete this goal?`, t`Its source records will remain.`, [
                  { text: t`Cancel`, style: "cancel" },
                  {
                    text: t`Delete`,
                    style: "destructive",
                    onPress: () =>
                      remove.mutate({
                        id,
                        version: detail.version,
                        clientMutationId: mutationId(),
                      }),
                  },
                ])
              }
            >
              <Icon icon={Trash2} size={15} color="ink-2" />
              <Button.Label>{t`Delete`}</Button.Label>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onPress={() => setReplacing((value) => !value)}>
            <Icon icon={Plus} size={15} color="ink-2" />
            <Button.Label>{t`Create replacement`}</Button.Label>
          </Button>
        </View>
        {setStatus.isError || remove.isError ? (
          <Text accessibilityRole="alert" className="mt-2 text-sm text-destructive">
            {setStatus.error?.message ??
              remove.error?.message ??
              t`Could not update goal. Try again.`}
          </Text>
        ) : null}
        {editing ? (
          <Section title={t`Edit goal`}>
            <Text className="mb-3 text-sm text-ink-3">{t`Rule edits apply going forward. Source and metric stay fixed after evidence.`}</Text>
            <GoalEditor
              initial={{
                id: detail.id,
                version: detail.version,
                definition: detail.definition,
                sourceLocked: detail.sourceLocked,
              }}
              onSaved={() => {
                setEditing(false);
                void refresh();
              }}
            />
          </Section>
        ) : null}
        {replacing ? (
          <Section title={t`Replacement goal`}>
            <Text className="mb-3 text-sm text-ink-3">{t`Creating a replacement ends this goal. Its history and source records remain available.`}</Text>
            <GoalEditor
              seed={detail.definition}
              replacesId={detail.id}
              replacesVersion={detail.version}
              onSaved={(createdId) => {
                setReplacing(false);
                if (createdId) router.push(goalDetailRouteParams(createdId));
                else void refresh();
              }}
            />
          </Section>
        ) : null}
        <TodaySection goal={detail} completion={manualCompletion} onSaved={refresh} />
        <MilestoneSection goal={detail} />
        <GoalHistory goal={detail} onRefresh={refresh} />
        <RuleHistory goal={detail} />
      </Page>
    </Container>
  );
}

function TodaySection({
  goal,
  completion,
  onSaved,
}: {
  goal: GoalDetail;
  completion: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const client = useQueryClient();
  const [date, setDate] = useState(() =>
    goalDate(goal.definition.timeZone, goal.definition.dayCutoff),
  );
  const [value, setValue] = useState("");
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
      title={t`Today`}
      description={t`Missing data is unknown, not zero. Dates follow this goal's timezone and cutoff.`}
    >
      <Sheet className="gap-2 p-4">
        <Text className="font-display text-2xl font-semibold text-ink">
          {evaluation.currentValue === null
            ? t`No data yet`
            : `${evaluation.currentValue}${goal.definition.unit ? ` ${goal.definition.unit}` : ""}`}
        </Text>
        <Text className="text-sm text-ink-3">
          {evaluation.windowCoverage && !evaluation.windowCoverage.complete
            ? t`Provisional · ${evaluation.windowCoverage.coveredDays} of ${evaluation.windowCoverage.requiredDays} days covered.`
            : evaluation.unknownReasons.includes("no-evidence")
              ? t`Waiting for a record.`
              : evaluation.overdue
                ? t`Past the target date. Still active until you choose otherwise.`
                : t`Started ${goal.definition.startDate}.`}
        </Text>
        {evaluation.currentStreak > 0 ? (
          <Text className="text-sm text-ink-3">{t`${evaluation.currentStreak} day streak · best ${evaluation.bestStreak}`}</Text>
        ) : null}
      </Sheet>
      {goal.definition.source === "manual" && goal.definition.status === "active" ? (
        <View className="mt-3 gap-2">
          <Field
            label={t`Date (backdate if needed)`}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
          />
          {completion ? (
            <Button
              isDisabled={save.isPending}
              onPress={() =>
                save.mutate({
                  goalId: goal.id,
                  date,
                  completed: true,
                  clientMutationId: mutationId(),
                })
              }
            >
              <Icon icon={Check} size={16} color="primary-foreground" />
              <Button.Label>{t`Mark done`}</Button.Label>
            </Button>
          ) : (
            <>
              <Field
                label={goal.definition.unit ? t`Value (${goal.definition.unit})` : t`Value`}
                value={value}
                onChangeText={setValue}
                keyboardType="decimal-pad"
              />
              <DecimalHint value={value} />
              <Button
                isDisabled={!value.trim() || save.isPending}
                onPress={() => {
                  const amount = parseDecimal(value, i18n.locale);
                  if (amount !== null)
                    save.mutate({
                      goalId: goal.id,
                      date,
                      value: amount,
                      clientMutationId: mutationId(),
                    });
                }}
              >
                <Button.Label>{save.isPending ? t`Saving…` : t`Save check-in`}</Button.Label>
              </Button>
            </>
          )}
          {save.isError ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {save.error.message ?? t`Could not save. Try again.`}
            </Text>
          ) : null}
        </View>
      ) : (
        <SourceLink goal={goal} />
      )}
    </Section>
  );
}

function SourceLink({ goal }: { goal: GoalDetail }) {
  const { t } = useLingui();
  if (goal.definition.source === "water")
    return (
      <Text className="mt-2 text-sm text-ink-3">
        {t`Water entries count automatically.`}{" "}
        <Link href="/(drawer)/(tabs)/nutrition" className="text-signal">{t`Log water`}</Link>
      </Text>
    );
  if (goal.definition.source === "supplement")
    return (
      <Text className="mt-2 text-sm text-ink-3">
        {t`Actual doses only; the day is credited once.`}{" "}
        <Link href="/supplements" className="text-signal">{t`Log or correct intake`}</Link>
      </Text>
    );
  if (goal.definition.source === "sleep")
    return (
      <Text className="mt-2 text-sm text-ink-3">
        {t`Reliable sleep imports count automatically.`}{" "}
        <Link href="/records/sleep" className="text-signal">{t`View sleep records`}</Link>
      </Text>
    );
  if (goal.definition.source === "workout")
    return (
      <Text className="mt-2 text-sm text-ink-3">
        {t`Matched actual lifts with at least one rep count.`}{" "}
        <Link href="/workouts" className="text-signal">{t`View workouts`}</Link>
      </Text>
    );
  return null;
}

function MilestoneSection({ goal }: { goal: GoalDetail }) {
  const { t } = useLingui();
  if (!goal.definition.milestones?.length) return null;
  return (
    <Section title={t`Milestones`}>
      <View className="gap-2">
        {goal.evaluation.milestones.map((item) => (
          <Sheet key={item.id} className="flex-row items-center justify-between gap-2 p-3">
            <Text className="flex-1 text-ink">
              {item.value} {goal.definition.unit} · {item.targetDate}
            </Text>
            <Text className="text-xs text-ink-3">
              {item.achieved
                ? t`Reached ${item.achievedDate}`
                : item.overdue
                  ? t`Overdue · not failed`
                  : t`Upcoming`}
            </Text>
          </Sheet>
        ))}
      </View>
    </Section>
  );
}

function GoalHistory({ goal, onRefresh }: { goal: GoalDetail; onRefresh: () => Promise<void> }) {
  const { t, i18n } = useLingui();
  const client = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const update = useMutation(
    orpc.goals.updateCheckin.mutationOptions({
      onSuccess: async () => {
        setEditing(null);
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
  const retiredCheckins = goal.checkinHistory.filter((item) => item.deletedAt !== null);
  return (
    <Section title={t`History`}>
      <Text className="mb-2 font-semibold text-ink">{t`Daily progress`}</Text>
      {goal.evaluation.days.length ? (
        goal.evaluation.days
          .slice(-45)
          .reverse()
          .map((day) => (
            <View
              key={day.date}
              className="flex-row items-center justify-between border-b border-border py-2"
            >
              <Text className="text-sm text-ink-2">{day.date}</Text>
              <Text className="text-sm text-ink-3">
                {day.value === null
                  ? stateLabel(day.state, i18n)
                  : `${day.value}${goal.definition.unit ? ` ${goal.definition.unit}` : ""} · ${stateLabel(day.state, i18n)}`}
              </Text>
            </View>
          ))
      ) : (
        <Text className="text-sm text-ink-3">{t`No daily progress yet.`}</Text>
      )}
      {goal.definition.source !== "manual" && goal.evidence.length ? (
        <View className="mt-4 gap-2">
          <Text className="font-semibold text-ink">{t`Source records`}</Text>
          {goal.evidence.map((record) => (
            <Sheet key={record.id} className="gap-1 p-3">
              <Text className="text-sm text-ink">
                {record.dateOnly ?? record.occurredAt ?? t`Date unavailable`} ·{" "}
                {record.value ??
                  (record.completed === true
                    ? t`Done`
                    : record.completed === false
                      ? t`Not done`
                      : t`No value`)}
              </Text>
              <Text className="text-xs text-ink-3">
                {record.source}
                {record.sourceRecordId ? ` · ${t`Record`} ${record.sourceRecordId}` : ""}
              </Text>
            </Sheet>
          ))}
        </View>
      ) : null}
      {goal.definition.source === "manual" ? (
        <View className="mt-4 gap-2">
          <Text className="font-semibold text-ink">
            {goal.definition.status === "deleted"
              ? t`Manual check-ins`
              : t`Correct manual check-ins`}
          </Text>
          {goal.checkins.length ? (
            goal.checkins.map((checkin) =>
              goal.definition.status === "deleted" ? (
                <Sheet key={checkin.id} className="p-3">
                  <Text className="text-sm text-ink-3">
                    {checkin.date} ·{" "}
                    {checkin.value ??
                      (checkin.completed === true
                        ? t`Done`
                        : checkin.completed === false
                          ? t`Not done`
                          : t`No value`)}
                  </Text>
                </Sheet>
              ) : (
                <CheckinEditor
                  key={checkin.id}
                  checkin={checkin}
                  goalId={goal.id}
                  editing={editing === checkin.id}
                  onEdit={() => setEditing(checkin.id)}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => update.mutate(input)}
                  onDelete={() =>
                    Alert.alert(
                      t`Delete check-in?`,
                      t`Progress and achievements will be recalculated.`,
                      [
                        { text: t`Cancel`, style: "cancel" },
                        {
                          text: t`Delete`,
                          style: "destructive",
                          onPress: () =>
                            remove.mutate({
                              id: checkin.id,
                              goalId: goal.id,
                              version: checkin.version,
                              clientMutationId: mutationId(),
                            }),
                        },
                      ],
                    )
                  }
                />
              ),
            )
          ) : (
            <Text className="text-sm text-ink-3">{t`No manual check-ins yet.`}</Text>
          )}
        </View>
      ) : null}
      {goal.definition.source === "manual" && retiredCheckins.length ? (
        <View className="mt-4 gap-2">
          <Text className="font-semibold text-ink">{t`Earlier check-in versions`}</Text>
          {retiredCheckins.map((item) => (
            <Sheet key={item.id} className="p-3">
              <Text className="text-sm text-ink-3">
                {item.date} ·{" "}
                {item.value ??
                  (item.completed === true
                    ? t`Done`
                    : item.completed === false
                      ? t`Not done`
                      : t`No value`)}{" "}
                ·{" "}
                {item.correctedFromId
                  ? t`Replaced check-in ${item.correctedFromId}`
                  : item.deletedAt
                    ? t`Deleted`
                    : t`Retired version`}
              </Text>
            </Sheet>
          ))}
        </View>
      ) : null}
      {update.isError || remove.isError ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-destructive">
          {update.error?.message ??
            remove.error?.message ??
            t`Could not update history. Try again.`}
        </Text>
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
  const { t, i18n } = useLingui();
  const [date, setDate] = useState(checkin.date);
  const [value, setValue] = useState(checkin.value === null ? "" : String(checkin.value));
  const [completed, setCompleted] = useState(checkin.completed === true);
  const completionOnly = checkin.value === null;
  return (
    <Sheet className="gap-2 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-sm text-ink">
          {checkin.date} ·{" "}
          {checkin.value ??
            (checkin.completed === true
              ? t`Done`
              : checkin.completed === false
                ? t`Not done`
                : t`No value`)}
        </Text>
        <View className="flex-row gap-1">
          <Button size="sm" variant="outline" onPress={editing ? onCancel : onEdit}>
            <Button.Label>{editing ? t`Cancel` : t`Correct`}</Button.Label>
          </Button>
          <Button size="sm" variant="ghost" onPress={onDelete}>
            <Icon icon={Trash2} size={15} color="ink-2" />
            <Button.Label>{t`Delete`}</Button.Label>
          </Button>
        </View>
      </View>
      {editing ? (
        <>
          <Field label={t`Date`} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          {completionOnly ? (
            <ChoiceBoolean value={completed} onChange={setCompleted} />
          ) : (
            <TextInput
              accessibilityLabel={t`Check-in value`}
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              placeholder={t`Value`}
              className="rounded-xl border border-border p-3 text-ink"
            />
          )}
          {completionOnly ? null : <DecimalHint value={value} />}
          <Button
            isDisabled={
              !completionOnly && !checkinCorrectionPayload(value, false, completed, i18n.locale)
            }
            onPress={() => {
              const correction = checkinCorrectionPayload(
                value,
                completionOnly,
                completed,
                i18n.locale,
              );
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
            <Button.Label>{t`Save correction`}</Button.Label>
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

function ChoiceBoolean({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <View className="flex-row gap-2">
      <Button size="sm" variant={value ? "primary" : "outline"} onPress={() => onChange(true)}>
        <Button.Label>{t`Done`}</Button.Label>
      </Button>
      <Button size="sm" variant={!value ? "primary" : "outline"} onPress={() => onChange(false)}>
        <Button.Label>{t`Not done`}</Button.Label>
      </Button>
    </View>
  );
}

function RuleHistory({ goal }: { goal: GoalDetail }) {
  const { t, i18n } = useLingui();
  if (!goal.history || goal.history.length <= 1) return null;
  return (
    <Section title={t`Rule history`}>
      <View className="gap-2">
        {goal.history.map((item) => (
          <Sheet key={item.revision} className="p-3">
            <Text className="font-semibold text-ink">
              {t`Version ${item.revision}`} · {item.effectiveFrom}
              {item.effectiveUntil ? ` – ${item.effectiveUntil}` : ` · ${t`Current`}`}
            </Text>
            <Text className="text-sm text-ink-3">{ruleLabel(item.definition.rule, i18n)}</Text>
          </Sheet>
        ))}
      </View>
    </Section>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "decimal-pad" | "number-pad";
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink-3">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        className="rounded-xl border border-border p-3 text-ink"
      />
    </View>
  );
}

function sourceDescription(goal: GoalDetail, i18n: I18n) {
  if (goal.definition.source === "manual") return i18n._(msg`Manual records`);
  if (goal.definition.source === "water") return i18n._(msg`Linked water diary target`);
  if (goal.definition.source === "sleep") return i18n._(msg`Sleep imports · local wake dates`);
  if (goal.definition.source === "supplement") return i18n._(msg`Actual supplement intake`);
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

function stateLabel(state: string, i18n: I18n) {
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
  if (rule.cadence === "weekdays") return i18n._(msg`Selected weekdays`);
  return i18n._(msg`${rule.daysPerWeek!} days per Monday–Sunday week`);
}

function goalDate(timeZone: string, cutoff?: string | null) {
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
