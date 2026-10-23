import { useLingui } from "@lingui/react/macro";
import { SCORE_COPY } from "@openvalens/api/presenters/score";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { ReferenceComparisonsSection } from "@/components/reference-comparisons-section";
import { orpc } from "@/utils/orpc";
import { goalProgressCard, readinessCard, type ScoreCard } from "@/utils/score-screen";

/**
 * Issue #95 — "How am I doing?" on mobile: the experimental readiness index
 * and goal progress, never combined. Same view models as web
 * (`utils/score-screen.ts` → `@openvalens/api/presenters/score`). Every state
 * is in text; scores and rows carry screen-reader labels. Issue #96 adds the
 * opt-in reference comparisons below them, matching the web Scores page.
 */
function ScoreCardView({ card }: { card: ScoreCard }) {
  const [showMethod, setShowMethod] = useState(false);
  const { t } = useLingui();
  return (
    <CardStack>
      <Card variant="secondary" className="gap-3 p-4">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
            {card.title}
          </Text>
          {card.badge ? (
            <View className="rounded-full border border-border px-2 py-0.5">
              <Text className="text-xs font-medium text-foreground">{card.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text className="text-sm text-muted-foreground">{card.intro}</Text>
        <View
          className="flex-row items-baseline gap-2"
          accessible
          accessibilityLabel={card.scoreAccessibilityLabel}
        >
          <Text className="font-mono text-4xl text-foreground">{card.scoreText}</Text>
          {card.scoreSuffix ? (
            <Text className="text-sm text-muted-foreground">{card.scoreSuffix}</Text>
          ) : null}
        </View>
        {card.notes.map((note) => (
          <Text key={note} className="text-sm text-foreground">
            {note}
          </Text>
        ))}
        {card.rows.map((row) => (
          <View
            key={row.key}
            className="flex-row items-start justify-between gap-3 border-t border-border pt-2"
            accessible
            accessibilityLabel={row.accessibilityLabel}
          >
            <View className="min-w-0 flex-1">
              <Text className="text-base text-foreground">{row.label}</Text>
              {row.lines.map((line) => (
                <Text key={line} className="text-xs text-muted-foreground">
                  {line}
                </Text>
              ))}
            </View>
            <Text className="font-mono text-sm text-foreground">{row.value}</Text>
          </View>
        ))}
        <Pressable
          onPress={() => setShowMethod((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showMethod }}
          className="min-h-11 justify-center"
        >
          <Text className="font-medium text-foreground underline">{t`How this is calculated`}</Text>
        </Pressable>
        {showMethod ? <Text className="text-sm text-muted-foreground">{card.method}</Text> : null}
        <Text className="text-sm text-muted-foreground">{card.limits}</Text>
        <Text className="text-xs text-muted-foreground">{card.versionText}</Text>
      </Card>
    </CardStack>
  );
}

export default function ScoresScreen() {
  const readiness = useQuery(orpc.score.readiness.queryOptions({ input: {} }));
  const goals = useQuery(orpc.score.goalProgress.queryOptions({ input: {} }));
  const { t, i18n } = useLingui();

  if (readiness.isPending || goals.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (readiness.isError || !readiness.data || goals.isError || !goals.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">{t`Could not load your scores.`}</Text>
        <Pressable
          onPress={() => {
            void readiness.refetch();
            void goals.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">{t`Retry`}</Text>
        </Pressable>
      </Container>
    );

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={readiness.isRefetching || goals.isRefetching}
            onRefresh={() => {
              void readiness.refetch();
              void goals.refetch();
            }}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View className="gap-1">
          <Text className="font-mono text-3xl text-foreground">{i18n._(SCORE_COPY.pageTitle)}</Text>
          <Text className="text-sm text-muted-foreground">{i18n._(SCORE_COPY.pageIntro)}</Text>
          <Text className="text-xs text-muted-foreground">{i18n._(SCORE_COPY.noStorage)}</Text>
        </View>
        <ScoreCardView card={readinessCard(readiness.data, i18n)} />
        <ScoreCardView card={goalProgressCard(goals.data, i18n)} />
        <ReferenceComparisonsSection />
        <Text className="text-sm text-muted-foreground">
          {t`Set targets, directions and priorities for your goals under Workouts.`}
        </Text>
      </View>
    </Container>
  );
}
