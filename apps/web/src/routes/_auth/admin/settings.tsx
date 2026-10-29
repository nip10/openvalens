import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MailPlus, Settings2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { AdminAiUsage } from "@/components/admin-ai-usage";
import { AdminBackupStatus } from "@/components/admin-backup-status";
import { AdminSettingsView } from "@/components/admin-settings-view";
import { ProductSettingsForm } from "@/components/product-settings-form";
import { Page, PageHeader } from "@/components/page";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { authClient } from "@/lib/auth-client";
import { isConfigPermissionDenied } from "@/utils/admin-settings-error";
import {
  adminAccessQueryOptions,
  adminAiUsageQueryOptions,
  adminBackupStatusQueryOptions,
  adminConfigurationQueryOptions,
} from "@/utils/admin-settings";
import { orpc, queryClient } from "@/utils/orpc";
import {
  isProductSettingsConflictError,
  productSettingsQueryOptions,
  type ProductSettingsSnapshot,
} from "@/utils/product-settings";
import { productSettingsQueryKey } from "@/utils/product-settings-keys";
import type { ProductSettingsUpdateInput } from "@openvalens/api/product-settings-contract";

export const Route = createFileRoute("/_auth/admin/settings")({
  component: AdminSettingsPage,
});

export type OwnerEpoch = {
  advance: () => void;
  capture: () => number;
  isLive: (generation: number) => boolean;
};

export function createOwnerEpoch(): OwnerEpoch {
  let generation = 0;
  return {
    advance: () => {
      generation += 1;
    },
    capture: () => generation,
    isLive: (value: number) => value === generation,
  };
}

function AdminSettingsPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user?.id;
  const hasUserId = !!userId;

  // Wait for the auth session to settle first. If the user is not signed in,
  // deny rather than spinning on a disabled query.
  if (sessionPending)
    return (
      <Page>
        <AdminSettingsView accessState="loading" />
      </Page>
    );
  if (!hasUserId)
    return (
      <Page>
        <AdminSettingsView accessState="denied" />
      </Page>
    );

  return <AuthenticatedAdminPage userId={userId} />;
}

function AuthenticatedAdminPage({ userId }: { userId: string }) {
  const access = useQuery({
    ...adminAccessQueryOptions(userId),
    enabled: true,
  });

  const isAdmin = access.data?.isInstanceAdmin === true;

  return (
    <Page>
      {isAdmin ? <AdminNav /> : null}

      {isAdmin ? (
        <ConfigurationSection userId={userId} access={access} />
      ) : (
        <PageHeader
          title={<Trans>Instance configuration</Trans>}
          description={<Trans>Administration</Trans>}
        />
      )}

      <div className="grid max-w-3xl gap-4">
        <ProductSettingsSection userId={userId} />
      </div>

      {isAdmin ? <AiUsageSection userId={userId} /> : null}

      {isAdmin ? <BackupSection userId={userId} /> : null}
    </Page>
  );
}

function ProductSettingsSection({ userId }: { userId: string }) {
  const epochRef = useRef<OwnerEpoch | null>(null);
  if (!epochRef.current) {
    epochRef.current = createOwnerEpoch();
  }
  const mountedRef = useRef(true);
  const { t } = useLingui();

  useLayoutEffect(() => {
    epochRef.current!.advance();
    mountedRef.current = true;
    return () => {
      epochRef.current!.advance();
      mountedRef.current = false;
    };
  }, [userId]);

  const isLiveOwner = (generation: number) => {
    return mountedRef.current && epochRef.current!.isLive(generation);
  };

  const productSettings = useQuery({
    ...productSettingsQueryOptions(userId),
    enabled: !!userId,
  });

  const update = useMutation(orpc.adminSettings.updateProductSettings.mutationOptions());

  const handleSave = async (
    payload: ProductSettingsUpdateInput,
  ): Promise<ProductSettingsSnapshot> => {
    const generation = epochRef.current!.capture();
    if (!isLiveOwner(generation)) {
      throw { code: "UNKNOWN" };
    }

    const cleanPayload: ProductSettingsUpdateInput = {
      units: payload.units,
      locale: payload.locale,
      expectedRevision: payload.expectedRevision,
    };

    try {
      const snapshot = await update.mutateAsync(cleanPayload);
      if (!isLiveOwner(generation)) {
        throw { code: "UNKNOWN" };
      }
      queryClient.setQueryData([...productSettingsQueryKey(userId)], snapshot);
      void queryClient.invalidateQueries({ queryKey: [...productSettingsQueryKey(userId)] });
      return snapshot;
    } catch (error) {
      if (isProductSettingsConflictError(error)) {
        throw { code: "CONFLICT" };
      }
      throw { code: "UNKNOWN" };
    }
  };

  const handleReloadLatest = async (): Promise<ProductSettingsSnapshot> => {
    const generation = epochRef.current!.capture();
    if (!isLiveOwner(generation)) {
      throw { code: "UNKNOWN" };
    }
    const snapshot = await queryClient.fetchQuery({
      ...productSettingsQueryOptions(userId),
    });
    if (!isLiveOwner(generation)) {
      throw { code: "UNKNOWN" };
    }
    return snapshot;
  };

  const hasData = productSettings.data != null;

  if (!hasData && productSettings.isPending) {
    return (
      <ProductSettingsForm
        ownerId={userId}
        readState={{ status: "loading" }}
        onSave={handleSave}
        onReloadLatest={handleReloadLatest}
      />
    );
  }

  if (!hasData && productSettings.isError) {
    return (
      <ProductSettingsForm
        ownerId={userId}
        readState={{
          status: "error",
          message: t`Could not load display defaults.`,
          onRetry: () => void productSettings.refetch(),
        }}
        onSave={handleSave}
        onReloadLatest={handleReloadLatest}
      />
    );
  }

  // Keep ReadyForm mounted while cached data exists, including during
  // background refetches. The verified hook's rebase will mark a stale
  // revision without discarding the user's draft.
  return (
    <>
      <ProductSettingsStatus />
      <ProductSettingsForm
        ownerId={userId}
        readState={{
          status: "ready",
          snapshot: productSettings.data,
        }}
        onSave={handleSave}
        onReloadLatest={handleReloadLatest}
      />
    </>
  );
}

function ConfigurationSection({
  userId,
  access,
}: {
  userId: string;
  access: UseQueryResult<{ isInstanceAdmin: boolean }, Error>;
}) {
  if (access.isPending || access.isFetching) {
    return <AdminSettingsView accessState="granted" configState="loading" />;
  }

  if (access.isError) {
    if (isConfigPermissionDenied(access.error)) {
      return <AdminSettingsView accessState="granted" configState="denied" />;
    }

    return (
      <AdminSettingsView
        accessState="granted"
        configState="error"
        onRetryConfig={() => void access.refetch()}
      />
    );
  }

  if (!access.data?.isInstanceAdmin) {
    return <AdminSettingsView accessState="granted" configState="denied" />;
  }

  return <ConfigurationInventory userId={userId} />;
}

function ConfigurationInventory({ userId }: { userId: string }) {
  const config = useQuery({
    ...adminConfigurationQueryOptions(userId),
    enabled: !!userId,
  });

  if (config.isPending || config.isFetching) {
    return <AdminSettingsView accessState="granted" configState="loading" />;
  }

  if (config.isError) {
    if (isConfigPermissionDenied(config.error)) {
      return <AdminSettingsView accessState="granted" configState="denied" />;
    }

    return (
      <AdminSettingsView
        accessState="granted"
        configState="error"
        onRetryConfig={() => void config.refetch()}
      />
    );
  }

  if (config.data) {
    return (
      <AdminSettingsView accessState="granted" configState="ready" entries={config.data.entries} />
    );
  }

  return <AdminSettingsView accessState="granted" configState="loading" />;
}

function AiUsageSection({ userId }: { userId: string }) {
  const usage = useQuery({ ...adminAiUsageQueryOptions(userId), enabled: !!userId });
  if (usage.data) return <AdminAiUsage status="ready" usage={usage.data} />;
  if (usage.isError) return <AdminAiUsage status="error" onRetry={() => void usage.refetch()} />;
  return <AdminAiUsage status="loading" />;
}

function BackupSection({ userId }: { userId: string }) {
  const backups = useQuery({ ...adminBackupStatusQueryOptions(userId), enabled: !!userId });
  if (backups.data) return <AdminBackupStatus status="ready" backups={backups.data} />;
  if (backups.isError)
    return <AdminBackupStatus status="error" onRetry={() => void backups.refetch()} />;
  return <AdminBackupStatus status="loading" />;
}

function AdminNav() {
  const { t } = useLingui();
  return (
    <nav aria-label={t`Instance administration`} className="-mb-4">
      <div className="inline-flex flex-wrap gap-1 rounded-full bg-paper-2 p-1">
        <a
          href="/admin/settings"
          aria-current="page"
          className="sheet inline-flex items-center gap-2 rounded-full px-4 py-2 font-display text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Settings2 className="size-4 shrink-0 text-signal" aria-hidden="true" />
          <Trans>Configuration</Trans>
        </a>
        <a
          href="/admin/invitations"
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-display text-sm font-medium text-ink-3 transition-colors duration-[var(--dur-short)] hover:bg-paper-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:text-ink"
        >
          <MailPlus className="size-4 shrink-0" aria-hidden="true" />
          <Trans>Invitations</Trans>
        </a>
      </div>
    </nav>
  );
}
