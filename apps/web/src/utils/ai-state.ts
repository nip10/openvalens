import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

/**
 * Why AI can't run for this person, from the two switches it needs: the
 * workspace owner's "AI for this workspace" and the person's own consent.
 * `null` when both are on.
 */
export type AiOffReason = "workspace" | "personal" | null;

export function aiOffReason(
  workspace: { enabled: boolean } | null | undefined,
  personal: { granted: boolean; revokedAt: string | null } | null | undefined,
): AiOffReason {
  if (workspace && !workspace.enabled) return "workspace";
  if (personal !== undefined && !(personal?.granted && personal.revokedAt === null)) {
    return "personal";
  }
  return null;
}

/**
 * The AI state for this person. `reason` stays `null` while either switch
 * loads or fails to load, so nothing claims AI is off before it is known.
 */
export function useAiState(): {
  status: "pending" | "error" | "ready";
  reason: AiOffReason;
  /** Whether this person can change the workspace switch (its owner). */
  canManageWorkspace: boolean;
} {
  const workspace = useQuery({
    ...orpc.ai.workspaceConsent.get.queryOptions({ input: {} }),
    retry: false,
  });
  const personal = useQuery({ ...orpc.ai.consent.get.queryOptions({ input: {} }), retry: false });
  if (workspace.isPending || personal.isPending) {
    return { status: "pending", reason: null, canManageWorkspace: false };
  }
  if (workspace.isError || personal.isError) {
    return { status: "error", reason: null, canManageWorkspace: false };
  }
  return {
    status: "ready",
    reason: aiOffReason(workspace.data, personal.data ?? null),
    canManageWorkspace: workspace.data?.canManage === true,
  };
}
