import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useLayoutEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";

type InvitationSummary = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
  organizationName?: string;
  organizationSlug?: string;
  inviterEmail?: string;
};

export type AcceptInvitationViewProps = {
  invitationId: string;
  userId: string | null;
  sessionEmail: string | null;
  summary: InvitationSummary | null;
  summaryError: string | null;
  summaryLoading: boolean;
  onRetry: () => void;
};

type ActionState =
  | { kind: "idle"; ownerKey: string }
  | { kind: "accepting"; ownerKey: string }
  | { kind: "rejecting"; ownerKey: string }
  | { kind: "accepted"; ownerKey: string }
  | { kind: "rejected"; ownerKey: string }
  | { kind: "error"; ownerKey: string; message: string };

type ActiveSlot = {
  token: symbol;
  ownerKey: string;
};

function makeOwnerKey(userId: string | null, invitationId: string): string {
  return `${userId ?? "anon"}:${invitationId}`;
}

export function AcceptInvitationView({
  invitationId,
  userId,
  sessionEmail,
  summary,
  summaryError,
  summaryLoading,
  onRetry,
}: AcceptInvitationViewProps) {
  const ownerKey = makeOwnerKey(userId, invitationId);
  const [action, setAction] = useState<ActionState>({ kind: "idle", ownerKey });
  const epochRef = useRef(0);
  const unmountedRef = useRef(false);
  const currentOwnerRef = useRef(ownerKey);
  const activeRef = useRef<ActiveSlot | null>(null);

  // Commit-phase identity reset: invalidate any in-flight request owned by a
  // previous {invitationId, userId} scope before the browser paints.
  useLayoutEffect(() => {
    currentOwnerRef.current = ownerKey;
    epochRef.current += 1;
    activeRef.current = null;
    setAction({ kind: "idle", ownerKey });
  }, [invitationId, userId, ownerKey]);

  // StrictMode-safe lifetime guard: mark this instance live on mount and dead
  // on cleanup. Late async continuations must not mutate state or navigate.
  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      epochRef.current += 1;
      activeRef.current = null;
    };
  }, []);

  if (!sessionEmail) {
    return <SignInCard invitationId={invitationId} />;
  }

  if (summaryLoading) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (summaryError || !summary) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation unavailable</CardTitle>
          <CardDescription>
            We could not load this invitation. It may have expired or been revoked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (summary.status !== "pending" || isExpired(summary.expiresAt)) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation unavailable</CardTitle>
          <CardDescription>
            This invitation is no longer pending. It may have expired or already been used.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Only render terminal action states that belong to the current scope.
  // A stale accepted/rejected/error card from a previous scope is hidden until
  // the commit-phase reset can clear it.
  const ownedAction = action.ownerKey === ownerKey ? action : { kind: "idle" as const, ownerKey };

  if (ownedAction.kind === "accepted") {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation accepted</CardTitle>
          <CardDescription>You have joined the workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/dashboard">Go to dashboard</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (ownedAction.kind === "rejected") {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation declined</CardTitle>
          <CardDescription>You can close this page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const busy = ownedAction.kind === "accepting" || ownedAction.kind === "rejecting";
  const mismatch = !!sessionEmail && sessionEmail.toLowerCase() !== summary.email.toLowerCase();

  function isStale(requestEpoch: number): boolean {
    return unmountedRef.current || requestEpoch !== epochRef.current;
  }

  function canStart(capturedOwnerKey: string): boolean {
    if (capturedOwnerKey !== currentOwnerRef.current) return false;
    if (activeRef.current) return false;
    return true;
  }

  async function handleAccept() {
    const capturedOwnerKey = ownerKey;
    if (!canStart(capturedOwnerKey) || mismatch) return;

    const requestEpoch = ++epochRef.current;
    const token = Symbol();
    activeRef.current = { token, ownerKey: capturedOwnerKey };
    setAction({ kind: "accepting", ownerKey: capturedOwnerKey });

    try {
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      const { error } = await authClient.organization.acceptInvitation({ invitationId });
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      if (error) {
        setAction({
          kind: "error",
          ownerKey: capturedOwnerKey,
          message: "Could not accept the invitation.",
        });
        return;
      }
      await authClient.getSession();
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      setAction({ kind: "accepted", ownerKey: capturedOwnerKey });
      window.location.href = "/dashboard";
    } catch {
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      setAction({
        kind: "error",
        ownerKey: capturedOwnerKey,
        message: "Could not accept the invitation.",
      });
    } finally {
      if (activeRef.current?.token === token && requestEpoch === epochRef.current) {
        activeRef.current = null;
      }
    }
  }

  async function handleReject() {
    const capturedOwnerKey = ownerKey;
    if (!canStart(capturedOwnerKey) || mismatch) return;

    const requestEpoch = ++epochRef.current;
    const token = Symbol();
    activeRef.current = { token, ownerKey: capturedOwnerKey };
    setAction({ kind: "rejecting", ownerKey: capturedOwnerKey });

    try {
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      const { error } = await authClient.organization.rejectInvitation({ invitationId });
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      if (error) {
        setAction({
          kind: "error",
          ownerKey: capturedOwnerKey,
          message: "Could not decline the invitation.",
        });
        return;
      }
      setAction({ kind: "rejected", ownerKey: capturedOwnerKey });
    } catch {
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      setAction({
        kind: "error",
        ownerKey: capturedOwnerKey,
        message: "Could not decline the invitation.",
      });
    } finally {
      if (activeRef.current?.token === token && requestEpoch === epochRef.current) {
        activeRef.current = null;
      }
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Workspace invitation</CardTitle>
        <CardDescription>
          You have been invited to join{" "}
          <span className="font-medium text-foreground wrap-anywhere">
            {summary.organizationName ?? "a workspace"}
          </span>{" "}
          as <span className="font-medium text-foreground">{summary.role}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Invited email:{" "}
          <span className="font-medium text-foreground wrap-anywhere">{summary.email}</span>
        </p>
        {mismatch ? (
          <p className="text-sm text-destructive wrap-anywhere" role="alert" aria-live="polite">
            This invitation was sent to {summary.email}, but you are signed in as {sessionEmail}.{" "}
            Sign in with the matching email to accept.
          </p>
        ) : null}

        {ownedAction.kind === "error" ? (
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {ownedAction.message}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={handleAccept} disabled={busy || mismatch}>
            {ownedAction.kind === "accepting" ? "Accepting…" : "Accept"}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={handleReject}
            disabled={busy || mismatch}
          >
            {ownedAction.kind === "rejecting" ? "Declining…" : "Decline"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function isExpired(expiresAt: Date | string | null): boolean {
  if (!expiresAt) return false;
  const date = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
}

function SignInCard({ invitationId }: { invitationId: string }) {
  const returnUrl = `/accept-invitation/${encodeURIComponent(invitationId)}`;
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in to view</CardTitle>
        <CardDescription>
          This invitation is linked to an email address. Sign in to see the details and accept or
          decline.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button asChild>
          <a href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>Sign in with email</a>
        </Button>
      </CardContent>
    </Card>
  );
}
