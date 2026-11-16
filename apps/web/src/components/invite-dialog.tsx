import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { cn } from "@openvalens/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { FormDialog } from "@/components/form-dialog";
import { orpc } from "@/utils/orpc";

export type InviteRole = "member" | "owner";
export type InviteDelivery = "sent" | "unavailable" | "failed";

/** One line on what each role can see and do (#sharing-0). */
function RoleLine({ role }: { role: InviteRole }) {
  return role === "member" ? (
    <Trans>
      They see this health record, except your workouts, sleep and body measurements, which stay
      private to you.
    </Trans>
  ) : (
    <Trans>Full control, including inviting and removing people and deleting data.</Trans>
  );
}

/**
 * #sharing-6 — the invite form, as it sits in its dialog: email, role
 * (member unless you choose owner) and what that person will see. Choosing
 * owner asks once more before anything is sent (#sharing-1).
 */
export function InviteForm({
  pending,
  failed,
  delivery,
  onSubmit,
  onDone,
  initialRole = "member",
}: {
  pending: boolean;
  failed: boolean;
  /** Set once the invitation is saved but its email did not go out. */
  delivery: Exclude<InviteDelivery, "sent"> | null;
  onSubmit: (input: { email: string; role: InviteRole }) => void;
  onDone: () => void;
  initialRole?: InviteRole;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>(initialRole);
  const [confirmingOwner, setConfirmingOwner] = useState(false);
  const emailId = useId();
  const roleName = useId();
  const { t } = useLingui();
  const valid = /^[^\s@]+@[^\s@]+$/.test(email.trim());

  if (delivery) {
    return (
      <div className="grid gap-5">
        <p role="status" className={delivery === "failed" ? "text-destructive" : "text-ink-2"}>
          {delivery === "unavailable" ? (
            <Trans>
              Invitation saved, but email is not configured on this server, so no email was sent.
              Ask them to open Sharing (or Invitations in the mobile app) to accept it.
            </Trans>
          ) : (
            <Trans>
              Invitation saved, but the email could not be sent. Ask them to open Sharing (or
              Invitations in the mobile app) to accept it.
            </Trans>
          )}
        </p>
        <div className="flex justify-end">
          <Button onClick={onDone}>
            <Trans>Done</Trans>
          </Button>
        </div>
      </div>
    );
  }

  if (confirmingOwner) {
    return (
      <div className="grid gap-5">
        <div className="flex items-start gap-3 rounded-2xl bg-warning/14 p-4 text-ink-2">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <Trans>
              Invite {email.trim()} as an owner? An owner has full control of this health record:
              they can invite and remove people, you included, and delete data.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmingOwner(false)}>
            <Trans>Go back</Trans>
          </Button>
          <Button
            disabled={pending}
            onClick={() => onSubmit({ email: email.trim(), role: "owner" })}
          >
            {pending ? t`Inviting…` : t`Yes, invite as owner`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || pending) return;
        if (role === "owner") setConfirmingOwner(true);
        else onSubmit({ email: email.trim(), role });
      }}
    >
      <div className="grid gap-2">
        <label htmlFor={emailId} className="text-sm font-medium text-ink-3">
          <Trans>Email</Trans>
        </label>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-3">
          <Trans>Role</Trans>
        </legend>
        {(["member", "owner"] as const).map((value) => {
          const id = `${roleName}-${value}`;
          const selected = role === value;
          return (
            <label
              key={value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors duration-[var(--dur-short)]",
                selected ? "border-signal/50 bg-paper-2" : "border-rule hover:bg-paper-2",
              )}
            >
              <input
                type="radio"
                id={id}
                name={roleName}
                value={value}
                checked={selected}
                onChange={() => setRole(value)}
                className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="grid gap-0.5">
                <span className="font-medium text-ink">
                  {value === "member" ? <Trans>Member</Trans> : <Trans>Owner</Trans>}
                </span>
                <span className="text-sm text-ink-3">
                  <RoleLine role={value} />
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not send invite. Email may already be pending.</Trans>
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={!valid || pending}>
          {pending ? t`Inviting…` : t`Send invite`}
        </Button>
      </div>
    </form>
  );
}

/** {@link InviteForm} in a {@link FormDialog} (a bottom sheet on phones), wired to `sharing.createInvitation`. */
export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const [delivery, setDelivery] = useState<Exclude<InviteDelivery, "sent"> | null>(null);
  const invite = useMutation(
    orpc.sharing.createInvitation.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.listInvitations.key() });
        if (result.emailDelivery === "sent") {
          toast.success(t`Invitation sent by email.`);
          onOpenChange(false);
        } else {
          setDelivery(result.emailDelivery);
        }
      },
    }),
  );
  const close = (next: boolean) => {
    if (!next) {
      invite.reset();
      setDelivery(null);
    }
    onOpenChange(next);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title={<Trans>Invite someone</Trans>}
      description={<Trans>They get an email and accept it in OpenValens.</Trans>}
    >
      {open ? (
        <InviteForm
          pending={invite.isPending}
          failed={invite.isError}
          delivery={delivery}
          onSubmit={(input) => invite.mutate(input)}
          onDone={() => close(false)}
        />
      ) : null}
    </FormDialog>
  );
}
