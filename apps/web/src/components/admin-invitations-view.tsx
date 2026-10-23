import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useEffect, useState } from "react";

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
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">
          <Trans>Instance invitations</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>Administration</Trans>
        </p>
      </div>

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
    </main>
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
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Invite a user</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Invite someone to create an account. They will receive an invitation token by email.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <Label htmlFor="admin-invite-email">
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
            <div className="flex items-end">
              <Button onClick={submitIssue} disabled={!valid || issueState === "loading"}>
                {issueState === "loading" ? t`Sending…` : t`Send invitation`}
              </Button>
            </div>
          </div>
          {issueState === "success" ? (
            <p className="text-sm text-success">
              <Trans>Invitation sent.</Trans>
            </p>
          ) : issueState === "error" ? (
            <p className="text-sm text-destructive" role="alert" aria-live="polite">
              {issueError ?? t`Could not send invitation.`}
            </p>
          ) : null}
        </CardContent>
      </Card>

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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Invitations · {invitations.length}</Trans>
        </CardTitle>
      </CardHeader>
      {revokeError ? (
        <CardContent>
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {revokeError}
          </p>
        </CardContent>
      ) : null}
      {invitations.length === 0 ? (
        <CardContent className="text-sm text-muted-foreground">
          <Trans>No invitations yet.</Trans>
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{invitation.email}</div>
                  <div className="text-sm text-muted-foreground">
                    <StatusBadge status={invitation.status} />{" "}
                    {invitation.expiresAt
                      ? t`Expires ${invitation.expiresAt.toLocaleString()}`
                      : null}
                  </div>
                </div>
                {invitation.status === "pending" ? (
                  <div className="flex items-center gap-2">
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
                        variant="outline"
                        size="sm"
                        onClick={() => onRequestRevoke(invitation.id)}
                        disabled={revokingId === invitation.id}
                      >
                        <Trans>Revoke</Trans>
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: AdmissionInvitationSummary["status"] }) {
  if (status === "consumed") {
    return (
      <Badge variant="default">
        <Trans>Consumed</Trans>
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge variant="secondary">
        <Trans>Expired</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Trans>Pending</Trans>
    </Badge>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Something went wrong</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {message}{" "}
          {onRetry ? (
            <button className="underline" onClick={onRetry}>
              <Trans>Retry</Trans>
            </button>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

function DeniedCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Access denied</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          <Trans>You do not have access to instance administration.</Trans>
        </p>
      </CardContent>
    </Card>
  );
}
