import {
  AUDIT_EVENT_FILTER_OPTIONS,
  isAuditPermissionDenied,
} from "@openvalens/api/presenters/audit-timeline";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AuditTimelineView, type AuditTimelineState } from "@/components/audit-timeline-view";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/audit")({
  component: AuditPage,
});

const PAGE_SIZE = 50;
type Cursor = { occurredAt: string; id: number };

function AuditPage() {
  const [eventType, setEventType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const rangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const filters = {
    ...(eventType
      ? { eventTypes: [eventType as (typeof AUDIT_EVENT_FILTER_OPTIONS)[number]["value"]] }
      : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
  };

  const query = useInfiniteQuery({
    ...orpc.audit.timeline.infiniteOptions({
      input: (cursor: Cursor | undefined) => ({
        ...filters,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
    enabled: !rangeInvalid,
    // A permission denial will not change on retry.
    retry: (failureCount, error) => !isAuditPermissionDenied(error) && failureCount < 2,
  });

  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  const viewerUserId = query.data?.pages[0]?.viewerUserId ?? null;
  const state: AuditTimelineState = query.isError
    ? isAuditPermissionDenied(query.error)
      ? "denied"
      : "error"
    : query.isPending
      ? "loading"
      : "ready";

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Who changed, shared or exported records in this workspace, and when. Entries show event
          types and record identifiers only, never record values.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="audit-event-type">Event</Label>
          <select
            id="audit-event-type"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
          >
            <option value="">All events</option>
            {AUDIT_EVENT_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input
            id="audit-to"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
      </div>
      {rangeInvalid ? (
        <p className="text-sm text-destructive">
          The start date must be on or before the end date.
        </p>
      ) : null}

      <AuditTimelineView
        state={rangeInvalid ? "ready" : state}
        entries={rangeInvalid ? [] : entries}
        viewerUserId={viewerUserId}
        hasMore={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
        onRetry={() => void query.refetch()}
      />
    </div>
  );
}
