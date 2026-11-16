import { Trans } from "@lingui/react/macro";
import { PowerOff } from "lucide-react";

import { type AiOffReason, useAiState } from "@/utils/ai-state";

/**
 * #settings-2 — at the top of Settings › AI: say plainly when AI is off and
 * which switch holds it, so a granted consent below doesn't read as "on".
 */
export function AiOffNoticeView({
  reason,
  canManageWorkspace,
}: {
  reason: AiOffReason;
  canManageWorkspace: boolean;
}) {
  if (reason === null) return null;
  return (
    <p
      role="status"
      data-testid="ai-off-notice"
      className="flex items-start gap-2 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2"
    >
      <PowerOff className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
      <span>
        {reason === "workspace" ? (
          canManageWorkspace ? (
            <Trans>
              AI is off for this workspace, so the coach and other AI features don't run. You can
              turn it on in AI for this workspace below.
            </Trans>
          ) : (
            <Trans>
              AI is off for this workspace, so the coach and other AI features don't run. Only the
              workspace owner can turn it on.
            </Trans>
          )
        ) : (
          <Trans>
            AI processing is off for you, so the coach and other AI features don't run. Turn it on
            below to use them.
          </Trans>
        )}
      </span>
    </p>
  );
}

export function AiOffNotice() {
  const ai = useAiState();
  return <AiOffNoticeView reason={ai.reason} canManageWorkspace={ai.canManageWorkspace} />;
}
