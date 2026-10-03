import { Ionicons } from "@expo/vector-icons";
import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
} from "@openvalens/api/presenters/timeline";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Chip, Spinner } from "heroui-native";
import { Pressable, RefreshControl, SectionList, Text, View } from "react-native";

import { Container } from "@/components/container";
import { ListRow } from "@/components/list-row";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const PAGE_SIZE = 50;

const DOMAIN_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  sleep: "moon-outline",
  activity: "walk-outline",
  body: "body-outline",
  vitals: "pulse-outline",
  labs: "flask-outline",
  meds_supplements: "medkit-outline",
  calendar: "calendar-outline",
  sync: "sync-outline",
  imaging: "scan-outline",
  cardiac: "heart-outline",
};

export default function TimelineScreen() {
  const foreground = useThemeColor("foreground");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = useInfiniteQuery(
    orpc.timeline.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const sections = groupTimelineByDay(items, timeZone).map((group) => ({
    title: group.day,
    data: group.items,
  }));

  if (query.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (query.isError)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load the timeline.</Text>
        <Pressable
          onPress={() => void query.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  return (
    <Container isScrollable={false}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 gap-1"
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListEmptyComponent={
          <View className="items-center gap-1 py-16">
            <Text className="text-base font-medium text-foreground">No records yet</Text>
            <Text className="text-center text-sm text-muted-foreground">
              Connect Health Connect or Apple Health in Settings to sync your data.
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text className="pt-4 pb-2 font-mono text-sm text-muted-foreground">{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const tone = severityTone(item.severity);
          const source = sourceLabel(item);
          return (
            <View className="overflow-hidden rounded-xl bg-card">
              <ListRow
                icon={
                  <Ionicons
                    name={DOMAIN_ICONS[item.domain] ?? "ellipse-outline"}
                    size={20}
                    color={foreground}
                  />
                }
                title={item.title}
                subtitle={[item.time, item.summary, source ?? domainLabel(item.domain)]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  tone ? (
                    <Chip size="sm" color={tone === "destructive" ? "danger" : "warning"}>
                      <Chip.Label>
                        {tone === "destructive" ? "Needs attention" : "Check"}
                      </Chip.Label>
                    </Chip>
                  ) : undefined
                }
              />
            </View>
          );
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner className="my-4" /> : null}
      />
    </Container>
  );
}
