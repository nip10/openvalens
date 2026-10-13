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
