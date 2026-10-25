import { Trans, useLingui } from "@lingui/react/macro";
import type { AppRouterClient } from "@openvalens/api/routers/index";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";

import { ErrorState, Section } from "@/components/page";

/** Workspace AI switch as the caller sees it, derived from the oRPC output type. */
export type AiWorkspaceConsentState = Awaited<
  ReturnType<AppRouterClient["ai"]["workspaceConsent"]["get"]>
>;

export type AiWorkspaceConsentCardProps = {
  status: "pending" | "error" | "ready";
  state: AiWorkspaceConsentState | null;
  /** A change is in flight. */
  isPending: boolean;
  onRetry: () => void;
  onChange: (enabled: boolean) => void;
};

/**
 * Presentational workspace AI card: the owner turns AI on or off for the whole
 * workspace; everyone else sees the state read-only. Free of data hooks so it
 * can be rendered in isolation by tests; {@link AiWorkspaceConsentSection}
 * supplies the wiring.
 */
export function AiWorkspaceConsentCard({
  status,
  state,
  isPending,
  onRetry,
  onChange,
}: AiWorkspaceConsentCardProps) {
  const { t } = useLingui();
  const enabled = state?.enabled === true;
  const canManage = state?.canManage === true;

  return (
    <Section
      title={<Trans>AI for this workspace</Trans>}
      description={
        <Trans comment="safety">
          The workspace owner decides whether AI features can be used in this workspace. When it is
          on, each person still has to give their own consent below before AI processes their data.
        </Trans>
      }
      sheet
    >
      {status === "pending" ? (
        <Skeleton className="h-12 w-full" />
      ) : status === "error" ? (
        <ErrorState
          title={<Trans>Could not load the workspace AI setting.</Trans>}
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : (
        <div className="flex items-start justify-between gap-6">
          <div className="grid gap-1">
            <span className="font-display font-medium text-ink">
              {enabled
                ? t({ message: "On for this workspace", comment: "safety" })
                : t({ message: "Off for this workspace", comment: "safety" })}
            </span>
            <span className="text-sm text-ink-3">
              {canManage
                ? t`As the owner, you can change this.`
                : t`Only the workspace owner can change this.`}
            </span>
          </div>
          <Switch
            className="mt-1"
            aria-label={t({ message: "Allow AI in this workspace", comment: "safety" })}
            checked={enabled}
            disabled={!canManage || isPending}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      )}
    </Section>
  );
}
