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
  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Instance invitations</h1>
        <p className="text-sm text-muted-foreground">Administration</p>
      </div>

      {accessState === "loading" ? (
        <LoadingCard />
      ) : accessState === "error" ? (
        <ErrorCard message="Could not verify admin access." onRetry={onRetryAccess} />
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
      setRevokeError("Could not revoke invitation.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite a user</CardTitle>
          <CardDescription>
            Invite someone to create an account. They will receive an invitation token by email.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <Label htmlFor="admin-invite-email">Email</Label>
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
                {issueState === "loading" ? "Sending…" : "Send invitation"}
              </Button>
            </div>
          </div>
          {issueState === "success" ? (
            <p className="text-sm text-success">Invitation sent.</p>
          ) : issueState === "error" ? (
            <p className="text-sm text-destructive" role="alert" aria-live="polite">
              {issueError ?? "Could not send invitation."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {listState === "loading" ? (
        <LoadingCard />
      ) : listState === "error" ? (
        <ErrorCard message="Could not load invitations." onRetry={onRetryList} />
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations · {invitations.length}</CardTitle>
      </CardHeader>
      {revokeError ? (
        <CardContent>
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {revokeError}
          </p>
        </CardContent>
      ) : null}
      {invitations.length === 0 ? (
        <CardContent className="text-sm text-muted-foreground">No invitations yet.</CardContent>
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
                      ? `Expires ${invitation.expiresAt.toLocaleString()}`
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
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRevoke(invitation.id)}
                          disabled={revokingId === invitation.id}
                        >
                          {revokingId === invitation.id ? "Revoking…" : "Revoke"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRequestRevoke(invitation.id)}
                        disabled={revokingId === invitation.id}
                      >
                        Revoke
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
    return <Badge variant="default">Consumed</Badge>;
  }
  if (status === "expired") {
    return <Badge variant="secondary">Expired</Badge>;
  }
  return <Badge variant="outline">Pending</Badge>;
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
        <CardTitle>Something went wrong</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {message}{" "}
          {onRetry ? (
            <button className="underline" onClick={onRetry}>
              Retry
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
        <CardTitle>Access denied</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          You do not have access to instance administration.
        </p>
      </CardContent>
    </Card>
  );
}
