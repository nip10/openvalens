import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, Download, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import { Section } from "@/components/page";
import { ENV } from "@/env";
import { client } from "@/utils/orpc";
import {
  completeExportDownloadUrl,
  completeExportPollInterval,
  type CompleteExportStatus,
} from "@/utils/complete-export";

const STATUS_KEY = ["dataRights", "exportStatus"] as const;

function failureMessage(failure: CompleteExportStatus["failure"]) {
  switch (failure) {
    case "LIMIT_EXCEEDED":
      return <Trans>This export is too large to prepare. Try the exports below.</Trans>;
    case "ATTACHMENT_UNAVAILABLE":
      return <Trans>Some stored attachments could not be included. You can try again.</Trans>;
    case "STORAGE_UNAVAILABLE":
      return <Trans>Export storage is unavailable right now. Try again later.</Trans>;
    case "INTERRUPTED":
      return <Trans>Preparation stopped before it finished. You can try again.</Trans>;
    default:
      return <Trans>Could not prepare the export. You can try again.</Trans>;
  }
}

export function CompleteExportCard() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<"generic" | "auth" | null>(null);
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => client.dataRights.exportStatus({}),
    refetchInterval: (query) => completeExportPollInterval(query.state.data),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  const request = useMutation({
    mutationFn: () => client.dataRights.exportRequest({}),
    onSuccess: (data) => {
      setActionError(null);
      queryClient.setQueryData(STATUS_KEY, data);
    },
    onError: (error) =>
      setActionError(
        (error as { code?: unknown } | null)?.code === "UNAUTHORIZED" ? "auth" : "generic",
      ),
  });
  const cancel = useMutation({
    mutationFn: (jobId: string) => client.dataRights.exportCancel({ jobId }),
    onSuccess: refresh,
    onError: (error) =>
      setActionError(
        (error as { code?: unknown } | null)?.code === "UNAUTHORIZED" ? "auth" : "generic",
      ),
  });
  const current = status.data;
  const pending = current?.state === "queued" || current?.state === "running";
  const signInRequired = (status.error as { code?: unknown } | null)?.code === "UNAUTHORIZED";
  let downloadHref: string | null = null;
  if (current?.state === "ready") {
    try {
      downloadHref = completeExportDownloadUrl(ENV.VITE_SERVER_URL, current.id);
    } catch {
      downloadHref = null;
    }
  }

  return (
    <Section
      sheet
      icon={Archive}
      tone="water"
      title={<Trans>Download everything</Trans>}
      info={<Trans>Prepare one ZIP file with your JSON records and stored attachments.</Trans>}
    >
      <div className="grid gap-4">
        <p className="max-w-2xl text-sm text-ink-2">
          <Trans>
            Preparation runs in the background. When it is ready, the download is available for 24
            hours.
          </Trans>
        </p>
        {status.isPending ? (
          <div className="grid gap-2" role="status" aria-live="polite">
            <span className="text-sm text-ink-3">
              <Trans>Checking export status…</Trans>
            </span>
            <Skeleton className="h-10 w-48 rounded-full" />
          </div>
        ) : null}
        {status.isError ? (
          <div role="alert" className="grid gap-2 text-sm text-ink-2">
            <p>
              {signInRequired ? (
                <Trans>Your session has ended. Sign in again to check your export.</Trans>
              ) : (
                <Trans>Could not check your export status.</Trans>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {signInRequired ? (
                <Button asChild variant="outline">
                  <Link to="/login">
                    <Trans>Sign in</Trans>
                  </Link>
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void status.refetch()}>
                <RefreshCw aria-hidden="true" className="size-4" />
                <Trans>Try again</Trans>
              </Button>
            </div>
          </div>
        ) : null}
        {current?.state === "queued" ? (
          <p role="status" className="text-sm text-ink-2">
            <Trans>Waiting to prepare your export…</Trans>
          </p>
        ) : null}
        {current?.state === "running" ? (
          <p role="status" className="text-sm text-ink-2">
            <Trans>Preparing your export…</Trans>
          </p>
        ) : null}
        {current?.state === "ready" ? (
          <p role="status" className="text-sm text-ink-2">
            <Trans>
              Your export is ready. It will be available for 24 hours after preparation.
            </Trans>
          </p>
        ) : null}
        {current?.state === "failed" ? (
          <p role="alert" className="text-sm text-destructive">
            {failureMessage(current.failure)}
          </p>
        ) : null}
        {current?.state === "cancelled" ? (
          <p role="status" className="text-sm text-ink-2">
            <Trans>Export preparation was cancelled.</Trans>
          </p>
        ) : null}
        {current?.state === "expired" ? (
          <p role="status" className="text-sm text-ink-2">
            <Trans>This export has expired. Request a new one if you still need it.</Trans>
          </p>
        ) : null}
        {actionError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            <p>
              {actionError === "auth" ? (
                <Trans>Your session has ended. Sign in again to check your export.</Trans>
              ) : (
                <Trans>That action did not complete. Try again.</Trans>
              )}
            </p>
            {actionError === "auth" ? (
              <Button asChild variant="outline">
                <Link to="/login">
                  <Trans>Sign in</Trans>
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {downloadHref ? (
            <Button asChild>
              <a href={downloadHref} aria-label={t`Download complete export ZIP`}>
                <Download aria-hidden="true" className="size-4" />
                <Trans>Download ZIP</Trans>
              </a>
            </Button>
          ) : null}
          {pending ? (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => current && cancel.mutate(current.id)}
            >
              <X aria-hidden="true" className="size-4" />
              {cancel.isPending ? <Trans>Stopping…</Trans> : <Trans>Cancel</Trans>}
            </Button>
          ) : null}
          {!pending && !status.isPending && !status.isError ? (
            <Button
              variant={current ? "outline" : "default"}
              disabled={request.isPending}
              onClick={() => {
                setActionError(null);
                request.mutate();
              }}
            >
              <Archive aria-hidden="true" className="size-4" />
              {request.isPending ? (
                <Trans>Requesting…</Trans>
              ) : current ? (
                <Trans>Prepare a new export</Trans>
              ) : (
                <Trans>Prepare export</Trans>
              )}
            </Button>
          ) : null}
          {current?.state === "ready" && !downloadHref ? (
            <p role="alert" className="text-sm text-destructive">
              <Trans>Download is unavailable for this server address.</Trans>
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
