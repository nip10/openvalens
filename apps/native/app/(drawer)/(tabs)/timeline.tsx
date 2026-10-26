import { useLingui } from "@lingui/react/macro";
import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
} from "@openvalens/api/presenters/timeline";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import {
  Activity,
  CalendarDays,
  FlaskConical,
  Footprints,
  HeartPulse,
  History,
  type LucideIcon,
  Moon,
  Pill,
  RefreshCw,
  Scale,
  ScanLine,
  Sparkles,
} from "lucide-react-native";
import { RefreshControl, SectionList, Text, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  Page,
  PageHeader,
  Sheet,
  type Tone,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const PAGE_SIZE = 50;

// The same icon and tone per domain as the web timeline.
const DOMAIN_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  sleep: { icon: Moon, tone: "sleep" },
  activity: { icon: Footprints, tone: "steps" },
  body: { icon: Scale, tone: "weight" },
  vitals: { icon: HeartPulse, tone: "heart" },
  labs: { icon: FlaskConical, tone: "water" },
  meds_supplements: { icon: Pill, tone: "food" },
  calendar: { icon: CalendarDays, tone: "signal" },
  sync: { icon: RefreshCw, tone: "signal" },
  imaging: { icon: ScanLine, tone: "water" },
  cardiac: { icon: Activity, tone: "heart" },
};
const OTHER_DOMAIN = { icon: Sparkles, tone: "signal" } as const;

export default function TimelineScreen() {
  const foreground = useThemeColor("foreground");
  const { t, i18n } = useLingui();
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

  const header = <PageHeader title={t`Timeline`} />;

  if (query.isPending)
    return (
      <Container>
        <Page>
          {header}
          <View className="gap-3">
            <Sheet className="h-20" />
            <Sheet className="h-20" />
            <Sheet className="h-20" />
          </View>
        </Page>
      </Container>
    );

  if (query.isError)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={t`Could not load the timeline.`}
            action={
              <Button variant="outline" size="sm" onPress={() => void query.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  return (
    <Container isScrollable={false}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-2 px-4 pb-12 pt-4"
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={foreground}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListHeaderComponent={<View className="pb-2">{header}</View>}
        ListEmptyComponent={
          <EmptyState
            icon={History}
            tone="signal"
            title={t`No records yet`}
            description={t`Connect Health Connect or Apple Health in Settings to sync your data.`}
          />
        }
        renderSectionHeader={({ section }) => (
          <Text
            className="pb-1 pt-5 font-display text-xl font-semibold text-ink"
            accessibilityRole="header"
          >
            {friendlyDate(i18n, section.title)}
          </Text>
        )}
        renderItem={({ item }) => {
          const tone = severityTone(item.severity);
          const source = sourceLabel(item);
          const look = DOMAIN_ICON[item.domain] ?? OTHER_DOMAIN;
          return (
            <ListCard
              icon={look.icon}
              tone={look.tone}
              title={item.title}
              chip={item.time || undefined}
              status={
                tone
                  ? {
                      label: tone === "destructive" ? t`Needs attention` : t`Check`,
                      tone: tone === "destructive" ? "bad" : "warn",
                    }
                  : undefined
              }
              subtitle={[item.summary, source ?? i18n._(domainLabel(item.domain))]
                .filter(Boolean)
                .join(", ")}
            />
          );
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner className="my-4" /> : null}
      />
    </Container>
  );
}
