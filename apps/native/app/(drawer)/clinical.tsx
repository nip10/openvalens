import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  formatYear,
  imagingTypeLabel,
  summaryText,
} from "@openvalens/api/presenters/clinical-records";
import { CARE_LINK_COPY, familyCareLinksView } from "@openvalens/api/presenters/care-links";
import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import { HeartPulse, ScanLine, Users } from "lucide-react-native";
import { RefreshControl, Text, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListCard,
  type LucideIcon,
  Page,
  PageHeader,
  Section,
  Sheet,
  ToneIcon,
  DISPLAY_MAX_FONT_SCALE,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { friendlyDate } from "@/utils/friendly";
import { useModuleEnabled } from "@/lib/modules/use-modules";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export default function ClinicalScreen() {
  const foreground = useThemeColor("foreground");
  const { t, i18n } = useLingui();
  const cardiac = useQuery(orpc.clinical.listCardiacExams.queryOptions({ input: {} }));
  const imaging = useQuery(orpc.clinical.listImagingStudies.queryOptions({ input: {} }));
  const family = useQuery(orpc.clinical.listFamilyHistory.queryOptions({ input: {} }));
  // clinical#7: a screening link only for preventive items in the person's region.
  const careOn = useModuleEnabled("care");
  const preventive = useQuery({
    ...orpc.preventiveCare.get.queryOptions({ input: {} }),
    enabled: careOn,
  });
  const preventiveItemIds =
    careOn && preventive.data?.status === "available"
      ? [
          ...preventive.data.items.map((item) => item.id),
          ...preventive.data.notShown.map((item) => item.id),
        ]
      : [];
  const refetchAll = () => {
    void cardiac.refetch();
    void imaging.refetch();
    void family.refetch();
  };

  if (cardiac.isPending || imaging.isPending || family.isPending)
    return (
      <Container>
        <Page>
          <ModuleHiddenNote module="labs" />
          <PageHeader title={t`Clinical`} />
          <Sheet className="h-28 items-center justify-center">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );

  if (cardiac.isError || imaging.isError || family.isError)
    return (
      <Container>
        <Page>
          <ModuleHiddenNote module="labs" />
          <PageHeader title={t`Clinical`} />
          <ErrorState
            title={t`Could not load clinical records.`}
            action={
              <Button variant="outline" size="sm" onPress={refetchAll}>
                {t`Retry`}
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
            refreshing={cardiac.isRefetching || imaging.isRefetching || family.isRefetching}
            onRefresh={refetchAll}
            tintColor={foreground}
          />
        ),
      }}
    >
      <Page>
        <ModuleHiddenNote module="labs" />
        <PageHeader eyebrow={t`Clinical`} title={t`Records`} />

        <Sheet className="flex-row">
          <CountFigure icon={HeartPulse} label={t`Cardiac`} value={cardiac.data.length} />
          <CountFigure
            icon={ScanLine}
            label={t`Imaging`}
            value={imaging.data.length}
            className="border-l border-rule"
          />
          <CountFigure
            icon={Users}
            label={t`Family history`}
            value={family.data.length}
            className="border-l border-rule"
          />
        </Sheet>

        <RecordSection
          icon={HeartPulse}
          title={`${t`Cardiac`} (${cardiac.data.length})`}
          rows={cardiac.data}
          renderItem={(row) => renderCardiac(row, i18n)}
          emptyText={t`No cardiac exams recorded.`}
        />
        <RecordSection
          icon={ScanLine}
          title={`${t`Imaging`} (${imaging.data.length})`}
          rows={imaging.data}
          renderItem={(row) => renderImaging(row, i18n)}
          emptyText={t`No imaging studies recorded.`}
        />
        <RecordSection
          icon={Users}
          title={`${t`Family history`} (${family.data.length})`}
          rows={family.data}
          renderItem={(row) => renderFamily(row, i18n, preventiveItemIds)}
          emptyText={t`No family history entries.`}
          info={
            family.data.some((row) => familyCareLinksView(row.condition, i18n, preventiveItemIds))
              ? i18n._(CARE_LINK_COPY.familyInfo)
              : undefined
          }
        />
      </Page>
    </Container>
  );
}

/** One count in the headline card: its icon, the figure in Fraunces, its name. */
function CountFigure({
  icon,
  label,
  value,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <View className={`min-w-0 flex-1 items-center gap-2 px-2 ${className ?? ""}`}>
      <ToneIcon icon={icon} tone="water" size="sm" />
      <Text
        className="font-display text-[30px] font-medium leading-[36px] text-ink"
        style={{ fontVariant: ["tabular-nums"] }}
        maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
      >
        {value}
      </Text>
      <Text className="text-center font-sans text-sm text-ink-3" numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

type RecordItem = { headline: string; date: string; isDate: boolean; secondary: string };

type RecordSectionProps<T> = {
  icon: LucideIcon;
  title: string;
  rows: readonly T[];
  renderItem: (row: T) => RecordItem;
  emptyText: string;
  /** The section's one ⓘ (why family history shows "Relevant to" links). */
  info?: string;
};

function RecordSection<T>({
  icon,
  title,
  rows,
  renderItem,
  emptyText,
  info,
}: RecordSectionProps<T>) {
  const { i18n } = useLingui();
  return (
    <Section icon={icon} tone="water" title={title} info={info}>
      {rows.length === 0 ? (
        <EmptyState icon={icon} tone="water" title={emptyText} />
      ) : (
        <View className="gap-3">
          {rows.map((row, index) => {
            const item = renderItem(row);
            return (
              <ListCard
                key={index}
                icon={icon}
                tone="water"
                title={item.headline}
                subtitle={item.secondary}
                chip={item.isDate ? friendlyDate(i18n, item.date) : item.date}
              />
            );
          })}
        </View>
      )}
    </Section>
  );
}

type CardiacRow = {
  date: string;
  type: string;
  facility: string | null;
  conclusion: string | null;
};
function renderCardiac(row: CardiacRow, i18n: I18n): RecordItem {
  return {
    headline: cardiacExamTypeLabel(row.type, i18n),
    date: row.date,
    isDate: true,
    secondary: `${row.facility ?? "—"}, ${summaryText(row.conclusion)}`,
  };
}

type ImagingRow = {
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  conclusion: string | null;
};
function renderImaging(row: ImagingRow, i18n: I18n): RecordItem {
  return {
    headline: `${imagingTypeLabel(row.type, i18n)}, ${row.bodyPart}`,
    date: row.date,
    isDate: true,
    secondary: `${row.facility ?? "—"}, ${summaryText(row.conclusion)}`,
  };
}

type FamilyRow = {
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
};
function renderFamily(
  row: FamilyRow,
  i18n: I18n,
  preventiveItemIds: readonly string[],
): RecordItem {
  // clinical#7: the same "Relevant to: …" line as the web card, from the shared table.
  const links = familyCareLinksView(row.condition, i18n, preventiveItemIds);
  return {
    headline: `${familyRelationLabel(row.relation, i18n)}, ${row.condition}`,
    date: formatYear(row.ageOfOnset),
    isDate: false,
    secondary: links ? `${summaryText(row.notes)}\n${links.text}` : summaryText(row.notes),
  };
}
