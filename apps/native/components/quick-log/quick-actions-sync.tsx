import { useLingui } from "@lingui/react";
import { deviceTimeZone } from "@openvalens/api/presenters/nutrition-diary";
import { useQuery } from "@tanstack/react-query";
import * as QuickActions from "expo-quick-actions";
import { type Href, usePathname, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import {
  buildQuickActions,
  QUICK_LOG_PATH,
  quickActionHref,
  type QuickActionItem,
} from "@/lib/quick-log/quick-actions";
import { useLogKinds } from "@/lib/quick-log/use-log-kinds";
import { orpc } from "@/utils/orpc";

/** The launch action is read once per run: remounting the drawer must not open it again. */
let launchActionRead = false;

function setItems(items: QuickActionItem[]) {
  // A build without the native module (an older dev client) has a no-op here.
  QuickActions.setItems(items).catch(() => {});
}

/**
 * App-icon quick actions (#440). Keeps the long-press shortcuts in step with
 * the member: their three most-used log kinds and "Log…", in their language,
 * only for features that are on. It updates when the counts, the modules or
 * the language change, and clears them on sign-out. A tap opens the log
 * picker at that kind (`/quick-log?kind=<id>`). Rendered once, in the drawer
 * layout, which stays mounted.
 */
export function QuickActionsSync() {
  const { i18n } = useLingui();
  const router = useRouter();
  const pathname = usePathname();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const { kinds, settled } = useLogKinds({ timeZone, enabled: signedIn });
  const canRecords = kinds.some((kind) => kind.permission.resource === "records");
  // The same query as the picker, so a log there refreshes the counts here.
  const recents = useQuery({
    ...orpc.quickLog.recents.queryOptions({ input: {} }),
    enabled: signedIn && settled && canRecords,
  });

  // Only once everything that can take a kind away is known; until then the
  // shortcuts from the last run stay.
  const ready = signedIn && settled && (!canRecords || recents.isSuccess);
  const items = ready
    ? buildQuickActions(
        {
          kinds,
          kindCounts: recents.data?.kindCounts,
          platform: Platform.OS === "ios" ? "ios" : "android",
        },
        i18n,
      )
    : null;
  const itemsKey = items ? JSON.stringify(items) : null;

  useEffect(() => {
    if (Platform.OS === "web" || session.isPending) return;
    if (!signedIn) {
      setItems([]);
      return;
    }
    if (itemsKey) setItems(JSON.parse(itemsKey) as QuickActionItem[]);
  }, [itemsKey, signedIn, session.isPending]);

  // A tap: the one that launched the app, then any while it runs.
  const [pending, setPending] = useState<string | null>(() => {
    if (launchActionRead) return null;
    launchActionRead = true;
    return quickActionHref(QuickActions.initial);
  });
  useEffect(() => {
    const subscription = QuickActions.addListener((action) => {
      const href = quickActionHref(action);
      if (href) setPending(href);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!pending || session.isPending) return;
    setPending(null);
    // Signed out, the sign-in screen stays.
    if (!signedIn) return;
    const href = pending as Href;
    // The picker already open: replace it, so the new kind opens fresh.
    setTimeout(() => (pathname === QUICK_LOG_PATH ? router.replace(href) : router.push(href)));
  }, [pending, session.isPending, signedIn, pathname, router]);

  return null;
}
