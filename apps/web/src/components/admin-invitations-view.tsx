import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openvalens/ui/components/table";
import { cn } from "@openvalens/ui/lib/utils";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import type { AdmissionInvitationSummary } from "@/utils/admission-keys";

export type AdminInvitationsViewProps = {
  accessState: "loading" | "error" | "denied" | "granted";
  listState?: "loading" | "error" | "ready";
  invitations?: AdmissionInvitationSummary[];
  issueState?: "idle" | "loading" | "success" | "error";
  issueError?: string | null;
  onRetryAccess?: () => void;
  onRetryList?: () => void;
  onIssue?: (email: string) => void;
  onRevoke?: (invitationId: string) => void;
};

export function AdminInvitationsView({
  accessState,
  listState,
  invitations,
  issueState,
  issueError,
  onRetryAccess,
  onRetryList,
  onIssue,
  onRevoke,
}: AdminInvitationsViewProps) {
  const { t } = useLingui();
  return (
    <Page>
      <PageHeader
        title={<Trans>Instance invitations</Trans>}
        description={<Trans>Administration</Trans>}
      />

      {accessState === "loading" ? (
        <LoadingCard />
      ) : accessState === "error" ? (
        <ErrorCard message={t`Could not verify admin access.`} onRetry={onRetryAccess} />
      ) : accessState === "denied" ? (
        <DeniedCard />
      ) : (
        <GrantedView
          listState={listState}
          invitations={invitations}
          issueState={issueState}
          issueError={issueError}
          onRetryList={onRetryList}
          onIssue={onIssue}
          onRevoke={onRevoke}
        />
      )}
    </Page>
  );
}

function GrantedView({
  listState,
  invitations,
  issueState,
  issueError,
  onRetryList,
  onIssue,
  onRevoke,
}: Omit<AdminInvitationsViewProps, "accessState" | "onRetryAccess">) {
  const [email, setEmail] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const { t } = useLingui();

  const valid = email.includes("@") && email.length <= 320;

  useEffect(() => {
    if (issueState === "success") {
      setEmail("");
    }
  }, [issueState]);

  function submitIssue() {
    if (!valid || !onIssue) return;
    onIssue(email);
  }

  async function handleRevoke(invitationId: string) {
    if (!onRevoke) return;
    setRevokingId(invitationId);
    setRevokeError(null);
    try {
      await onRevoke(invitationId);
      setConfirmRevoke(null);
    } catch {
      setRevokeError(t`Could not revoke invitation.`);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        {listState === "loading" ? (
          <LoadingCard />
        ) : listState === "error" ? (
          <ErrorCard message={t`Could not load invitations.`} onRetry={onRetryList} />
        ) : (
          <InvitationsList
            invitations={invitations ?? []}
            confirmRevoke={confirmRevoke}
            revokingId={revokingId}
            revokeError={revokeError}
            onRequestRevoke={setConfirmRevoke}
            onRevoke={handleRevoke}
          />
        )}
      </div>

      <Section
        className="lg:col-start-2 lg:row-start-1"
        title={<Trans>Invite a user</Trans>}
        description={
          <Trans>
            Invite someone to create an account. They will receive an invitation token by email.
          </Trans>
        }
        sheet
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="admin-invite-email" className="text-ink-3">
              <Trans>Email</Trans>
            </Label>
            <Input
              id="admin-invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitIssue();
              }}
              placeholder="name@example.com"
              disabled={issueState === "loading"}
            />
          </div>
          <div>
            <Button onClick={submitIssue} disabled={!valid || issueState === "loading"}>
              {issueState === "loading" ? t`Sending…` : t`Send invitation`}
            </Button>
          </div>
          {issueState === "success" ? (
            <p className="text-sm text-success" role="status">
              <Trans>Invitation sent.</Trans>
            </p>
          ) : issueState === "error" ? (
            <p className="text-sm text-destructive" role="alert" aria-live="polite">
              {issueError ?? t`Could not send invitation.`}
            </p>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

function InvitationsList({
  invitations,
  confirmRevoke,
  revokingId,
  revokeError,
  onRequestRevoke,
  onRevoke,
}: {
  invitations: AdmissionInvitationSummary[];
  confirmRevoke: string | null;
  revokingId: string | null;
  revokeError: string | null;
  onRequestRevoke: (id: string | null) => void;
  onRevoke: (id: string) => void | Promise<void>;
}) {
  const { t } = useLingui();
  return (
    <Section
      title={
        <span className="flex items-baseline gap-3">
          <Trans>Invitations</Trans>
          <span className="num text-base font-medium text-ink-3">{invitations.length}</span>
        </span>
      }
    >
      {revokeError ? (
        <p className="text-sm text-destructive" role="alert" aria-live="polite">
          {revokeError}
        </p>
      ) : null}
      {invitations.length === 0 ? (
        <EmptyState title={<Trans>No invitations yet.</Trans>} />
      ) : (
        <Table className="sheet">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">
                <Trans>Email</Trans>
              </TableHead>
              <TableHead>
                <Trans>Status</Trans>
              </TableHead>
              <TableHead>
                <Trans>Expires</Trans>
              </TableHead>
              <TableHead className="pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="py-2.5 pl-5 font-medium break-all whitespace-normal text-ink">
                  {invitation.email}
                </TableCell>
                <TableCell className="py-2.5">
                  <StatusBadge status={invitation.status} />
                </TableCell>
                <TableCell className="num py-2.5 text-ink-3">
                  {invitation.expiresAt ? invitation.expiresAt.toLocaleString() : null}
                </TableCell>
                <TableCell className="py-2 pr-5 text-right">
                  {invitation.status === "pending" ? (
                    <div className="flex items-center justify-end gap-2">
                      {confirmRevoke === invitation.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRequestRevoke(null)}
                            disabled={revokingId === invitation.id}
                          >
                            <Trans>Cancel</Trans>
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => onRevoke(invitation.id)}
                            disabled={revokingId === invitation.id}
                          >
                            {revokingId === invitation.id ? t`Revoking…` : t`Revoke`}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRequestRevoke(invitation.id)}
                          disabled={revokingId === invitation.id}
                        >
                          <Trans>Revoke</Trans>
                        </Button>
                      )}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function StatusBadge({ status }: { status: AdmissionInvitationSummary["status"] }) {
  const word = "text-sm font-medium";
  if (status === "consumed") {
    return (
      <span className={cn(word, "text-success")}>
        <Trans>Consumed</Trans>
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className={cn(word, "text-ink-3")}>
        <Trans>Expired</Trans>
      </span>
    );
  }
  return (
    <span className={cn(word, "text-ink-2")}>
      <Trans>Pending</Trans>
    </span>
  );
}

function LoadingCard() {
  return (
    <div className="sheet grid gap-3 px-5 py-4">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <ErrorState
      title={<Trans>Something went wrong</Trans>}
      description={message}
      action={
        onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <Trans>Retry</Trans>
          </Button>
        ) : undefined
      }
    />
  );
}

function DeniedCard() {
  return (
    <EmptyState
      title={<Trans>Access denied</Trans>}
      description={<Trans>You do not have access to instance administration.</Trans>}
    />
  );
}
