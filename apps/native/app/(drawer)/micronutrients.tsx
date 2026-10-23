import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_LABELS,
} from "@openvalens/api/presenters/micronutrients";
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

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            Micronutrients
          </Text>
          <Text className="text-sm text-muted-foreground">{MICRONUTRIENT_COPY.intro}</Text>
          <TextInput
            value={draftDate}
            onChangeText={setDraftDate}
            placeholder="YYYY-MM-DD"
            accessibilityLabel="Day, YYYY-MM-DD"
            className={INPUT}
            placeholderTextColor="#9ca3af"
          />
        </View>

        {summary.isPending ? (
          <Spinner />
        ) : summary.isError || !data ? (
          <Text className="text-sm text-foreground">Could not load the summary.</Text>
        ) : data.status === "off" ? (
          <Text className="text-sm text-foreground">{MICRONUTRIENT_COPY.off}</Text>
        ) : data.status === "hidden" ? (
          <Text className="text-sm text-foreground">{MICRONUTRIENT_COPY.hidden}</Text>
        ) : (
          <>
            <Card variant="secondary" className="gap-2 p-4">
              {data.reference ? (
                <>
                  <Text className="text-sm text-foreground">
                    Reference: {data.reference.sourceOrg}, {data.reference.populationLabel}.{" "}
                    {data.reference.licenceNote}
                  </Text>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(data.reference!.sourceUrl)}
                    className="min-h-11 justify-center"
                  >
                    <Text className="text-sm text-foreground underline">Source</Text>
                  </Pressable>
                </>
              ) : (
                <Text className="text-sm text-foreground">
                  {data.referenceNote === "adults_only"
                    ? MICRONUTRIENT_COPY.adultsOnly
                    : MICRONUTRIENT_COPY.noReference}
                </Text>
              )}
              <Text className="text-sm text-muted-foreground">
                {MICRONUTRIENT_COPY.intakeExplainer}
              </Text>
              <Text className="text-xs text-muted-foreground">
                Dataset {data.datasetVersion}. {MICRONUTRIENT_COPY.notAdvice}
              </Text>
            </Card>

            {data.totalEntries === 0 ? (
              <Text className="text-sm text-foreground">Nothing logged on this day.</Text>
            ) : (
              <CardStack title="By nutrient">
                {data.rows.map((row) => (
                  <Card key={row.nutrient} variant="secondary" className="gap-1 p-4">
                    <Text className="text-base font-medium text-foreground">
                      {MICRONUTRIENT_LABELS[row.nutrient]}
                      {row.amount !== null
                        ? `: ${row.atLeast ? "at least " : ""}${formatMicronutrientAmount(row.nutrient, row.amount)}`
                        : data.hideNumbers
                          ? ""
                          : ": unknown"}
                    </Text>
                    <Text className="text-sm text-foreground">{coverageText(row)}</Text>
                    {row.atLeast ? (
                      <Text className="text-sm text-muted-foreground">
                        {MICRONUTRIENT_COPY.incomplete}
                      </Text>
                    ) : null}
                    {row.percentOfReference !== null ? (
                      <Text className="text-sm text-foreground">
                        {row.percentOfReference}% of the intake reference below.
                      </Text>
                    ) : row.references.length && row.knownEntries < row.totalEntries ? (
                      <Text className="text-sm text-muted-foreground">
                        {MICRONUTRIENT_COPY.notCompared}
                      </Text>
                    ) : null}
                    {row.references.map((reference) => (
                      <Text key={reference.type} className="text-sm text-muted-foreground">
                        {describeReference(row.nutrient, reference)}
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
