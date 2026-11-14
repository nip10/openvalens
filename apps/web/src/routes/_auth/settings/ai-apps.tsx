import { Trans, useLingui } from "@lingui/react/macro";
import { aiAppTimelineSource, type AiAppGrantLike } from "@openvalens/api/presenters/ai-apps";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, ChevronLeft } from "lucide-react";
import { useState } from "react";

import { AiAppKeyCreated, AiAppKeyForm, type AiAppKeyDraft } from "@/components/ai-app-key-form";
import { AiAppActivity, AiAppsView } from "@/components/ai-apps-view";
import { Details, EmptyState, ErrorState, Page, PageHeader } from "@/components/page";
import { orpc } from "@/utils/orpc";

/**
 * Issue #439 — Settings → Connected AI apps. The security emails for a new
 * key or connection link here ("Not you? Revoke it here").
 */
export const Route = createFileRoute("/_auth/settings/ai-apps")({
  component: AiAppsSettingsPage,
});

function freshDraft(defaultExpiryDays: number | null): AiAppKeyDraft {
  return {
    label: "",
    scopes: [],
    expiresInDays: (defaultExpiryDays ?? 90) as AiAppKeyDraft["expiresInDays"],
    agreed: false,
  };
}

function AiAppsSettingsPage() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const status = useQuery(orpc.aiApps.status.queryOptions({ input: {} }));
  const enabled = status.data?.enabled === true;
  const grants = useQuery({
    ...orpc.aiApps.listGrants.queryOptions({ input: {} }),
    enabled,
  });

  const [confirmRevoke, setConfirmRevoke] = useState<AiAppGrantLike | null>(null);
  const [confirmDeleteWrites, setConfirmDeleteWrites] = useState<AiAppGrantLike | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiAppKeyDraft | null>(null);
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.aiApps.key() });

  const revoke = useMutation(
    orpc.aiApps.revokeGrant.mutationOptions({
      onMutate: () => setActionError(null),
      onError: () => setActionError(t`Could not revoke. Try again.`),
      onSettled: () => {
        setConfirmRevoke(null);
        void refresh();
      },
    }),
  );
  const deleteWrites = useMutation(
    orpc.aiApps.deleteWrites.mutationOptions({
      onMutate: () => setActionError(null),
      onError: () => setActionError(t`Could not delete the entries. Try again.`),
      onSettled: () => {
        setConfirmDeleteWrites(null);
        // The entries were in other screens too.
        void queryClient.invalidateQueries();
      },
    }),
  );
  const createKey = useMutation(
    orpc.aiApps.createKey.mutationOptions({
      onSuccess: (result) => {
        setCreated({ key: result.key, label: result.grant.label });
        setDraft(null);
        void refresh();
      },
    }),
  );

  const header = (
    <PageHeader
      title={<Trans>Connected AI apps</Trans>}
      description={<Trans>Let an AI app read your records to answer your questions.</Trans>}
      actions={
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 rounded-full px-1 text-sm font-medium text-ink-2 underline decoration-signal underline-offset-[0.15em] hover:text-ink hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <Trans>Settings</Trans>
        </Link>
      }
    />
  );

  if (status.isPending) {
    return (
      <Page width="narrow">
        {header}
        <Skeleton className="h-40 w-full rounded-3xl" />
      </Page>
    );
  }
  if (status.isError || !status.data) {
    return (
      <Page width="narrow">
        {header}
        <ErrorState
          title={<Trans>Could not load connected AI apps.</Trans>}
          action={
            <Button variant="outline" onClick={() => void status.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }
  if (!enabled) {
    return (
      <Page width="narrow">
        {header}
        <EmptyState
          icon={Bot}
          title={<Trans>Connected AI apps are not available on this server</Trans>}
          description={
            <Trans>
              The server's operator has not turned this on. Everything else works as usual.
            </Trans>
          }
        />
      </Page>
    );
  }

  const info = status.data;
  const createError = createKey.error
    ? createKey.error.message || t`Could not create the key.`
    : null;

  const keyPanel = created ? (
    <AiAppKeyCreated
      apiKey={created.key}
      label={created.label}
      mcpUrl={info.mcpUrl}
      onDone={() => setCreated(null)}
    />
  ) : draft ? (
    <AiAppKeyForm
      baseScope={info.baseScope}
      optInScopes={info.optInScopes}
      writeScopes={info.writeScopes}
      expiryDays={info.expiryDays}
      consentVersion={info.consentVersion}
      workspaceName={info.workspaceName}
      draft={draft}
      onDraftChange={setDraft}
      isSubmitting={createKey.isPending}
      error={createError}
      onSubmit={() =>
        createKey.mutate({
          label: draft.label.trim(),
          scopes: draft.scopes,
          expiresInDays: draft.expiresInDays,
          consentVersion: info.consentVersion,
        })
      }
      onCancel={() => {
        createKey.reset();
        setDraft(null);
      }}
    />
  ) : undefined;

  return (
    <Page width="narrow">
      {header}
      <AiAppsView
        status={info}
        grantsStatus={grants.isPending ? "pending" : grants.isError ? "error" : "ready"}
        grants={grants.data?.grants ?? []}
        onRetry={() => void grants.refetch()}
        confirmRevoke={confirmRevoke}
        onConfirmRevokeChange={setConfirmRevoke}
        onRevoke={(grant) => revoke.mutate({ grantId: grant.id })}
        revokingId={revoke.isPending ? (revoke.variables?.grantId ?? null) : null}
        actionError={actionError}
        onCreateKey={
          info.canCreate
            ? () => {
                createKey.reset();
                setCreated(null);
                setDraft(freshDraft(info.defaultExpiryDays));
              }
            : undefined
        }
        keyPanel={keyPanel}
        renderActivity={(grant) => <GrantActivity grantId={grant.id} />}
        confirmDeleteWrites={confirmDeleteWrites}
        onConfirmDeleteWritesChange={setConfirmDeleteWrites}
        onDeleteWrites={(grant) => deleteWrites.mutate({ grantId: grant.id })}
        deletingWritesId={deleteWrites.isPending ? (deleteWrites.variables?.grantId ?? null) : null}
        renderTimelineLink={(grant) => (
          <Link
            to="/records/timeline"
            search={{ source: aiAppTimelineSource(grant.id) }}
            className="font-medium text-ink underline-offset-4 hover:underline"
          >
            <Trans>Show on timeline</Trans>
          </Link>
        )}
      />
    </Page>
  );
}

/** "Recent activity" for one grant, loaded the first time it is opened. */
function GrantActivity({ grantId }: { grantId: string }) {
  const [opened, setOpened] = useState(false);
  const calls = useQuery({
    ...orpc.aiApps.recentActivity.queryOptions({ input: { grantId, limit: 20 } }),
    enabled: opened,
  });
  return (
    <Details
      summary={<Trans>Recent activity</Trans>}
      onOpenChange={(open) => {
        if (open) setOpened(true);
      }}
    >
      <AiAppActivity
        status={calls.isPending ? "pending" : calls.isError ? "error" : "ready"}
        calls={calls.data?.calls ?? []}
        onRetry={() => void calls.refetch()}
      />
    </Details>
  );
}
