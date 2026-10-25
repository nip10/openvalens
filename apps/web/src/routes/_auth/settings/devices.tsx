import { Trans, useLingui } from "@lingui/react/macro";
import {
  wearableCallbackNotice,
  type WearableProviderId,
} from "@openvalens/api/presenters/wearables";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Page, PageHeader } from "@/components/page";
import { WearableDevicesView, type WearableConfirm } from "@/components/wearable-devices-view";
import { orpc } from "@/utils/orpc";

/**
 * Cloud wearable connections (Issue #60). The server's OAuth callback returns
 * the browser here with `?provider=<id>&status=connected|denied|failed|unauthenticated`.
 */
export const Route = createFileRoute("/_auth/settings/devices")({
  validateSearch: z.object({
    provider: z.string().optional(),
    status: z.string().optional(),
  }),
  component: DevicesSettingsPage,
});

function DevicesSettingsPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const [confirm, setConfirm] = useState<WearableConfirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncRequestedFor, setSyncRequestedFor] = useState<WearableProviderId | null>(null);

  const list = useQuery(orpc.wearables.list.queryOptions({ input: {} }));
  const providers = list.data?.providers ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.wearables.key() });

  const connect = useMutation(
    orpc.wearables.connect.mutationOptions({
      onMutate: () => setActionError(null),
      // Full-page navigation: the vendor returns to the server callback,
      // which needs this browser's session cookie, then back here.
      onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
      onError: () => setActionError(t`Could not start connecting. Try again.`),
    }),
  );
  const syncNow = useMutation(
    orpc.wearables.syncNow.mutationOptions({
      onMutate: () => {
        setActionError(null);
        setSyncRequestedFor(null);
      },
      onSuccess: (_data, input) => setSyncRequestedFor(input.provider),
      onError: () => setActionError(t`Could not request a sync.`),
      onSettled: () => void refresh(),
    }),
  );
  const disconnect = useMutation(
    orpc.wearables.disconnect.mutationOptions({
      onMutate: () => setActionError(null),
      onError: () => setActionError(t`Could not disconnect this device.`),
      onSettled: () => void refresh(),
    }),
  );
  const resolve = useMutation(
    orpc.wearables.resolveQuarantine.mutationOptions({
      onMutate: () => setActionError(null),
      onError: () => setActionError(t`Could not update these records.`),
      onSettled: () => void refresh(),
    }),
  );

  const running = [connect, syncNow, disconnect, resolve].find((mutation) => mutation.isPending);
  const busyProvider = running?.variables?.provider ?? null;

  const returnedName =
    providers.find((row) => row.provider === search.provider)?.displayName ?? search.provider ?? "";
  const notice = search.provider ? wearableCallbackNotice(search.status, returnedName) : null;

  const settingsLink = (
    <Link
      to="/settings"
      className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
    >
      <Trans>Settings</Trans>
    </Link>
  );

  return (
    <Page width="narrow">
      <PageHeader title={<Trans>Devices</Trans>} actions={settingsLink} />
      <WearableDevicesView
        status={list.isPending ? "pending" : list.isError ? "error" : "ready"}
        providers={providers}
        notice={notice}
        busyProvider={busyProvider}
        actionError={actionError}
        syncRequestedFor={syncRequestedFor}
        confirm={confirm}
        onConfirmChange={setConfirm}
        onRetry={() => void list.refetch()}
        onConnect={(provider) => connect.mutate({ provider })}
        onSyncNow={(provider) => syncNow.mutate({ provider })}
        onDisconnect={(provider, deleteData) => {
          setConfirm(null);
          disconnect.mutate({ provider, deleteData });
        }}
        onResolveQuarantine={(provider, action) => {
          setConfirm(null);
          resolve.mutate({ provider, action });
        }}
      />
    </Page>
  );
}
