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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";

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
 * Presentational AI consent card. Hook-free and free of API imports so it can
 * be rendered and inspected in isolation by tests; the connected
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI processing</CardTitle>
        <CardDescription>
          AI features are opt-in and revocable. This setting applies only to you and is independent
          of your organization or owner role.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {status === "pending" ? (
          <Skeleton className="h-12 w-full" />
        ) : status === "error" ? (
          <p className="text-sm text-muted-foreground">
            Could not load AI consent.{" "}
            <button className="underline" onClick={onRetry}>
              Retry
            </button>
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <span className="text-sm font-medium">
                {granted && state
                  ? `Granted on ${formatGrantedAt(state.grantedAt)}`
                  : "Not granted"}
              </span>
              <span className="text-xs text-muted-foreground">
                {granted && state
                  ? `Consent version ${state.consentVersion}`
                  : "Turn on to let AI features process your data."}
              </span>
            </div>
            <Switch
              aria-label="AI processing consent"
              checked={granted}
              disabled={isPending}
              onCheckedChange={(checked) => {
                if (checked) onGrant();
                else onRequestRevoke();
              }}
            />
          </div>
        )}
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke AI consent?</AlertDialogTitle>
            <AlertDialogDescription>
              AI features will stop processing your data until you turn consent back on. Your
              existing records are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onRevoke}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
