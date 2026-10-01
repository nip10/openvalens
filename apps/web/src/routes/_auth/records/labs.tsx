import { formatLabDate, formatLabValue } from "@openhealth/api/presenters/labs";
import { Card, CardContent } from "@openhealth/ui/components/card";
import { Skeleton } from "@openhealth/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/records/labs")({
  component: LabsPage,
});

function LabsPage() {
  const markers = useQuery(orpc.labs.latest.queryOptions({ input: { recentLimit: 10 } }));

  if (markers.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Labs</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (markers.isError || !markers.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Labs</h1>
        <p className="text-sm text-muted-foreground">
          Could not load labs.{" "}
          <button className="underline" onClick={() => void markers.refetch()}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  const list = markers.data;

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Labs</h1>

      {list.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No lab markers yet</p>
            <p className="text-sm text-muted-foreground">Import a lab PDF to add markers.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {list.map((marker) => (
              <li key={marker.code} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{marker.displayName}</div>
                  <div className="text-sm text-muted-foreground">
                    {marker.latestValue === null
                      ? "No readings yet"
                      : `${formatLabDate(marker.latestSampledAt)} · ${marker.sampleCount} reading${marker.sampleCount === 1 ? "" : "s"}`}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-lg">
                    {formatLabValue(marker.latestValue, marker.unit)}
                  </div>
                  <div className="text-xs text-muted-foreground">{marker.unit ?? ""}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
