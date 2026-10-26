import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_LABELS,
} from "@openvalens/api/presenters/micronutrients";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button } from "heroui-native";
import { SlidersHorizontal, Sprout } from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  Icon,
  InfoTip,
  ListCard,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
  StatusPill,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { friendlyDate } from "@/utils/friendly";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Opt-in micronutrient summary (#78) on mobile. Same server summary and copy
 * as the web page: unknown is never zero, coverage is always shown, and a day
 * is compared with the accepted reference only when every food reported it.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INPUT =
  "min-h-11 rounded-xl border border-rule bg-sheet px-3 py-2 font-sans text-base text-ink";

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

export default function MicronutrientsScreen() {
  const [draftDate, setDraftDate] = useState(localToday());
  const localDate = DATE.test(draftDate) ? draftDate : localToday();
  const summary = useQuery({
    queryKey: ["nutritionMicronutrients", "summary", localDate],
    queryFn: () => client.nutritionMicronutrients.summary({ localDate }),
  });
  const data = summary.data;
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const reference = data?.reference ?? null;
  const sourceOrg = reference?.sourceOrg ?? "";
  const populationLabel = reference?.populationLabel ?? "";
  const licenceNote = reference?.licenceNote ?? "";
  const datasetVersion = data?.datasetVersion ?? "";

  return (
    <Container>
      <Page>
        <PageHeader
          title={<Trans>Micronutrients</Trans>}
          info={i18n._(MICRONUTRIENT_COPY.intro)}
          actions={
            <Link href="/nutrition-targets" asChild>
              <Button variant="outline" size="sm">
                <Icon icon={SlidersHorizontal} size={16} color="food" />
                <Button.Label>{t`Nutrition settings`}</Button.Label>
              </Button>
            </Link>
          }
        />

        <View className="gap-1.5">
          <Text className="font-sans text-sm font-medium text-ink-3">
            <Trans>Day</Trans>
          </Text>
          <TextInput
            value={draftDate}
            onChangeText={setDraftDate}
            placeholder="YYYY-MM-DD"
            accessibilityLabel={t`Day, YYYY-MM-DD`}
            className={INPUT}
            style={{ fontVariant: ["tabular-nums"] }}
            placeholderTextColor={placeholder}
          />
        </View>

        {summary.isPending ? (
          <Sheet>
            <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
          </Sheet>
        ) : summary.isError || !data ? (
          <ErrorState
            title={<Trans>Could not load the summary.</Trans>}
            action={
              <Button variant="secondary" size="sm" onPress={() => void summary.refetch()}>
                <Button.Label>{t`Try again`}</Button.Label>
              </Button>
            }
          />
        ) : data.status === "off" ? (
          <EmptyState icon={Sprout} tone="food" title={i18n._(MICRONUTRIENT_COPY.off)} />
        ) : data.status === "hidden" ? (
          <EmptyState icon={Sprout} tone="food" title={i18n._(MICRONUTRIENT_COPY.hidden)} />
        ) : (
          <Section
            icon={Sprout}
            tone="food"
            title={friendlyDate(i18n, localDate)}
            info={
              <>
                {data.reference ? (
                  <>
                    <Prose>
                      <Trans>
                        Reference: {sourceOrg}, {populationLabel}. {licenceNote}
                      </Trans>
                    </Prose>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(data.reference!.sourceUrl)}
                      className="min-h-11 justify-center self-start"
                    >
                      <Text className="font-sans text-base text-signal underline">
                        <Trans>Source</Trans>
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Prose>
                    {i18n._(
                      data.referenceNote === "adults_only"
                        ? MICRONUTRIENT_COPY.adultsOnly
                        : MICRONUTRIENT_COPY.noReference,
                    )}
                  </Prose>
                )}
                <Prose className="text-ink-3">{i18n._(MICRONUTRIENT_COPY.intakeExplainer)}</Prose>
                <Prose className="text-ink-3">
                  <Trans>Dataset {datasetVersion}.</Trans>
                </Prose>
              </>
            }
          >
            {/* Safety copy stays on the surface, not behind the ⓘ. */}
            <Text className="font-sans text-sm text-ink-3">
              {i18n._(MICRONUTRIENT_COPY.notAdvice)}
            </Text>
            {data.totalEntries === 0 ? (
              <EmptyState
                icon={Sprout}
                tone="food"
                title={<Trans>Nothing logged on this day.</Trans>}
                action={
                  <Link href="/nutrition" asChild>
                    <Button variant="outline" size="sm">
                      <Button.Label>{t`Back to meal diary`}</Button.Label>
                    </Button>
                  </Link>
                }
              />
            ) : (
              <View className="gap-3">
                {data.rows.map((row) => {
                  const compared = row.percentOfReference !== null;
                  const notCompared =
                    row.percentOfReference === null &&
                    row.references.length > 0 &&
                    row.knownEntries < row.totalEntries;
                  const chip =
                    row.amount === null
                      ? data.hideNumbers
                        ? t`Hidden`
                        : t`Unknown`
                      : `${row.atLeast ? "≥ " : ""}${formatMicronutrientAmount(row.nutrient, row.amount)}`;
                  return (
                    <ListCard
                      key={row.nutrient}
                      icon={Sprout}
                      tone="food"
                      title={i18n._(MICRONUTRIENT_LABELS[row.nutrient])}
                      subtitle={i18n._(coverageText(row))}
                      chip={chip}
                      trailing={
                        row.references.length > 0 || row.atLeast ? (
                          <InfoTip title={i18n._(MICRONUTRIENT_LABELS[row.nutrient])}>
                            {row.atLeast ? (
                              <Prose>{i18n._(MICRONUTRIENT_COPY.incomplete)}</Prose>
                            ) : null}
                            {notCompared ? (
                              <Prose>{i18n._(MICRONUTRIENT_COPY.notCompared)}</Prose>
                            ) : null}
                            {row.references.map((ref) => (
                              <Prose key={ref.type} className="text-ink-3">
                                {describeReference(row.nutrient, ref, i18n)}
                              </Prose>
                            ))}
                          </InfoTip>
                        ) : undefined
                      }
                    >
                      {compared ? (
                        <Text className="font-sans text-sm text-ink-3">
                          <Text
                            className="font-sans font-semibold text-ink"
                            style={{ fontVariant: ["tabular-nums"] }}
                          >
                            {row.percentOfReference}
                          </Text>
                          <Trans>% of reference</Trans>
                        </Text>
                      ) : null}
                      {notCompared ? (
                        <StatusPill tone="neutral">
                          <Trans>Not compared</Trans>
                        </StatusPill>
                      ) : null}
                    </ListCard>
                  );
                })}
              </View>
            )}
          </Section>
        )}
      </Page>
    </Container>
  );
}
