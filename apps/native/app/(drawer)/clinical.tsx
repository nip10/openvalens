import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  formatYear,
  imagingTypeLabel,
  summaryText,
} from "@openhealth/api/presenters/clinical-records";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function ClinicalScreen() {
  const foreground = useThemeColor("foreground");
  const cardiac = useQuery(orpc.clinical.listCardiacExams.queryOptions({ input: {} }));
  const imaging = useQuery(orpc.clinical.listImagingStudies.queryOptions({ input: {} }));
  const family = useQuery(orpc.clinical.listFamilyHistory.queryOptions({ input: {} }));

  if (cardiac.isPending || imaging.isPending || family.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (cardiac.isError || imaging.isError || family.isError)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load clinical records.</Text>
        <Pressable
          onPress={() => {
            void cardiac.refetch();
            void imaging.refetch();
            void family.refetch();
          }}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={cardiac.isRefetching || imaging.isRefetching || family.isRefetching}
            onRefresh={() => {
              void cardiac.refetch();
              void imaging.refetch();
              void family.refetch();
            }}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-4 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Clinical</Text>
          <Text className="font-mono text-3xl text-foreground">Records</Text>
        </View>

        <Section
          title={`Cardiac · ${cardiac.data.length}`}
          rows={cardiac.data}
          renderItem={renderCardiac}
          emptyText="No cardiac exams recorded."
        />
        <Section
          title={`Imaging · ${imaging.data.length}`}
          rows={imaging.data}
          renderItem={renderImaging}
          emptyText="No imaging studies recorded."
        />
        <Section
          title={`Family history · ${family.data.length}`}
          rows={family.data}
          renderItem={renderFamily}
          emptyText="No family history entries."
        />
      </View>
    </Container>
  );
}

type CardProps<T> = {
  title: string;
  rows: readonly T[];
  renderItem: (row: T) => { headline: string; date: string; secondary: string };
  emptyText: string;
};

function Section<T>({ title, rows, renderItem, emptyText }: CardProps<T>) {
  return (
    <CardStack title={title}>
      <Card variant="secondary" className="p-0">
        {rows.length === 0 ? (
          <Text className="py-6 text-center text-sm text-muted-foreground">{emptyText}</Text>
        ) : (
          rows.map((row, index) => {
            const item = renderItem(row);
            return (
              <View
                key={index}
                className={`flex-row items-start justify-between gap-3 px-4 py-3 ${
                  index < rows.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-base text-foreground">{item.headline}</Text>
                  <Text className="text-xs text-muted-foreground">{item.secondary}</Text>
                </View>
                <Text className="shrink-0 font-mono text-sm text-muted-foreground">
                  {item.date}
                </Text>
              </View>
            );
          })
        )}
      </Card>
    </CardStack>
  );
}

type CardiacRow = {
  date: string;
  type: string;
  facility: string | null;
  conclusion: string | null;
};
function renderCardiac(row: CardiacRow): { headline: string; date: string; secondary: string } {
  return {
    headline: cardiacExamTypeLabel(row.type),
    date: row.date,
    secondary: `${row.facility ?? "—"} · ${summaryText(row.conclusion)}`,
  };
}

type ImagingRow = {
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  conclusion: string | null;
};
function renderImaging(row: ImagingRow): { headline: string; date: string; secondary: string } {
  return {
    headline: `${imagingTypeLabel(row.type)} · ${row.bodyPart}`,
    date: row.date,
    secondary: `${row.facility ?? "—"} · ${summaryText(row.conclusion)}`,
  };
}

type FamilyRow = {
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
};
function renderFamily(row: FamilyRow): { headline: string; date: string; secondary: string } {
  return {
    headline: `${familyRelationLabel(row.relation)} · ${row.condition}`,
    date: formatYear(row.ageOfOnset),
    secondary: summaryText(row.notes),
  };
}
