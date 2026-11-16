import type {
  TargetSettingsWire,
  UpdateSettingsInput,
} from "@openvalens/api/contracts/nutrition-targets";
import { offlineScope } from "@openvalens/api/presenters/offline";
import {
  deviceTimeZone,
  localDateIn,
  DIARY_COPY,
} from "@openvalens/api/presenters/nutrition-diary";
import { TARGET_COPY } from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export type SettingsPatch = Omit<UpdateSettingsInput, "expectedRevision">;
export type SettingsSaveResult =
  | { outcome: "updated"; settings: TargetSettingsWire }
  | { outcome: "conflict" }
  | { outcome: "confirmation_required"; note: string }
  | { outcome: "failed" };

/**
 * The member's nutrition settings (#80) and a save for a few of them at a
 * time. Each save sends the revision it was made from; a change from another
 * device comes back as a conflict and the latest version is loaded. Shared by
 * Settings › Nutrition and the pages that turn a feature on in place.
 */
export function useNutritionSettings() {
  const { data: session } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const localDate = useMemo(() => localDateIn(deviceTimeZone()), []);
  const queryClient = useQueryClient();
  const { i18n } = useLingui();
  const options = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const queryKey = [...options.queryKey, { offlineScope: scope }];
  const query = useQuery({
    ...options,
    queryKey,
    enabled: Boolean(scope),
  });
  const update = useMutation(orpc.nutritionTargets.updateSettings.mutationOptions());

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() }),
      // #443: the drink totals and the sleep view's last caffeine follow these settings.
      queryClient.invalidateQueries({ queryKey: orpc.nutritionDrinks.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nutritionMicronutrients.key() }),
      // The Micronutrients page keys its summary by hand.
      queryClient.invalidateQueries({ queryKey: ["nutritionMicronutrients"] }),
    ]);

  const save = async (patch: SettingsPatch): Promise<SettingsSaveResult> => {
    const settings = query.data?.settings;
    if (!settings) return { outcome: "failed" };
    try {
      const result = await update.mutateAsync({ expectedRevision: settings.revision, ...patch });
      // The new revision at once, so a second switch flipped right after does not conflict.
      if (result.outcome === "updated")
        queryClient.setQueryData(queryKey, (old: typeof query.data) =>
          old ? { ...old, settings: result.settings } : old,
        );
      void refresh();
      if (result.outcome === "conflict") {
        toast(i18n._(TARGET_COPY.conflict));
        return { outcome: "conflict" };
      }
      if (result.outcome === "confirmation_required")
        return { outcome: "confirmation_required", note: result.note };
      return { outcome: "updated", settings: result.settings };
    } catch {
      toast.error(i18n._(TARGET_COPY.networkError), {
        action: { label: i18n._(DIARY_COPY.retry), onClick: () => void save(patch) },
      });
      return { outcome: "failed" };
    }
  };

  return { query, settings: query.data?.settings, save, saving: update.isPending, refresh };
}
