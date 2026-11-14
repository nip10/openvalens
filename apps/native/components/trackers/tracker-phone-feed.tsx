import { useLingui } from "@lingui/react/macro";
import { STATE_OF_MIND_LABELS, TRACKER_FEED_COPY } from "@openvalens/api/presenters/tracker-feeds";
import {
  feedsFor,
  feedSupportedOnIos,
  STATE_OF_MIND_CLASSIFICATIONS,
  TRACKER_FEED_DEFINITIONS,
  type TrackerFeed,
} from "@openvalens/trackers/feeds";
import type { TrackerType } from "@openvalens/trackers/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner, useToast } from "heroui-native";
import { useEffect } from "react";
import { Platform, Text, View } from "react-native";

import { Section, StatusPill } from "@/components/bloom";
import {
  feedCursorKey,
  feedStoreAvailable,
  forgetFeedCursor,
  importTrackerFeeds,
  iosMajorVersion,
  requestFeedAccess,
  type FeedResult,
} from "@/lib/tracker-feeds";
import { orpc } from "@/utils/orpc";

type FeedTracker = { id: string; name: string; type: TrackerType; archivedAt: string | null };

const phonePlatform = (): "ios" | "android" | null =>
  Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;

/**
 * Imports the member's linked tracker feeds when a trackers screen opens
 * (#452). Throttled in `importTrackerFeeds`; refreshes the trackers after
 * anything new arrived.
 */
export function useTrackerFeedImport() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!phonePlatform()) return;
    let active = true;
    void importTrackerFeeds().then((summary) => {
      const imported = Object.values(summary?.feeds ?? {}).some(
        (feed) => (feed?.imported ?? 0) > 0,
      );
      if (active && imported) void queryClient.invalidateQueries({ queryKey: orpc.trackers.key() });
    });
    return () => {
      active = false;
    };
  }, [queryClient]);
}

/**
 * "From your phone" in a tracker's settings (#452): link this tracker to
 * Apple Health mindful minutes, Health Connect mindfulness or Apple Health
 * State of Mind. One tracker per feed; the permission is asked only when
 * linking; unlinking keeps the entries already imported. Phone only: the web
 * shows the link read-only.
 */
export function TrackerPhoneFeeds({ tracker }: { tracker: FeedTracker }) {
  const { t } = useLingui();
  const platform = phonePlatform();
  const feeds = platform ? feedsFor(platform, tracker.type) : [];
  const links = useQuery({ ...orpc.trackers.feeds.queryOptions(), enabled: feeds.length > 0 });
  const store = useQuery({
    queryKey: ["tracker-feeds", "store-available"],
    queryFn: feedStoreAvailable,
    enabled: feeds.length > 0,
  });
  if (feeds.length === 0) return null;
  return (
    <Section
      title={t`From your phone`}
      description={t`Read only: nothing is written back to your phone's health data.`}
      sheet
    >
      {links.isPending || store.isPending ? (
        <Spinner />
      ) : links.isError ? (
        <Text accessibilityRole="alert" className="font-sans text-base text-ink-2">
          {t`Could not load the links. Try again.`}
        </Text>
      ) : (
        feeds.map((feed) => (
          <FeedRow
            key={feed}
            feed={feed}
            tracker={tracker}
            storeAvailable={store.data === true}
            link={links.data?.find((link) => link.feed === feed) ?? null}
          />
        ))
      )}
    </Section>
  );
}

function FeedRow({
  feed,
  tracker,
  link,
  storeAvailable,
}: {
  feed: TrackerFeed;
  tracker: FeedTracker;
  link: { trackerId: string; trackerName: string } | null;
  storeAvailable: boolean;
}) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const copy = TRACKER_FEED_COPY[feed];
  const definition = TRACKER_FEED_DEFINITIONS[feed];
  const storeName = copy.store;
  const supported = feedSupportedOnIos(feed, iosMajorVersion());
  const linkedHere = link?.trackerId === tracker.id;
  const linkedElsewhere = link !== null && !linkedHere;
  const otherName = link?.trackerName ?? "";

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.trackers.key() });
  };
  const describe = (result: FeedResult | undefined): string => {
    if (!result) return t`Nothing to import yet.`;
    switch (result.status) {
      case "ok":
      case "budget_exhausted": {
        const count = result.imported;
        return count === 0
          ? t`Up to date: no new entries.`
          : count === 1
            ? t`Imported 1 new entry.`
            : t`Imported ${count} new entries.`;
      }
      case "needs_permission":
        return t`Allow access in ${storeName} to import from this phone.`;
      case "not_linked":
        return t`This feed no longer fills this tracker.`;
      case "unsupported":
        return t`Needs iOS 18 or later.`;
      case "archived":
        return t`Restore this tracker to import into it.`;
      case "error":
        return t`Could not read ${storeName}. Check its permissions and try again.`;
    }
  };
  const importNow = async () => {
    const summary = await importTrackerFeeds({
      force: true,
      only: { feed, trackerId: tracker.id },
    });
    await refresh();
    return summary?.feeds[feed];
  };

  const linkFeed = useMutation({
    mutationFn: async () => {
      // The permission is asked here, only when the member links a tracker.
      const allowed = await requestFeedAccess(feed);
      if (!allowed) throw new Error(t`Allow access in ${storeName} to link it.`);
      if (!linkedHere) await orpc.trackers.linkFeed.call({ trackerId: tracker.id, feed });
      await queryClient.invalidateQueries({ queryKey: orpc.trackers.feeds.key() });
      return importNow();
    },
    onSuccess: (result) => toast.show({ variant: "success", label: describe(result) }),
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : t`Could not link it. Try again.`,
      }),
  });
  const unlink = useMutation({
    mutationFn: async () => {
      await orpc.trackers.unlinkFeed.call({ feed, trackerId: tracker.id });
      await forgetFeedCursor(feedCursorKey(feed, tracker.id));
    },
    onSuccess: async () => {
      toast.show({ variant: "success", label: t`Unlinked. The imported entries stay.` });
      await refresh();
    },
    onError: () => toast.show({ variant: "danger", label: t`Could not unlink it. Try again.` }),
  });
  const busy = linkFeed.isPending || unlink.isPending;

  return (
    <View
      testID={`tracker-feed-${feed}`}
      className="gap-3 border-b border-rule pb-4 last:border-b-0"
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="shrink font-sans text-base font-semibold text-ink">
          {i18n._(copy.name)}
        </Text>
        {linkedHere ? <StatusPill tone="good">{t`Linked`}</StatusPill> : null}
        {definition.experimental ? <StatusPill tone="warn">{t`May change`}</StatusPill> : null}
      </View>
      <Text className="font-sans text-sm text-ink-2">{i18n._(copy.description)}</Text>
      {definition.experimental ? (
        <Text className="font-sans text-sm text-ink-3">
          {t`Health Connect's mindfulness data is still an experimental feature, so how it works may change.`}
        </Text>
      ) : null}
      {feed === "healthkit_state_of_mind" ? <StateOfMindTable /> : null}

      {!supported ? (
        <Text testID={`tracker-feed-unsupported-${feed}`} className="font-sans text-sm text-ink-2">
          {t`Needs iOS 18 or later.`}
        </Text>
      ) : !storeAvailable ? (
        <Text className="font-sans text-sm text-ink-2">
          {t`${storeName} is not available on this phone.`}
        </Text>
      ) : tracker.archivedAt ? (
        <Text className="font-sans text-sm text-ink-2">{t`Restore this tracker to link it.`}</Text>
      ) : linkedHere ? (
        <View className="gap-2">
          <Text className="font-sans text-sm text-ink-2">
            {t`New entries are imported when you open your trackers and when the app syncs. If this phone has not been allowed yet, Import now asks.`}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              testID={`tracker-feed-import-${feed}`}
              isDisabled={busy}
              onPress={() => linkFeed.mutate()}
            >
              <Button.Label>{linkFeed.isPending ? t`Importing…` : t`Import now`}</Button.Label>
            </Button>
            <Button
              size="sm"
              variant="outline"
              testID={`tracker-feed-unlink-${feed}`}
              isDisabled={busy}
              onPress={() => unlink.mutate()}
            >
              <Button.Label>{unlink.isPending ? t`Unlinking…` : t`Unlink`}</Button.Label>
            </Button>
          </View>
          <Text className="font-sans text-sm text-ink-3">
            {t`Unlinking stops imports and keeps the entries already imported.`}
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {linkedElsewhere ? (
            <Text className="font-sans text-sm text-ink-2">
              {t`It now fills ${otherName}. Linking it here moves it; ${otherName} keeps its entries.`}
            </Text>
          ) : null}
          <Text className="font-sans text-sm text-ink-3">
            {t`${storeName} asks for permission to read this one data type when you link it.`}
          </Text>
          <Button
            size="sm"
            testID={`tracker-feed-link-${feed}`}
            isDisabled={busy}
            onPress={() => linkFeed.mutate()}
          >
            <Button.Label>
              {linkFeed.isPending ? t`Linking…` : t`Link to this tracker`}
            </Button.Label>
          </Button>
        </View>
      )}
    </View>
  );
}

/** The fixed State of Mind → 1-5 table, always shown in full. */
function StateOfMindTable() {
  const { t, i18n } = useLingui();
  return (
    <View testID="tracker-feed-state-of-mind-table" className="gap-1 rounded-xl bg-muted px-3 py-2">
      <Text className="font-sans text-sm font-semibold text-ink-2">
        {t`How a daily mood becomes 1 to 5`}
      </Text>
      {STATE_OF_MIND_CLASSIFICATIONS.map((row) => (
        <View key={row.key} className="flex-row items-center justify-between gap-3">
          <Text className="shrink font-sans text-sm text-ink-2">
            {i18n._(STATE_OF_MIND_LABELS[row.key])}
          </Text>
          <Text className="font-sans text-sm font-semibold text-ink">{String(row.mood)}</Text>
        </View>
      ))}
    </View>
  );
}
