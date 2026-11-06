import { useLingui } from "@lingui/react/macro";
import { localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { useQuery } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import { Button, cn } from "heroui-native";
import { Check, ChevronRight, Target } from "lucide-react-native";
import { useEffect } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { Icon, Section, Sheet, ToneIcon } from "@/components/bloom";
import { getHealthAccess } from "@/lib/health-sync";
import { useModules } from "@/lib/modules/use-modules";
import {
  getStartedItems,
  getStartedLoaded,
  shouldShowGetStarted,
  type GetStartedItemId,
} from "@/lib/onboarding/get-started";
import { useGetStartedProgress } from "@/lib/onboarding/get-started-progress";
import { shouldShowSetupCard } from "@/lib/onboarding/steps";
import { orpc } from "@/utils/orpc";

const ITEM_HREF: Record<GetStartedItemId, Href> = {
  "connect-health": "/settings",
  "first-weight": "/body",
  "first-meal": "/(drawer)/(tabs)/nutrition",
  "nutrition-targets": "/nutrition-targets",
  "first-goal": "/goals",
};

/**
 * App review — "Get started" on a new account's Cockpit, once onboarding is
 * closed: the goal it gave back to it, then a few first steps picked from its
 * answers. Each opens the screen that does it and ticks itself off from real
 * data; "Hide" puts the card away on this phone.
 */
export function GetStartedCard({
  hasWeight,
  hasDeviceData,
}: {
  /** `null` while the Cockpit's own queries load. */
  hasWeight: boolean | null;
  hasDeviceData: boolean | null;
}) {
  const { t } = useLingui();
  const modules = useModules();
  const snapshot = modules.profile.data ?? null;
  const progress = useGetStartedProgress(modules.userId);
  const food = modules.enabled.has("food");

  const access = useQuery({ queryKey: ["health-sync", "access"], queryFn: getHealthAccess });
  const localDate = localDateIn(undefined);
  const today = useQuery({
    ...orpc.nutritionDiary.getDay.queryOptions({ input: { localDate } }),
    enabled: food,
  });
  const targets = useQuery({
    ...orpc.nutritionTargets.get.queryOptions({ input: { localDate } }),
    enabled: food,
  });
  const goals = useQuery(orpc.goals.list.queryOptions({ input: {} }));
  // The goal typed in during onboarding is saved as a plain goal, without a
  // tracked definition.
  const onboardingGoals = useQuery(orpc.plans.goals.listGoals.queryOptions({ input: {} }));

  const signal = (query: { isSuccess: boolean; isError: boolean }, value: boolean) =>
    query.isSuccess ? value : query.isError ? false : null;
  const input = {
    enabled: modules.enabled,
    inputMethod: snapshot?.inputMethod.state === "recorded" ? snapshot.inputMethod.value : null,
    healthAvailable: access.data?.available ?? false,
    targetsOffered: targets.data ? targets.data.support === null : false,
    signals: {
      "connect-health":
        hasDeviceData === true || (access.data?.grantedTypes.length ?? 0) > 0
          ? true
          : access.isPending || hasDeviceData === null
            ? null
            : false,
      "first-weight": hasWeight,
      "first-meal": signal(today, (today.data?.entries.length ?? 0) > 0),
      "nutrition-targets": signal(targets, (targets.data?.targets.length ?? 0) > 0),
      "first-goal": signal(goals, (goals.data?.length ?? 0) > 0),
    },
    seenDone: progress.done,
  };
  const items = getStartedItems(input);
  const doneIds = items.filter((item) => item.done).map((item) => item.id);

  // Done once, done for good: a meal logged yesterday still counts today.
  const doneKey = doneIds.join(",");
  useEffect(() => {
    if (progress.loaded && doneIds.some((id) => !progress.done.has(id)))
      void progress.markDone(doneIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey, progress.loaded]);

  if (!snapshot || !progress.loaded || !getStartedLoaded(input)) return null;
  if (
    !shouldShowGetStarted(items, {
      dismissed: progress.dismissed,
      setupCardShown: shouldShowSetupCard(snapshot),
    })
  )
    return null;

  const sourceName = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
  const copy: Record<GetStartedItemId, { title: string; detail: string }> = {
    "connect-health": {
      title: t`Connect ${sourceName}`,
      detail: t`Your readings then arrive by themselves.`,
    },
    "first-weight": { title: t`Log a weight`, detail: t`It starts your weight trend.` },
    "first-meal": { title: t`Log a meal`, detail: t`Search, scan a barcode or add it quickly.` },
    "nutrition-targets": {
      title: t`Set nutrition targets`,
      detail: t`Optional. Shown beside your daily totals.`,
    },
    "first-goal": { title: t`Add a goal to track`, detail: t`Something to work toward.` },
  };
  const goalTitle = onboardingGoals.data?.[0]?.title ?? null;
  const left = items.filter((item) => !item.done).length;

  return (
    <Section
      title={t`Get started`}
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          onPress={() => void progress.dismiss()}
          accessibilityHint={t`Hides this list on this phone`}
          testID="get-started-hide"
        >
          <Button.Label>{t`Hide`}</Button.Label>
        </Button>
      }
    >
      <Sheet className="gap-1 p-2" testID="get-started">
        {goalTitle ? (
          <Pressable
            onPress={() => router.push("/goals")}
            accessibilityRole="link"
            className="min-h-11 flex-row items-center gap-3 rounded-2xl bg-paper-2 p-3 active:opacity-80"
            testID="get-started-goal"
          >
            <ToneIcon icon={Target} tone="steps" size="sm" />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="font-sans text-xs text-ink-3">{t`Your goal`}</Text>
              <Text className="font-sans text-base font-semibold text-ink">{goalTitle}</Text>
            </View>
            <Icon icon={ChevronRight} size={18} color="ink-3" />
          </Pressable>
        ) : null}
        <Text className="px-2 pt-2 font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
          {t`${left} of ${items.length} left`}
        </Text>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => router.push(ITEM_HREF[item.id])}
            accessibilityRole="button"
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={`${copy[item.id].title}. ${copy[item.id].detail}`}
            className="min-h-14 flex-row items-center gap-3 rounded-2xl px-2 py-2 active:opacity-70"
            testID={`get-started-${item.id}`}
          >
            <View
              className={cn(
                "h-6 w-6 items-center justify-center rounded-full border",
                item.done ? "border-primary bg-primary" : "border-rule-2 bg-paper",
              )}
            >
              {item.done ? <Icon icon={Check} size={14} color="primary-foreground" /> : null}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className={cn(
                  "font-sans text-base font-semibold",
                  item.done ? "text-ink-3 line-through" : "text-ink",
                )}
              >
                {copy[item.id].title}
              </Text>
              {item.done ? null : (
                <Text className="font-sans text-sm text-ink-3">{copy[item.id].detail}</Text>
              )}
            </View>
            {item.done ? null : <Icon icon={ChevronRight} size={18} color="ink-3" />}
          </Pressable>
        ))}
      </Sheet>
    </Section>
  );
}
