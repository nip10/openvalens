import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";

import { ActiveWorkout } from "@/components/active-workout";
import { Section, Sheet } from "@/components/bloom";
import { WorkoutRoutineStart } from "@/components/workout-routines";
import { createWorkoutDraft } from "@/lib/workouts/model";
import { useWorkoutRestTimer } from "@/lib/workouts/rest-timer";
import { useWorkoutSession, type WorkoutQueueItem } from "@/lib/workouts/sync";
import { client, orpc } from "@/utils/orpc";

function queuedWorkoutCounts(item: WorkoutQueueItem) {
  if (!("date" in item.payload)) return { exercises: 0, sets: 0 };
  return {
    exercises: item.payload.exercises.length,
    sets: item.payload.exercises.reduce((n, e) => n + e.sets.length, 0),
  };
}

/**
 * One queued change. A blocked change was definitively rejected (conflict or invalid), so retrying
 * cannot succeed: it can be reopened against the latest server version or discarded.
 */
function QueuedWorkoutItem({
  item,
  session,
  canRepair,
}: {
  item: WorkoutQueueItem;
  session: ReturnType<typeof useWorkoutSession>;
  canRepair: boolean;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const counts = queuedWorkoutCounts(item);
  const repairable = item.operation === "update" && "workout" in item.payload;
  const discard = () => {
    Alert.alert(t`Discard this change?`, t`The change will not be saved to your history.`, [
      { text: t`Cancel`, style: "cancel" },
      {
        text: t`Discard`,
        style: "destructive",
        onPress: () => {
          if (session.discardBlocked(item.id)) return;
          Alert.alert(
            t`Discard later changes too?`,
            t`Changes queued after this one depend on it and will also be discarded.`,
            [
              { text: t`Cancel`, style: "cancel" },
              {
                text: t`Discard all`,
                style: "destructive",
                onPress: () => {
                  if (!session.discardBlocked(item.id, true))
                    Alert.alert(t`Could not discard`, t`A dependent change is already syncing.`);
                },
              },
            ],
          );
        },
      },
    ]);
  };
  const repair = async () => {
    if (!("workout" in item.payload)) return;
    setBusy(true);
    try {
      const latest = await client.plans.workouts.getWorkout({ id: item.payload.id });
      if (!latest) {
        Alert.alert(
          t`Session no longer exists`,
          t`This session was deleted elsewhere. Discard the change to clear it.`,
        );
        return;
      }
      if (!session.repairAsDraft(item.id, latest.version))
        Alert.alert(t`Could not reopen`, t`Save or discard your active workout first.`);
    } catch {
      Alert.alert(t`Could not load the latest version`, t`Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet className="gap-2">
      <Text className="font-sans font-semibold text-ink">
        {item.state === "pending"
          ? t`Waiting to sync`
          : item.state === "blocked"
            ? t`Needs attention`
            : t`Sync failed`}
      </Text>
      <Text className="font-sans text-sm text-ink-2">
        {t`${plural(counts.exercises, { one: "# exercise", other: "# exercises" })}`},{" "}
        {t`${plural(counts.sets, { one: "# set", other: "# sets" })}`}
      </Text>
      {item.state === "failed" ? (
        <Button size="sm" variant="outline" onPress={() => session.retry(item.id)}>
          <Button.Label>{t`Retry sync`}</Button.Label>
        </Button>
      ) : null}
      {item.state === "blocked" ? (
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-2">
            <Trans>This change conflicts with the saved session and was not applied.</Trans>
          </Text>
          {repairable && canRepair ? (
            <Button size="sm" variant="outline" isDisabled={busy} onPress={() => void repair()}>
              <Button.Label>{t`Review against latest`}</Button.Label>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onPress={discard}>
            <Button.Label>{t`Discard change`}</Button.Label>
          </Button>
        </View>
      ) : null}
    </Sheet>
  );
}

export function WorkoutSession() {
  const { t } = useLingui();
  const session = useWorkoutSession();
  const rest = useWorkoutRestTimer(session.scope);
  const [minimized, setMinimized] = useState(false);
  const productSettings = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const draft = session.draft;
  const units: "metric" | "imperial" =
    productSettings.data?.units === "imperial" ? "imperial" : "metric";
  useEffect(() => {
    setMinimized(false);
  }, [session.scope]);
  return (
    <Section icon={Plus} tone="steps" title={t`Workout session`}>
      {!draft ? (
        <View className="gap-3">
          <Text className="font-sans text-sm text-ink-3">
            <Trans>Start a workout and log each set as you go.</Trans>
          </Text>
          <Button testID="workout-start" onPress={() => session.saveDraft(createWorkoutDraft())}>
            <Button.Label>{t`Start workout`}</Button.Label>
          </Button>
          <WorkoutRoutineStart onStart={(next) => session.saveDraft(next)} />
          {session.items.map((item) => (
            <QueuedWorkoutItem key={item.id} item={item} session={session} canRepair />
          ))}
        </View>
      ) : minimized ? (
        <Button testID="workout-resume" onPress={() => setMinimized(false)}>
          <Button.Label>{t`Resume workout`}</Button.Label>
        </Button>
      ) : (
        <ActiveWorkout
          key={draft.id}
          draft={draft}
          session={session}
          rest={rest}
          units={units}
          onMinimize={() => setMinimized(true)}
        />
      )}
    </Section>
  );
}
