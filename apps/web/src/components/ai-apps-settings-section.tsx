import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { AiAppsSettingsCard } from "./ai-apps-settings-card";

/** Whether the server has connected AI apps on (`aiApps.status`). */
export function useAiAppsEnabled(): boolean {
  return useQuery(orpc.aiApps.status.queryOptions({ input: {} })).data?.enabled === true;
}

/**
 * Issue #439 — wires {@link AiAppsSettingsCard} to `aiApps.workspaceSetting`.
 * Renders nothing while the server has AI apps off. The server enforces the
 * owner check.
 */
export function AiAppsSettingsSection() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const enabled = useAiAppsEnabled();
  const setting = useQuery({
    ...orpc.aiApps.workspaceSetting.get.queryOptions({ input: {} }),
    enabled,
  });
  const update = useMutation(
    orpc.aiApps.workspaceSetting.set.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: orpc.aiApps.key() });
        toast.success(
          result.membersCanConnect
            ? t`AI apps allowed in this workspace`
            : t`AI apps turned off for this workspace`,
        );
      },
      onError: () => toast.error(t`Could not update the setting.`),
    }),
  );

  if (!enabled) return null;
  return (
    <AiAppsSettingsCard
      setting={setting.data ?? null}
      settingStatus={setting.isPending ? "pending" : setting.isError ? "error" : "ready"}
      isSaving={update.isPending}
      onRetry={() => void setting.refetch()}
      onChange={(membersCanConnect) => update.mutate({ membersCanConnect })}
    />
  );
}
