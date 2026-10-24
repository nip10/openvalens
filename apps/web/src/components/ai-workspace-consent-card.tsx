import { Trans, useLingui } from "@lingui/react/macro";
import type { AppRouterClient } from "@openvalens/api/routers/index";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";

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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>AI for this workspace</Trans>
        </CardTitle>
        <CardDescription>
          <Trans comment="safety">
            The workspace owner decides whether AI features can be used in this workspace. When it
            is on, each person still has to give their own consent below before AI processes their
            data.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {status === "pending" ? (
          <Skeleton className="h-12 w-full" />
        ) : status === "error" ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Could not load the workspace AI setting.</Trans>{" "}
            <button className="underline" onClick={onRetry}>
              <Trans>Retry</Trans>
            </button>
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <span className="text-sm font-medium">
                {enabled
                  ? t({ message: "On for this workspace", comment: "safety" })
                  : t({ message: "Off for this workspace", comment: "safety" })}
              </span>
              <span className="text-xs text-muted-foreground">
                {canManage
                  ? t`As the owner, you can change this.`
                  : t`Only the workspace owner can change this.`}
              </span>
            </div>
            <Switch
              aria-label={t({ message: "Allow AI in this workspace", comment: "safety" })}
              checked={enabled}
              disabled={!canManage || isPending}
              onCheckedChange={(checked) => onChange(checked)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
