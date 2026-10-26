import { Trans } from "@lingui/react/macro";
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

/** A sharing change waiting for the owner to confirm it. */
export type SharingConfirmTarget =
  | { kind: "member"; userId: string; name: string }
  | { kind: "invitation"; id: string; email: string };

export type SharingConfirmDialogProps = {
  target: SharingConfirmTarget | null;
  onConfirm: (target: SharingConfirmTarget) => void;
  onCancel: () => void;
};

/**
 * Confirms removing a member or revoking an invitation before it happens,
 * naming who is affected. Both act at once on the server and cannot be undone
 * from here.
 */
export function SharingConfirmDialog({ target, onConfirm, onCancel }: SharingConfirmDialogProps) {
  const name = target?.kind === "member" ? target.name : "";
  const email = target?.kind === "invitation" ? target.email : "";
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        {target?.kind === "member" ? (
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Remove {name}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                They lose access to this workspace straight away. You can invite them again later.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
        ) : target?.kind === "invitation" ? (
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Revoke the invitation for {email}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>They can no longer use it to join. You can send a new one later.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (target) onConfirm(target);
            }}
          >
            {target?.kind === "invitation" ? <Trans>Revoke</Trans> : <Trans>Remove</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
