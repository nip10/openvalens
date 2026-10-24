import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { AiWorkspaceConsentCard } from "./ai-workspace-consent-card";

/**
 * Connected workspace AI switch: reads `ai.workspaceConsent.get` and, for the
 * owner, writes `ai.workspaceConsent.set`. The server enforces the owner check.
 */
export function AiWorkspaceConsentSection() {
  const queryClient = useQueryClient();
  const workspace = useQuery(orpc.ai.workspaceConsent.get.queryOptions({ input: {} }));
  const { t } = useLingui();

  const update = useMutation(
    orpc.ai.workspaceConsent.set.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: orpc.ai.workspaceConsent.key() });
        toast.success(
          result.enabled
            ? t({ message: "AI allowed in this workspace", comment: "safety" })
            : t({ message: "AI turned off for this workspace", comment: "safety" }),
        );
      },
      onError: () => toast.error(t`Could not update the workspace AI setting.`),
    }),
  );

  return (
    <AiWorkspaceConsentCard
      status={workspace.isPending ? "pending" : workspace.isError ? "error" : "ready"}
      state={workspace.data ?? null}
      isPending={update.isPending}
      onRetry={() => void workspace.refetch()}
      onChange={(enabled) => update.mutate({ enabled })}
    />
  );
}
