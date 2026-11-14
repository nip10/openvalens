import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { availableLogKinds, logKindPermissionCheck } from "@openvalens/api/presenters/log-kinds";
import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { resolveHideNumbers } from "@openvalens/api/presenters/nutrition-targets";
import { buildWaterDayView, formatWaterSubtotal } from "@openvalens/api/presenters/plain-water";
import { isLocale } from "@openvalens/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { authClient } from "@/lib/auth-client";
import {
  buildHomeWidgetSnapshot,
  homeWidgetAvailability,
  supplementDosesDue,
  type HomeWidgetAvailability,
  type HomeWidgetSnapshot,
  type HomeWidgetValues,
} from "@/lib/home-widget/model";
import { drawHomeWidget, HOME_WIDGET_DRAWN_BY_APP } from "@/lib/home-widget/platform";
import {
  clearHomeWidgetSnapshot,
  useHomeWidgetValuesEnabled,
  writeHomeWidgetSnapshot,
} from "@/lib/home-widget/storage";
import { useModules } from "@/lib/modules/use-modules";
import { readCache } from "@/lib/offline/cache";
import { useCacheFirst, useOfflineScope, useQueuedSupplementIntakes } from "@/lib/offline/sync";
import { usePlainWaterOutbox } from "@/lib/plain-water/sync";
import { WATER_PREFERENCES_CACHE_KEY, waterCacheKey } from "@/lib/plain-water/view";
import { orpc } from "@/utils/orpc";

/**
 * Keeps the Android home-screen widget (#449) in step with the member:
 * buttons only for kinds that are on, in their language, and — only when they
 * turned it on in Settings — today's water and the supplement doses due.
 * Signed out, the widget forgets everything. Rendered once, in the drawer
 * layout. iOS has nothing to send: its widget is static (see
 * `lib/home-widget/platform.ts`).
 */
export function HomeWidgetSync() {
  if (!HOME_WIDGET_DRAWN_BY_APP) return null;
  return <AndroidHomeWidgetSync />;
}

function AndroidHomeWidgetSync() {
  const { i18n } = useLingui();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const localDate = localDateIn(timeZone);
  const availability = useWidgetAvailability(signedIn);
  const valuesEnabled = useHomeWidgetValuesEnabled();
  const values = useWidgetValues({
    enabled: signedIn && valuesEnabled === true && availability !== null,
    availability,
    timeZone,
    localDate,
    i18n,
  });

  // Until every answer is in, the widget keeps its last drawing.
  const snapshot =
    signedIn && availability && valuesEnabled !== null && values !== undefined
      ? buildHomeWidgetSnapshot({
          locale: isLocale(i18n.locale) ? i18n.locale : "en",
          availability,
          valuesEnabled,
          values,
        })
      : null;
  const snapshotKey = snapshot ? JSON.stringify(snapshot) : null;

  useEffect(() => {
    if (session.isPending) return;
    if (!signedIn) {
      void clearHomeWidgetSnapshot()
        .then(() => drawHomeWidget(null))
        .catch(() => {});
      return;
    }
    if (!snapshotKey) return;
    const next = JSON.parse(snapshotKey) as HomeWidgetSnapshot;
    void writeHomeWidgetSnapshot(next)
      .then(() => drawHomeWidget(next))
      .catch(() => {});
  }, [snapshotKey, signedIn, session.isPending]);

  return null;
}

/** Which buttons the member gets, once modules, role and the water preference are known. */
function useWidgetAvailability(signedIn: boolean): HomeWidgetAvailability | null {
  const { enabled, profile } = useModules();
  const me = useQuery({ ...orpc.sharing.me.queryOptions({ input: {} }), enabled: signedIn });
  const water = useCacheFirst(WATER_PREFERENCES_CACHE_KEY, {
    ...orpc.plainWater.getPreferences.queryOptions({ input: {} }),
    enabled: signedIn,
  });
  const settled = profile.isSuccess && me.isSuccess && water.isSuccess;
  return useMemo(
    () =>
      settled
        ? homeWidgetAvailability(
            availableLogKinds({
              enabledModules: [...enabled],
              preferences: { plain_water: water.data?.enabled === true },
              can: logKindPermissionCheck(me.data?.role),
            }),
          )
        : null,
    [settled, enabled, water.data?.enabled, me.data?.role],
  );
}

/**
 * The opt-in values: `null` when off or nothing to show, `undefined` while
 * they load. No value query runs while the option is off.
 */
function useWidgetValues(input: {
  enabled: boolean;
  availability: HomeWidgetAvailability | null;
  timeZone: string;
  localDate: string;
  i18n: I18n;
}): HomeWidgetValues | null | undefined {
  const { enabled, availability, timeZone, localDate, i18n } = input;
  const wantWater = enabled && availability?.water === true;
  const wantSupplements = enabled && availability?.supplement === true;

  const scope = useOfflineScope();
  const outbox = usePlainWaterOutbox();
  const day = useCacheFirst(waterCacheKey(localDate, timeZone), {
    ...orpc.plainWater.getDay.queryOptions({ input: { date: localDate, timeZone } }),
    enabled: wantWater,
  });
  const targetOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const targets = useQuery({
    ...targetOptions,
    queryKey: [...targetOptions.queryKey, { offlineScope: scope }],
    enabled: wantWater && Boolean(scope),
  });
  // The same switch as the nutrition screens; unknown reads as hidden.
  const hideNumbers = resolveHideNumbers(
    targets.isSuccess ? targets.data.settings.hideNumbers : undefined,
    wantWater && scope
      ? readCache<{ hideNumbers: boolean }>(scope, "nutrition-display-preference")?.data.hideNumbers
      : undefined,
  );

  // The picker's own query and cache key, so a "Taken" there updates the count here.
  const due = useCacheFirst(`quick-log:supplements-due:${timeZone}`, {
    ...orpc.quickLog.supplementsDue.queryOptions({ input: { timeZone } }),
    enabled: wantSupplements,
  });
  const queued = useQueuedSupplementIntakes();

  if (!enabled) return null;
  const loading = (query: { isPending: boolean; isFetching: boolean }) =>
    query.isPending && query.isFetching;
  if ((wantWater && (loading(day) || loading(targets))) || (wantSupplements && loading(due)))
    return undefined;

  const water =
    wantWater && day.data
      ? formatWaterSubtotal(
          buildWaterDayView(day.data, outbox.items, hideNumbers),
          "ml",
          hideNumbers,
          i18n,
        )
      : null;
  const supplementsDue =
    wantSupplements && due.data ? supplementDosesDue(due.data, queued, timeZone) : null;
  return { localDate, water, supplementsDue };
}
