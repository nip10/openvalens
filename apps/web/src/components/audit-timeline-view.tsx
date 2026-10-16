import {
  auditActorLabel,
  auditDetailsLabel,
  auditEventLabel,
  auditTargetLabel,
  type AuditTimelineEntryView,
} from "@openvalens/api/presenters/audit-timeline";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";

export type AuditTimelineState = "loading" | "denied" | "error" | "ready";

type AuditTimelineViewProps = {
  state: AuditTimelineState;
  entries: AuditTimelineEntryView[];
  viewerUserId: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onRetry?: () => void;
};

/**
 * Value-free audit timeline list (Issue #132). Shows who did what and when —
 * event type, target identifier, actor — and never a record value; the API
 * does not return any.
 */
export function AuditTimelineView({
  state,
  entries,
  viewerUserId,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRetry,
}: AuditTimelineViewProps) {
  if (state === "loading") {
    return (
      <div className="grid gap-3" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (state === "denied") {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="font-medium">Audit log not available</p>
          <p className="text-sm text-muted-foreground">
            Only workspace owners can view the audit log.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load the audit log.{" "}
        {onRetry ? (
          <button type="button" className="underline" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="font-medium">No events</p>
          <p className="text-sm text-muted-foreground">
            Nothing matches these filters in this workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="py-0">
        <ul className="divide-y divide-border">
          {entries.map((entry) => {
            const target = auditTargetLabel(entry.targetType, entry.targetId);
            const details = auditDetailsLabel(entry.details);
            return (
              <li key={entry.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <time
                  dateTime={entry.occurredAt}
                  className="w-40 shrink-0 font-mono text-xs text-muted-foreground"
                >
                  {entry.occurredAt.slice(0, 16).replace("T", " ")} UTC
                </time>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{auditEventLabel(entry.eventType)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[auditActorLabel(entry.actorUserId, viewerUserId), target, details]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {entry.redacted ? <Badge variant="outline">Redacted</Badge> : null}
              </li>
            );
          })}
        </ul>
      </Card>
      {hasMore ? (
        <Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
