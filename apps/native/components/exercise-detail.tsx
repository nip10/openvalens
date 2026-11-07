import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Spinner } from "heroui-native";
import { BookOpen, ChevronLeft, Dumbbell, History, Trophy } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Image, Linking, Platform, Pressable, Text, View } from "react-native";

import { ExerciseAttribution, TranslationAttribution } from "@/components/exercise-attribution";
import { MuscleGuide } from "@/components/muscle-guide";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { WorkoutExerciseHistory } from "@/components/workout-history";
import { authClient } from "@/lib/auth-client";
import { displayAssets, imageCredit, mediaSource } from "@/lib/exercises/detail";
import { previewAssets, previewUrl, safeHttpUrl, type PreviewAsset } from "@/lib/exercises/media";
import { getServerUrl } from "@/lib/server/server-url";
import {
  addDraftSet,
  createWorkoutDraft,
  newDraftExercise,
  weightFromKg,
} from "@/lib/workouts/model";
import { useWorkoutSession } from "@/lib/workouts/sync";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const CATALOG_LANGUAGE = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 16) || "en";
const FRAME_MS = 800;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduce(value))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/**
 * The exercise image: Workout Guide's three frames as a gentle loop (still
 * on the first frame under Reduce Motion), or the wger photo. Workout Guide
 * frames are monochrome line art, tinted to the ink colour.
 */
function ExerciseMedia({ name, assets }: { name: string; assets: PreviewAsset[] }) {
  const { t } = useLingui();
  const ink = useThemeColor("ink");
  const muted = useThemeColor("ink-3");
  const reduce = useReduceMotion();
  const [frame, setFrame] = useState(0);
  const [failed, setFailed] = useState(false);
  const origin =
    Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null;
  const looping = assets.length > 1 && !reduce && mediaSource(assets) === "workout-guide";
  useEffect(() => {
    if (!looping) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => setFrame((value) => (value + 1) % assets.length), FRAME_MS);
    return () => clearInterval(timer);
  }, [looping, assets.length]);
  const asset = assets[frame] ?? assets[0];
  const url = asset && !failed ? previewUrl(asset, getServerUrl() ?? "", origin) : null;
  return (
    <View
      className="relative h-60 items-center justify-center overflow-hidden rounded-3xl bg-sheet"
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        asset
          ? looping
            ? t`${name}, illustration in ${assets.length} frames`
            : t`${name}, illustration`
          : t`No image for ${name}`
      }
    >
      {url ? (
        <Image
          source={{ uri: url }}
          resizeMode="contain"
          onError={() => setFailed(true)}
          style={{
            width: 216,
            height: 216,
            ...(asset?.source === "workout-guide" ? { tintColor: ink } : null),
          }}
        />
      ) : (
        <View className="items-center gap-2">
          <Dumbbell size={40} color={muted} strokeWidth={1.6} />
          <Text className="font-sans text-sm text-ink-3">
            {asset ? t`Image unavailable` : t`No image for this exercise`}
          </Text>
        </View>
      )}
      {looping ? (
        <View className="absolute bottom-3 left-3.5 rounded-full bg-paper-3 px-2.5 py-1">
          <Text className="font-sans text-xs font-semibold text-ink-2">
            {t`${assets.length}-frame loop`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Personal records for one exercise (#287): heaviest, best e1RM, most reps at a weight. */
function ExerciseRecords({ exerciseId }: { exerciseId: number }) {
  const { t } = useLingui();
  const { data: session } = authClient.useSession();
  const scope = session?.user?.id
    ? `${session.user.id}:${session.session?.activeOrganizationId}`
    : null;
  const settings = useQuery(orpc.adminSettings.productSettings.queryOptions({ input: {} }));
  const units = settings.data?.units === "imperial" ? "imperial" : "metric";
  const options = orpc.plans.workouts.exerciseHistory.queryOptions({
    input: { exercise: { exerciseId }, limit: 1 },
  });
  const history = useQuery({
    ...options,
    queryKey: [...options.queryKey, { scope }],
    enabled: Boolean(scope),
  });
  const unit = units === "metric" ? t`kg` : t`lb`;
  const weight = (kg: number) => `${Number(weightFromKg(kg, units).toFixed(1))} ${unit}`;
  if (history.isPending) return <Spinner />;
  const records = history.data?.records;
  if (!records || (records.heaviestWeightKg == null && records.bestEstimated1RmKg == null))
    return (
      <Text className="font-sans text-sm text-ink-3">
        <Trans>No records yet. Log this exercise to set your first.</Trans>
      </Text>
    );
  return (
    <View className="flex-row flex-wrap gap-2">
      {records.heaviestWeightKg != null ? (
        <Text className="rounded-full bg-paper-3 px-3 py-1.5 font-sans text-sm text-ink">
          {t`Heaviest ${weight(records.heaviestWeightKg)}`}
        </Text>
      ) : null}
      {records.bestEstimated1RmKg != null ? (
        <Text className="rounded-full bg-paper-3 px-3 py-1.5 font-sans text-sm text-ink">
          {t`Best est. 1RM ${weight(records.bestEstimated1RmKg)}`}
        </Text>
      ) : null}
      {records.mostRepsAtWeight.slice(0, 4).map((record) => (
        <Text
          key={record.weightKg}
          className="rounded-full bg-paper-3 px-3 py-1.5 font-sans text-sm text-ink"
        >
          {t`${weight(record.weightKg)} × ${plural(record.reps, { one: "# rep", other: "# reps" })}`}
        </Text>
      ))}
    </View>
  );
}

/**
 * Issue #404 — the exercise detail page (mockup k): media loop, muscles
 * diagram (#94) with primary/secondary muscles and equipment, How to /
 * History / Records, Add to routine, Start with this, and the per-item
 * attribution #93 requires. `extra` lets the library keep its add-to-a-
 * saved-workout tool below How to.
 */
export function ExerciseDetailView({
  exerciseId,
  onBack,
  extra,
}: {
  exerciseId: number;
  onBack?: () => void;
  extra?: ReactNode;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const session = useWorkoutSession();
  const ink = useThemeColor("ink");
  const signalInk = useThemeColor("signal-ink");
  const [tab, setTab] = useState<"how" | "history" | "records">("how");
  const { data: auth } = authClient.useSession();
  // Same scope key as the library, so both share one cached detail.
  const scope = offlineScope(auth as Parameters<typeof offlineScope>[0]);
  const options = orpc.exerciseCatalog.get.queryOptions({
    input: { id: exerciseId, language: CATALOG_LANGUAGE },
  });
  const detail = useQuery({
    ...options,
    queryKey: [...options.queryKey, { scope }],
    enabled: Boolean(scope),
  });
  const data = detail.data;
  const assets = displayAssets(previewAssets(data?.media));
  const credit = imageCredit(assets);
  const startWithThis = () => {
    if (!data) return;
    const exercise = addDraftSet(newDraftExercise(data.name, data.id));
    const base = session.draft ?? createWorkoutDraft();
    if (session.saveDraft({ ...base, exercises: [...base.exercises, exercise] }))
      router.navigate("/training");
  };
  return (
    <View className="gap-3.5">
      {onBack ? (
        <Pressable
          testID="exercise-detail-back"
          accessibilityRole="button"
          accessibilityLabel={t`Back to the library`}
          onPress={onBack}
          className="h-11 w-11 items-center justify-center"
        >
          <ChevronLeft size={22} color={ink} />
        </Pressable>
      ) : null}
      {detail.isPending ? (
        <Spinner />
      ) : detail.isError || !data ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
          <Trans>Exercise details are unavailable.</Trans>
        </Text>
      ) : (
        <>
          <ExerciseMedia name={data.name} assets={assets} />
          <Text accessibilityRole="header" className="font-display text-3xl font-semibold text-ink">
            {data.name}
          </Text>
          <View className="gap-1">
            {data.muscles.some((m) => m.role === "primary") ? (
              <Text className="font-sans text-sm text-ink-2">
                <Text className="font-semibold text-ink">{t`Primary`} </Text>
                {data.muscles
                  .filter((m) => m.role === "primary")
                  .map((m) => m.name)
                  .join(" · ")}
              </Text>
            ) : null}
            {data.muscles.some((m) => m.role === "secondary") ? (
              <Text className="font-sans text-sm text-ink-2">
                <Text className="font-semibold text-ink">{t`Secondary`} </Text>
                {data.muscles
                  .filter((m) => m.role === "secondary")
                  .map((m) => m.name)
                  .join(" · ")}
              </Text>
            ) : null}
            {data.equipment.length > 0 ? (
              <Text className="font-sans text-sm text-ink-2">
                <Text className="font-semibold text-ink">{t`Equipment`} </Text>
                {data.equipment.map((e) => e.name).join(" · ")}
              </Text>
            ) : null}
          </View>
          {data.muscles.length > 0 ? <MuscleGuide muscles={data.muscles} /> : null}
          <SegmentedTabs
            tabs={[
              { value: "how", label: t`How to`, icon: BookOpen },
              { value: "history", label: t`History`, icon: History },
              { value: "records", label: t`Records`, icon: Trophy },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "how" ? (
            <View className="gap-3">
              <Text className="font-sans text-base leading-6 text-ink">
                {data.instructions || t`No instructions provided.`}
              </Text>
              {extra}
            </View>
          ) : tab === "history" ? (
            <WorkoutExerciseHistory exercise={{ exerciseId: data.id }} />
          ) : (
            <ExerciseRecords exerciseId={data.id} />
          )}
          <View className="gap-2 border-t border-rule pt-3">
            {credit ? (
              <View className="gap-1">
                <Text className="font-sans text-xs leading-5 text-ink-3">
                  {credit.kind === "workout-guide"
                    ? t`Illustration: Workout Guide by Bryl Lim, after Everkinetic, ${credit.license}. Re-encoded for the app.`
                    : credit.author
                      ? t`Photo: wger, ${credit.license}, ${credit.author}. Re-encoded for the app.`
                      : t`Photo: wger, ${credit.license}. Re-encoded for the app.`}
                </Text>
                {credit.attribution ? (
                  <Text className="font-sans text-xs leading-5 text-ink-3">
                    {credit.attribution}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-x-4">
                  {safeHttpUrl(credit.licenseUrl) ? (
                    <Text
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(safeHttpUrl(credit.licenseUrl)!)}
                      className="min-h-11 py-3 font-sans text-xs font-semibold text-signal"
                    >
                      <Trans>License details</Trans>
                    </Text>
                  ) : null}
                  {safeHttpUrl(credit.sourceUrl) ? (
                    <Text
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(safeHttpUrl(credit.sourceUrl)!)}
                      className="min-h-11 py-3 font-sans text-xs font-semibold text-signal"
                    >
                      <Trans>Image source</Trans>
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            {data.source === "wger" ? (
              <ExerciseAttribution
                title={t`Exercise record`}
                license={data.license}
                author={data.author}
                attribution={data.attribution}
                sourceUrl={data.sourceRecordUrl}
                licenseUrl={data.licenseUrl}
              />
            ) : null}
            {data.translationAttribution ? (
              <TranslationAttribution
                language={data.language}
                requestedLanguage={CATALOG_LANGUAGE}
                attribution={data.translationAttribution}
              />
            ) : null}
          </View>
          <View className="flex-row gap-2 pt-1">
            <Button
              testID="exercise-detail-add-to-routine"
              variant="outline"
              className="flex-1"
              onPress={() =>
                router.push({
                  pathname: "/routines",
                  params: { addId: String(data.id), addName: data.name },
                })
              }
            >
              <Button.Label>{t`Add to routine`}</Button.Label>
            </Button>
            <Pressable
              testID="exercise-detail-start"
              accessibilityRole="button"
              accessibilityHint={
                session.draft ? t`Adds it to your active workout.` : t`Starts a workout with it.`
              }
              onPress={startWithThis}
              className="min-h-[50px] flex-[1.2] items-center justify-center rounded-full bg-signal px-3"
            >
              <Text className="font-sans text-base font-semibold" style={{ color: signalInk }}>
                {session.draft ? t`Add to workout` : t`Start with this`}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
