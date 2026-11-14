import {
  availableLogKinds,
  drinkLogKinds,
  LOG_KINDS,
  logKindPermissionCheck,
  type LogKind,
} from "@openvalens/api/presenters/log-kinds";
import { trackerLogKinds } from "@openvalens/api/presenters/trackers";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useModules } from "@/lib/modules/use-modules";
import { useCacheFirst } from "@/lib/offline/sync";
import { WATER_PREFERENCES_CACHE_KEY } from "@/lib/plain-water/view";
import { orpc } from "@/utils/orpc";

/**
 * Every kind the member can log now (#440), from the one shared list plus
 * drink presets (#443) and their custom trackers (#441): modules,
 * preferences and role decide. The log picker and the app-icon quick actions
 * both read it.
 *
 * `settled` is true once every answer that can take a kind away is in: the
 * modules (which read as all on while loading), the role and each
 * preference. The picker shows the list at once; the quick actions wait, so
 * a turned-off feature never reaches the home screen, not even for a moment.
 */
export function useLogKinds(options: { timeZone: string; enabled?: boolean }) {
  const enabledOption = options.enabled ?? true;
  const { enabled, isEnabled, profile } = useModules();
  const me = useQuery({ ...orpc.sharing.me.queryOptions({ input: {} }), enabled: enabledOption });
  const waterPreferences = useCacheFirst(WATER_PREFERENCES_CACHE_KEY, {
    ...orpc.plainWater.getPreferences.queryOptions({ input: {} }),
    enabled: enabledOption,
  });
  const privateBody = useQuery({
    ...orpc.privateBody.preference.queryOptions({ input: {} }),
    enabled: enabledOption && isEnabled("body"),
  });
  // Pain (#442): the member's own opt-in. Fails closed: unknown or an error reads as off.
  const pain = useQuery({
    ...orpc.pain.preference.queryOptions({ input: {} }),
    enabled: enabledOption && isEnabled("body"),
  });
  const trackers = useQuery({
    ...orpc.trackers.list.queryOptions({
      input: { timeZone: options.timeZone, includeArchived: false },
    }),
    enabled: enabledOption,
  });
  // Drink presets (#443), only the ones the server can log (FDC imported).
  const drinkPresets = useQuery({
    ...orpc.nutritionDrinks.presets.queryOptions({ input: {} }),
    enabled: enabledOption && isEnabled("food"),
  });

  const kinds = useMemo(
    () =>
      availableLogKinds<LogKind>(
        {
          enabledModules: [...enabled],
          preferences: {
            plain_water: waterPreferences.data?.enabled === true,
            private_body: privateBody.data?.enabled === true,
            pain: pain.data?.enabled === true,
          },
          can: logKindPermissionCheck(me.data?.role),
        },
        [
          ...LOG_KINDS,
          ...drinkLogKinds(drinkPresets.data?.presets),
          ...trackerLogKinds(trackers.data ?? []),
        ],
      ),
    [
      enabled,
      waterPreferences.data?.enabled,
      privateBody.data?.enabled,
      pain.data?.enabled,
      me.data?.role,
      drinkPresets.data?.presets,
      trackers.data,
    ],
  );

  // A query that is off (its module is off) is pending but not fetching: it is not waited on.
  const waiting = (query: { isPending: boolean; isFetching: boolean }) =>
    query.isPending && query.isFetching;
  const settled =
    profile.isSuccess &&
    me.isSuccess &&
    !waiting(waterPreferences) &&
    !waiting(privateBody) &&
    !waiting(pain) &&
    !waiting(drinkPresets);

  return { kinds, trackers, settled };
}
