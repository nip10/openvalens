import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_LABELS,
} from "@openvalens/api/presenters/micronutrients";
import type { MicronutrientSummaryWire } from "@openvalens/api/contracts/nutrition-micronutrients";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { client } from "@/utils/orpc";

/**
 * Opt-in micronutrient summary (#78) on mobile. Same server summary and copy
 * as the web page: unknown is never zero, coverage is always shown, and a day
 * is compared with the accepted reference only when every food reported it.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INPUT =
  "min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground";

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
  const reference = data?.reference ?? null;
  const sourceOrg = reference?.sourceOrg ?? "";
  const populationLabel = reference?.populationLabel ?? "";
  const licenceNote = reference?.licenceNote ?? "";
  const datasetVersion = data?.datasetVersion ?? "";
  const rowTitle = (
    row: Pick<MicronutrientSummaryWire["rows"][number], "nutrient" | "amount" | "atLeast">,
    hideNumbers: boolean,
  ) => {
    const label = i18n._(MICRONUTRIENT_LABELS[row.nutrient]);
    if (row.amount === null) return hideNumbers ? label : t`${label}: unknown`;
    const amount = formatMicronutrientAmount(row.nutrient, row.amount);
    return row.atLeast ? t`${label}: at least ${amount}` : t`${label}: ${amount}`;
  };

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            <Trans>Micronutrients</Trans>
          </Text>
          <Text className="text-sm text-muted-foreground">{i18n._(MICRONUTRIENT_COPY.intro)}</Text>
          <TextInput
            value={draftDate}
            onChangeText={setDraftDate}
            placeholder="YYYY-MM-DD"
            accessibilityLabel={t`Day, YYYY-MM-DD`}
            className={INPUT}
            placeholderTextColor="#9ca3af"
          />
        </View>

        {summary.isPending ? (
          <Spinner />
        ) : summary.isError || !data ? (
          <Text className="text-sm text-foreground">
            <Trans>Could not load the summary.</Trans>
          </Text>
        ) : data.status === "off" ? (
          <Text className="text-sm text-foreground">{i18n._(MICRONUTRIENT_COPY.off)}</Text>
        ) : data.status === "hidden" ? (
          <Text className="text-sm text-foreground">{i18n._(MICRONUTRIENT_COPY.hidden)}</Text>
        ) : (
          <>
            <Card variant="secondary" className="gap-2 p-4">
              {data.reference ? (
                <>
                  <Text className="text-sm text-foreground">
                    <Trans>
                      Reference: {sourceOrg}, {populationLabel}. {licenceNote}
                    </Trans>
                  </Text>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(data.reference!.sourceUrl)}
                    className="min-h-11 justify-center"
                  >
                    <Text className="text-sm text-foreground underline">
                      <Trans>Source</Trans>
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Text className="text-sm text-foreground">
                  {i18n._(
                    data.referenceNote === "adults_only"
                      ? MICRONUTRIENT_COPY.adultsOnly
                      : MICRONUTRIENT_COPY.noReference,
                  )}
                </Text>
              )}
              <Text className="text-sm text-muted-foreground">
                {i18n._(MICRONUTRIENT_COPY.intakeExplainer)}
              </Text>
              <Text className="text-xs text-muted-foreground">
                <Trans>Dataset {datasetVersion}.</Trans> {i18n._(MICRONUTRIENT_COPY.notAdvice)}
              </Text>
            </Card>

            {data.totalEntries === 0 ? (
              <Text className="text-sm text-foreground">
                <Trans>Nothing logged on this day.</Trans>
              </Text>
            ) : (
              <CardStack title={t`By nutrient`}>
                {data.rows.map((row) => (
                  <Card key={row.nutrient} variant="secondary" className="gap-1 p-4">
                    <Text className="text-base font-medium text-foreground">
                      {rowTitle(row, data.hideNumbers)}
                    </Text>
                    <Text className="text-sm text-foreground">{i18n._(coverageText(row))}</Text>
                    {row.atLeast ? (
                      <Text className="text-sm text-muted-foreground">
                        {i18n._(MICRONUTRIENT_COPY.incomplete)}
                      </Text>
                    ) : null}
                    {row.percentOfReference !== null ? (
                      <Text className="text-sm text-foreground">
                        {t`${row.percentOfReference}% of the intake reference below.`}
                      </Text>
                    ) : row.references.length && row.knownEntries < row.totalEntries ? (
                      <Text className="text-sm text-muted-foreground">
                        {i18n._(MICRONUTRIENT_COPY.notCompared)}
                      </Text>
                    ) : null}
                    {row.references.map((reference) => (
                      <Text key={reference.type} className="text-sm text-muted-foreground">
                        {describeReference(row.nutrient, reference, i18n)}
                      </Text>
                    ))}
                  </Card>
                ))}
              </CardStack>
            )}
          </>
        )}
      </View>
    </Container>
  );
}
