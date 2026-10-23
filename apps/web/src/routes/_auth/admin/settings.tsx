import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";

import { AdminSettingsView } from "@/components/admin-settings-view";
import { ProductSettingsForm } from "@/components/product-settings-form";
import { ProductSettingsStatus } from "@/components/product-settings-status";
import { authClient } from "@/lib/auth-client";
import { isConfigPermissionDenied } from "@/utils/admin-settings-error";
import { adminAccessQueryOptions, adminConfigurationQueryOptions } from "@/utils/admin-settings";
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
  if (sessionPending) return <AdminSettingsView accessState="loading" />;
  if (!hasUserId) return <AdminSettingsView accessState="denied" />;

  return <AuthenticatedAdminPage userId={userId} />;
}

function AuthenticatedAdminPage({ userId }: { userId: string }) {
  const access = useQuery({
    ...adminAccessQueryOptions(userId),
    enabled: true,
  });

  const isAdmin = access.data?.isInstanceAdmin === true;

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      {isAdmin ? <AdminNav /> : null}

      <ProductSettingsSection userId={userId} />

      {isAdmin ? <ConfigurationSection userId={userId} access={access} /> : null}
    </div>
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

function AdminNav() {
  const { t } = useLingui();
  return (
    <nav className="container mx-auto max-w-3xl px-4 pt-4" aria-label={t`Instance administration`}>
      <div className="flex gap-2">
        <a
          href="/admin/settings"
          className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground"
        >
          <Trans>Configuration</Trans>
        </a>
        <a
          href="/admin/invitations"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Trans>Invitations</Trans>
        </a>
      </div>
    </nav>
  );
}
