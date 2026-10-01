import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  formatYear,
  imagingTypeLabel,
  summaryText,
} from "@openhealth/api/presenters/clinical-records";
import { Card, CardContent, CardHeader, CardTitle } from "@openhealth/ui/components/card";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/clinical")({
  component: ClinicalPage,
});

function ClinicalPage() {
  const cardiac = useQuery(orpc.clinical.listCardiacExams.queryOptions({ input: {} }));
  const imaging = useQuery(orpc.clinical.listImagingStudies.queryOptions({ input: {} }));
  const family = useQuery(orpc.clinical.listFamilyHistory.queryOptions({ input: {} }));

  if (cardiac.isPending || imaging.isPending || family.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Clinical</h1>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (cardiac.isError || imaging.isError || family.isError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Clinical</h1>
        <p className="text-sm text-muted-foreground">
          Could not load clinical records.{" "}
          <button
            className="underline"
            onClick={() => {
              void cardiac.refetch();
              void imaging.refetch();
              void family.refetch();
            }}
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Clinical</h1>

      <Section
        title="Cardiac"
        rows={cardiac.data}
        renderItem={renderCardiac}
        emptyText="No cardiac exams recorded."
      />
      <Section
        title="Imaging"
        rows={imaging.data}
        renderItem={renderImaging}
        emptyText="No imaging studies recorded."
      />
      <Section
        title="Family history"
        rows={family.data}
        renderItem={renderFamily}
        emptyText="No family history entries."
      />
    </div>
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
    <Card className="py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>
          {title} · {rows.length}
        </CardTitle>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row, index) => {
            const item = renderItem(row);
            return (
              <li key={index} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.headline}</div>
                  <div className="text-sm text-muted-foreground">{item.secondary}</div>
                </div>
                <div className="shrink-0 font-mono text-sm text-muted-foreground">{item.date}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
