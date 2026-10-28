import { MEAL_SLOTS, type MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddFood } from "@/app/(drawer)/(tabs)/nutrition";
import { authClient } from "@/lib/auth-client";
import { useModuleEnabled } from "@/lib/modules/use-modules";
import { useDiaryOutbox, DIARY_CACHE_PREFIX } from "@/lib/nutrition/sync";
import {
  deviceTimeZone,
  localDateIn,
  mealSlotForLocalTime,
} from "@openvalens/api/presenters/nutrition-diary";
import { resolveHideNumbers as resolveHideNumbersPreference } from "@openvalens/api/presenters/nutrition-targets";
import { readCache, writeCache } from "@/lib/offline/cache";
import { useCacheFirst, useOfflineWriteSessionKey } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";
import { useEffect } from "react";

export default function LogFoodRoute() {
  const params = useLocalSearchParams<{
    food?: string | string[];
    localDate?: string;
    timeZone?: string;
    meal?: string;
    mode?: string;
    seedDate?: string;
    seedSlot?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = authClient.useSession();
  const foodEnabled = useModuleEnabled("food");
  const outbox = useDiaryOutbox();
  const sessionKey = useOfflineWriteSessionKey();
  const timeZone = params.timeZone || deviceTimeZone();
  const localDate =
    params.localDate && /^\d{4}-\d{2}-\d{2}$/.test(params.localDate)
      ? params.localDate
      : localDateIn(timeZone);
  const initialMeal = MEAL_SLOTS.includes(params.meal as MealSlot)
    ? (params.meal as MealSlot)
    : mealSlotForLocalTime();
  const initialQuery = (Array.isArray(params.food) ? params.food[0] : (params.food ?? ""))
    .trim()
    .slice(0, 200);
  const foods = useCacheFirst(
    `${DIARY_CACHE_PREFIX}foods`,
    orpc.nutritionDiary.listFoods.queryOptions({ input: {} }),
  );
  const seedDate =
    params.seedDate && /^\d{4}-\d{2}-\d{2}$/.test(params.seedDate) ? params.seedDate : localDate;
  const seedSlot = MEAL_SLOTS.includes(params.seedSlot as MealSlot)
    ? (params.seedSlot as MealSlot)
    : initialMeal;
  const seedDay = useCacheFirst(
    `${DIARY_CACHE_PREFIX}day:${seedDate}`,
    orpc.nutritionDiary.getDay.queryOptions({ input: { localDate: seedDate } }),
  );
  const seedIngredients =
    params.mode === "templates"
      ? (seedDay.data?.entries ?? [])
          .filter((entry) => entry.slot === seedSlot)
          .map((entry) => ({
            food: { kind: "snapshot" as const, snapshotId: entry.food.snapshotId },
            amount: entry.amount,
            unit: entry.unit,
            name: entry.food.name,
          }))
      : undefined;
  const targetOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const targets = useQuery({
    ...targetOptions,
    queryKey: [...targetOptions.queryKey, { offlineScope: outbox.scope }],
    enabled: Boolean(outbox.scope),
  });
  const cachedPreference = outbox.scope
    ? readCache<{
        hideNumbers: boolean;
        voiceDraftsEnabled?: boolean;
        photoDraftsEnabled?: boolean;
        recipeImportEnabled?: boolean;
      }>(outbox.scope, "nutrition-display-preference")?.data
    : undefined;
  const hideNumbers = resolveHideNumbersPreference(
    targets.isSuccess ? targets.data.settings.hideNumbers : undefined,
    cachedPreference?.hideNumbers,
  );
  useEffect(() => {
    if (outbox.scope && targets.data?.settings)
      writeCache(outbox.scope, "nutrition-display-preference", {
        hideNumbers: targets.data.settings.hideNumbers,
        voiceDraftsEnabled: targets.data.settings.voiceDraftsEnabled,
        photoDraftsEnabled: targets.data.settings.photoDraftsEnabled,
        recipeImportEnabled: targets.data.settings.recipeImportEnabled,
      });
  }, [outbox.scope, targets.data?.settings]);

  if (session.isPending) return null;
  if (!session.data?.user) return <Redirect href="/" />;
  if (!foodEnabled) return <Redirect href="/(drawer)/(tabs)" />;

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Stack.Screen options={{ headerShown: false, presentation: "fullScreenModal" }} />
      {outbox.scope ? (
        <AddFood
          key={`${outbox.scope}\u001f${sessionKey ?? "signed-out"}\u001f${localDate}\u001f${timeZone}`}
          initialQuery={initialQuery}
          contextKey={`${outbox.scope}\u001f${sessionKey ?? "signed-out"}\u001f${localDate}\u001f${timeZone}`}
          localDate={localDate}
          timeZone={timeZone}
          foods={foods.data}
          outbox={outbox}
          hideNumbers={hideNumbers}
          initialMeal={initialMeal}
          initialMode={
            params.mode === "templates"
              ? "templates"
              : params.mode === "describe" &&
                  (targets.data?.settings.voiceDraftsEnabled ??
                    cachedPreference?.voiceDraftsEnabled)
                ? "describe"
                : "choose"
          }
          recipeImportEnabled={
            targets.data?.settings.recipeImportEnabled ??
            cachedPreference?.recipeImportEnabled ??
            false
          }
          seedIngredients={seedIngredients}
          voiceDraftsEnabled={
            targets.data?.settings.voiceDraftsEnabled ??
            cachedPreference?.voiceDraftsEnabled ??
            false
          }
          photoDraftsEnabled={
            targets.data?.settings.photoDraftsEnabled ??
            cachedPreference?.photoDraftsEnabled ??
            false
          }
          onClose={() => (router.canGoBack() ? router.back() : router.replace("/(drawer)/(tabs)"))}
        />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}
