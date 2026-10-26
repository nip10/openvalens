import { useLingui } from "@lingui/react/macro";
import { goalProgressView, readinessView, SCORE_COPY } from "@openvalens/api/presenters/score";
import type { GoalProgressResult, ReadinessResult } from "@openvalens/api/score-contract";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Flag, Gauge, type LucideIcon, Target } from "lucide-react-native";
import { RefreshControl, Text, View } from "react-native";

import {
  ErrorState,
  Icon,
  InfoTip,
  Meter,
  Page,
  PageHeader,
  Prose,
  Ring,
  Sheet,
  StatusPill,
  type Tone,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { ReferenceComparisonsSection } from "@/components/reference-comparisons-section";
import { orpc } from "@/utils/orpc";
import {
  goalProgressCard,
  readinessCard,
  type ScoreCard,
  type ScoreRow,
} from "@/utils/score-screen";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #95 — "How am I doing?" on mobile: the experimental readiness index
 * and goal progress, never combined. Same view models as web
 * (`utils/score-screen.ts` → `@openvalens/api/presenters/score`). Every state
 * is in text; scores and rows carry screen-reader labels. Issue #96 adds the
 * opt-in reference comparisons below them, matching the web Scores page.
 *
 * Bloom: each score leads with a ring and its figure, the breakdown is soft
 * rows with a bar, and the intro, method, limits and version sit behind an ⓘ.
 */

/** A figure like "72", "40%" or "100% (target reached)" as a 0 to 1 share (as on web). */
function share(text: string): number | null {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value / 100 : null;
}

const FLAG_PREFIX = "⚑ ";

/** Where each of the card's notes goes: on show, as a chip, or behind an ⓘ. */
type NotePlacement = {
  /** Shown under the figure (coverage of goals). */
  unit: string | null;
  /** Shown as text (why a score is withheld, what would help). */
  visible: string[];
  /** A warning shown with a flag (flagged goals). */
  warning: string | null;
  /** A soft chip with its own ⓘ (the readiness profile). */
  chip: { label: string; tip: string[] } | null;
  /** Whether a row counted toward the score, by row key. */
  counted: Record<string, boolean>;
};

function readinessPlacement(result: ReadinessResult, i18n: Parameters<typeof readinessView>[1]) {
  const view = readinessView(result, i18n);
  return {
    unit: null,
    visible: [view.withheldExplanation, view.wouldHelpText].filter(
      (line): line is string => line !== null,
    ),
    warning: null,
    chip: view.profileLabel
      ? {
          label: view.profileLabel,
          tip: [view.profileDescription, view.coverageText].filter(
            (line): line is string => line !== null,
          ),
        }
      : null,
    counted: Object.fromEntries(view.components.map((c) => [String(c.key), c.used])),
  } satisfies NotePlacement;
}

function goalPlacement(result: GoalProgressResult, i18n: Parameters<typeof goalProgressView>[1]) {
  const view = goalProgressView(result, i18n);
  return {
    unit: view.coverageText,
    visible: [view.withheldExplanation].filter((line): line is string => line !== null),
    warning: view.flaggedText,
    chip: null,
    counted: Object.fromEntries(view.goals.map((g) => [String(g.key), g.counted])),
  } satisfies NotePlacement;
}

function BreakdownRow({ row, counted, tone }: { row: ScoreRow; counted: boolean; tone: Tone }) {
  const [state, ...rest] = row.lines;
  const flags = rest.filter((line) => line.startsWith(FLAG_PREFIX));
  const tip = rest.filter((line) => line && !line.startsWith(FLAG_PREFIX));
  const value = share(row.value);
  return (
    <View className="gap-2.5 rounded-2xl bg-paper-2 px-4 py-3.5">
      <View className="flex-row items-start justify-between gap-2">
        <View
          className="min-w-0 flex-1 gap-1.5"
          accessible
          accessibilityLabel={row.accessibilityLabel}
        >
          <Text className="font-sans text-base font-semibold text-ink">{row.label}</Text>
          {state ? <StatusPill tone={counted ? "good" : "neutral"}>{state}</StatusPill> : null}
        </View>
        {tip.length > 0 ? (
          <InfoTip title={row.label}>
            {tip.map((line) => (
              <Prose key={line}>{line}</Prose>
            ))}
          </InfoTip>
        ) : null}
        <Text
          className="shrink-0 font-display text-xl font-medium text-ink"
          style={{ fontVariant: ["tabular-nums"] }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {row.value}
        </Text>
      </View>
      {value !== null ? <Meter value={value} tone={tone} /> : null}
      {flags.map((line) => (
        <FlagLine key={line} text={line.slice(FLAG_PREFIX.length)} />
      ))}
    </View>
  );
}

function FlagLine({ text }: { text: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon icon={Flag} size={14} color="warning" />
      <Text className="shrink font-sans text-sm font-medium text-warning">{text}</Text>
    </View>
  );
}

function ScoreCardView({
  card,
  placement,
  icon,
  tone,
  breakdownTitle,
}: {
  card: ScoreCard;
  placement: NotePlacement;
  icon: LucideIcon;
  tone: Tone;
  breakdownTitle?: string;
}) {
  const { t } = useLingui();
  const ringValue = card.scoreText === "—" ? 0 : (share(card.scoreText) ?? 0);
  return (
    <Sheet className="gap-5">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="font-display text-xl font-semibold text-ink" accessibilityRole="header">
          {card.title}
        </Text>
        {card.badge ? <StatusPill tone="neutral">{card.badge}</StatusPill> : null}
        <InfoTip title={card.title}>
          <Prose>{card.intro}</Prose>
          <Text className="font-sans text-base font-semibold text-ink">
            {t`How this is calculated`}
          </Text>
          <Prose>{card.method}</Prose>
          <Prose>{card.limits}</Prose>
          <Text className="font-sans text-sm text-ink-3">{card.versionText}</Text>
        </InfoTip>
      </View>

      <View className="flex-row items-center gap-5">
        <View className="items-center justify-center">
          <Ring value={ringValue} tone={tone} size={104} />
          <View className="absolute">
            <ToneIcon icon={icon} tone={tone} />
          </View>
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text
            className="font-display text-[52px] font-medium leading-[58px] text-ink"
            style={{ fontVariant: ["tabular-nums"] }}
            accessible
            accessibilityLabel={card.scoreAccessibilityLabel}
          >
            {card.scoreText}
          </Text>
          {card.scoreSuffix ? (
            <Text className="font-sans text-sm text-ink-3">{card.scoreSuffix}</Text>
          ) : null}
          {placement.unit ? (
            <Text className="font-sans text-sm text-ink-3">{placement.unit}</Text>
          ) : null}
        </View>
      </View>

      {placement.visible.map((line) => (
        <Text key={line} className="font-sans text-base text-ink-2">
          {line}
        </Text>
      ))}
      {placement.warning ? <FlagLine text={placement.warning} /> : null}

      {placement.chip ? (
        <View className="flex-row flex-wrap items-center gap-1">
          <View className="rounded-full bg-sleep-soft px-2.5 py-1">
            <Text className="font-sans text-sm font-semibold text-ink">{placement.chip.label}</Text>
          </View>
          {placement.chip.tip.length > 0 ? (
            <InfoTip title={placement.chip.label}>
              {placement.chip.tip.map((line) => (
                <Prose key={line}>{line}</Prose>
              ))}
            </InfoTip>
          ) : null}
        </View>
      ) : null}

      {card.rows.length > 0 ? (
        <View className="gap-3">
          {breakdownTitle ? (
            <Text className="font-display text-base font-medium text-ink-2">{breakdownTitle}</Text>
          ) : null}
          <View className="gap-2.5">
            {card.rows.map((row) => (
              <BreakdownRow
                key={row.key}
                row={row}
                counted={placement.counted[row.key] ?? false}
                tone={tone}
              />
            ))}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

export default function ScoresScreen() {
  const readiness = useQuery(orpc.score.readiness.queryOptions({ input: {} }));
  const goals = useQuery(orpc.score.goalProgress.queryOptions({ input: {} }));
  const { t, i18n } = useLingui();
  const foreground = useThemeColor("foreground");

  const header = (
    <PageHeader
      title={i18n._(SCORE_COPY.pageTitle)}
      info={
        <>
          <Prose>{i18n._(SCORE_COPY.pageIntro)}</Prose>
          <Prose>{i18n._(SCORE_COPY.noStorage)}</Prose>
        </>
      }
    />
  );

  if (readiness.isPending || goals.isPending)
    return (
      <Container>
        <Page>
          {header}
          <Sheet className="h-72" />
          <Sheet className="h-72" />
        </Page>
      </Container>
    );

  if (readiness.isError || !readiness.data || goals.isError || !goals.data)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={t`Could not load your scores.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  void readiness.refetch();
                  void goals.refetch();
                }}
              >
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
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
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        {header}
        <ScoreCardView
          card={readinessCard(readiness.data, i18n)}
          placement={readinessPlacement(readiness.data, i18n)}
          icon={Gauge}
          tone="sleep"
          breakdownTitle={t`Breakdown`}
        />
        <ScoreCardView
          card={goalProgressCard(goals.data, i18n)}
          placement={goalPlacement(goals.data, i18n)}
          icon={Target}
          tone="weight"
        />
        <ReferenceComparisonsSection />
        <View className="flex-row items-center gap-2">
          <ToneIcon icon={Target} tone="weight" size="sm" />
          <Text className="shrink font-sans text-sm text-ink-3">
            {t`Set targets, directions and priorities for your goals under Workouts.`}
          </Text>
        </View>
      </Page>
    </Container>
  );
}
