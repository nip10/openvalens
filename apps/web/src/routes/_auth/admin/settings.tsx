import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AdminSettingsView } from "@/components/admin-settings-view";
import { authClient } from "@/lib/auth-client";
import { isConfigPermissionDenied } from "@/utils/admin-settings-error";
import { adminAccessQueryOptions, adminConfigurationQueryOptions } from "@/utils/admin-settings";

export const Route = createFileRoute("/_auth/admin/settings")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user?.id;
  const hasUserId = !!userId;

  const access = useQuery({
    ...adminAccessQueryOptions(userId ?? ""),
    enabled: hasUserId,
  });

  // Wait for the auth session to settle first. If the user is not signed in,
  // deny rather than spinning on a disabled query.
  if (sessionPending) return <AdminSettingsView accessState="loading" />;
  if (!hasUserId) return <AdminSettingsView accessState="denied" />;

  if (access.isPending || access.isFetching) {
    return <AdminSettingsView accessState="loading" />;
  }

  if (access.isError) {
    return <AdminSettingsView accessState="error" onRetryAccess={() => void access.refetch()} />;
  }

  if (!access.data?.isInstanceAdmin) {
    return <AdminSettingsView accessState="denied" />;
  }

  // Access is fresh and verified; the child can enable the configuration query.
  return <ConfigurationPage userId={userId} accessVerified />;
}

function AdminNav() {
  return (
    <nav className="container mx-auto max-w-3xl px-4 pt-4" aria-label="Instance administration">
      <div className="flex gap-2">
        <a
          href="/admin/settings"
          className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground"
        >
          Configuration
        </a>
        <a
          href="/admin/invitations"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Invitations
        </a>
      </div>
    </nav>
  );
}

function ConfigurationPage({
  userId,
  accessVerified,
}: {
  userId: string;
  accessVerified: boolean;
}) {
  const config = useQuery({
    ...adminConfigurationQueryOptions(userId),
    enabled: !!userId && accessVerified,
  });

  if (config.isPending || config.isFetching) {
    return (
      <>
        <AdminNav />
        <AdminSettingsView accessState="granted" configState="loading" />
      </>
    );
  }

  if (config.isError) {
    if (isConfigPermissionDenied(config.error)) {
      return (
        <>
          <AdminNav />
          <AdminSettingsView accessState="granted" configState="denied" />
        </>
      );
    }

    return (
      <>
        <AdminNav />
        <AdminSettingsView
          accessState="granted"
          configState="error"
          onRetryConfig={() => void config.refetch()}
        />
      </>
    );
  }

  if (config.data) {
    return (
      <>
        <AdminNav />
        <AdminSettingsView
          accessState="granted"
          configState="ready"
          entries={config.data.entries}
        />
      </>
    );
  }

  return (
    <>
      <AdminNav />
      <AdminSettingsView accessState="granted" configState="loading" />
    </>
  );
}
