import { Trans, useLingui } from "@lingui/react/macro";
import type { AppRouterClient } from "@openvalens/api/routers/index";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openvalens/ui/components/alert-dialog";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";

import { ErrorState, Section } from "@/components/page";

/**
 * Per-user AI consent state (Issue #123), derived from the oRPC output type
 * rather than re-imported from `@openvalens/ai`, so the web app stays a pure
 * API consumer.
 */
export type AiConsentState = NonNullable<
  Awaited<ReturnType<AppRouterClient["ai"]["consent"]["get"]>>
>;

export type AiConsentCardProps = {
  status: "pending" | "error" | "ready";
  state: AiConsentState | null;
  /** A grant/revoke mutation is in flight. */
  isPending: boolean;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onGrant: () => void;
  onRequestRevoke: () => void;
  onRevoke: () => void;
};

function formatGrantedAt(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * Presentational AI consent card. Free of data hooks and API imports (it only
 * reads the Lingui context) so it can be rendered and inspected in isolation
 * by tests; the connected
 * {@link AiConsentSection} supplies the query/mutation wiring.
 */
export function AiConsentCard({
  status,
  state,
  isPending,
  confirmOpen,
  onConfirmOpenChange,
  onRetry,
  onGrant,
  onRequestRevoke,
  onRevoke,
}: AiConsentCardProps) {
  const granted = state !== null && state.granted && state.revokedAt === null;
  const { t } = useLingui();

  return (
    <Section
      title={<Trans>AI processing</Trans>}
      description={
        <Trans comment="safety">
          AI features are opt-in and revocable. This setting applies only to you and is independent
          of your organization or owner role.
        </Trans>
      }
      sheet
    >
      {status === "pending" ? (
        <Skeleton className="h-12 w-full" />
      ) : status === "error" ? (
        <ErrorState
          title={<Trans>Could not load AI consent.</Trans>}
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
              {granted && state
                ? t({
                    message: `Granted on ${formatGrantedAt(state.grantedAt)}`,
                    comment: "safety",
                  })
                : t({ message: "Not granted", comment: "safety" })}
            </span>
            <span className="text-sm text-ink-3">
              {granted && state
                ? t({ message: `Consent version ${state.consentVersion}`, comment: "safety" })
                : t({
                    message: "Turn on to let AI features process your data.",
                    comment: "safety",
                  })}
            </span>
          </div>
          <Switch
            className="mt-1"
            aria-label={t({ message: "AI processing consent", comment: "safety" })}
            checked={granted}
            disabled={isPending}
            onCheckedChange={(checked) => {
              if (checked) onGrant();
              else onRequestRevoke();
            }}
          />
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans comment="safety">Revoke AI consent?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans comment="safety">
                AI features will stop processing your data until you turn consent back on. Your
                existing records are not deleted.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onRevoke}>
              <Trans>Revoke</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
