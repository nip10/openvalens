import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Mail, MailX, PartyPopper, Users } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ToneIcon } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import { needsHealthConsent, type HealthConsentStatus } from "@/utils/health-consent";

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
  | { kind: "error"; ownerKey: string; message: MessageDescriptor };

type ActiveSlot = {
  token: symbol;
  ownerKey: string;
};

const ROLE_LABELS: Record<string, MessageDescriptor> = {
  member: msg`member`,
  admin: msg`admin`,
  owner: msg`owner`,
};

const ACCEPT_FAILED = msg`Could not accept the invitation.`;
const DECLINE_FAILED = msg`Could not decline the invitation.`;
const CONSENT_REQUIRED = msg`Review and accept the health data consent above before accepting this invitation.`;
const linkClass = "font-medium text-ink underline decoration-signal underline-offset-2";

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
  const { i18n } = useLingui();
  const queryClient = useQueryClient();
  const healthConsentKey = ["healthConsent", "status", userId] as const;
  const [healthConsentChecked, setHealthConsentChecked] = useState(false);
  const consentStatus = useQuery({
    queryKey: healthConsentKey,
    queryFn: () => client.healthConsent.status({}),
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Commit-phase identity reset: invalidate any in-flight request owned by a
  // previous {invitationId, userId} scope before the browser paints.
  useLayoutEffect(() => {
    currentOwnerRef.current = ownerKey;
    epochRef.current += 1;
    activeRef.current = null;
    setAction({ kind: "idle", ownerKey });
  }, [invitationId, userId, ownerKey]);

  useLayoutEffect(() => {
    setHealthConsentChecked(false);
  }, [consentStatus.data?.currentVersion]);

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
      <Card className="mx-auto w-full max-w-md sm:py-7">
        <CardHeader className="gap-2 sm:px-7">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:px-7">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (summaryError || !summary) {
    return (
      <Card className="mx-auto w-full max-w-md sm:py-7">
        <CardHeader className="gap-2 sm:px-7">
          <ToneIcon icon={MailX} tone="signal" size="lg" />
          <CardTitle className="pt-1 text-2xl">
            <Trans>Invitation unavailable</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>We could not load this invitation. It may have expired or been revoked.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="sm:px-7">
          <Button variant="outline" onClick={onRetry}>
            <Trans>Retry</Trans>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (summary.status !== "pending" || isExpired(summary.expiresAt)) {
    return (
      <Card className="mx-auto w-full max-w-md sm:py-7">
        <CardHeader className="gap-2 sm:px-7">
          <ToneIcon icon={MailX} tone="signal" size="lg" />
          <CardTitle className="pt-1 text-2xl">
            <Trans>Invitation unavailable</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              This invitation is no longer pending. It may have expired or already been used.
            </Trans>
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
      <Card className="mx-auto w-full max-w-md sm:py-7">
        <CardHeader className="gap-2 sm:px-7">
          <ToneIcon icon={PartyPopper} tone="signal" size="lg" />
          <CardTitle className="pt-1 text-2xl">
            <Trans>Invitation accepted</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>You have joined the workspace.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="sm:px-7">
          <Button asChild>
            <a href="/dashboard">
              <Trans>Go to dashboard</Trans>
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (ownedAction.kind === "rejected") {
    return (
      <Card className="mx-auto w-full max-w-md sm:py-7">
        <CardHeader className="gap-2 sm:px-7">
          <ToneIcon icon={MailX} tone="signal" size="lg" />
          <CardTitle className="pt-1 text-2xl">
            <Trans>Invitation declined</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>You can close this page.</Trans>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const roleMessage = ROLE_LABELS[summary.role];
  const role = roleMessage ? i18n._(roleMessage) : summary.role;
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
      const consent = consentStatus.data;
      if (consent && needsHealthConsent(consent)) {
        if (!healthConsentChecked || !consent.currentVersion) {
          setAction({ kind: "error", ownerKey: capturedOwnerKey, message: CONSENT_REQUIRED });
          return;
        }
        let accepted: HealthConsentStatus;
        try {
          accepted = await client.healthConsent.accept({
            acceptedHealthDataConsent: true,
            version: consent.currentVersion,
          });
        } catch {
          await queryClient.invalidateQueries({ queryKey: healthConsentKey });
          setHealthConsentChecked(false);
          setAction({ kind: "error", ownerKey: capturedOwnerKey, message: CONSENT_REQUIRED });
          return;
        }
        if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
        if (
          needsHealthConsent(accepted) ||
          accepted.currentVersion !== consent.currentVersion ||
          accepted.acceptedVersion !== consent.currentVersion
        ) {
          await queryClient.invalidateQueries({ queryKey: healthConsentKey });
          setHealthConsentChecked(false);
          setAction({ kind: "error", ownerKey: capturedOwnerKey, message: CONSENT_REQUIRED });
          return;
        }
        queryClient.setQueryData(healthConsentKey, accepted);
      }
      const { error } = await authClient.organization.acceptInvitation({ invitationId });
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      if (error) {
        setAction({
          kind: "error",
          ownerKey: capturedOwnerKey,
          message: ACCEPT_FAILED,
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
        message: ACCEPT_FAILED,
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
          message: DECLINE_FAILED,
        });
        return;
      }
      setAction({ kind: "rejected", ownerKey: capturedOwnerKey });
    } catch {
      if (isStale(requestEpoch) || activeRef.current?.token !== token) return;
      setAction({
        kind: "error",
        ownerKey: capturedOwnerKey,
        message: DECLINE_FAILED,
      });
    } finally {
      if (activeRef.current?.token === token && requestEpoch === epochRef.current) {
        activeRef.current = null;
      }
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md sm:py-7">
      <CardHeader className="gap-2 sm:px-7">
        <ToneIcon icon={Users} tone="signal" size="lg" />
        <CardTitle className="pt-1 text-2xl">
          <Trans>Workspace invitation</Trans>
        </CardTitle>
        <CardDescription>
          {summary.organizationName ? (
            <Trans>
              You have been invited to join{" "}
              <span className="font-medium text-ink wrap-anywhere">{summary.organizationName}</span>{" "}
              as <span className="font-medium text-ink">{role}</span>.
            </Trans>
          ) : (
            <Trans>
              You have been invited to join a workspace as{" "}
              <span className="font-medium text-ink">{role}</span>.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:px-7">
        <p className="text-sm text-ink-3">
          <Trans>
            Invited email:{" "}
            <span className="font-medium text-ink wrap-anywhere">{summary.email}</span>
          </Trans>
        </p>
        {mismatch ? (
          <p className="text-sm text-destructive wrap-anywhere" role="alert" aria-live="polite">
            <Trans>
              This invitation was sent to {summary.email}, but you are signed in as {sessionEmail}.
              Sign in with the matching email to accept.
            </Trans>
          </p>
        ) : null}

        {consentStatus.isError ? (
          <div className="flex items-center gap-3 text-sm text-destructive" role="alert">
            <Trans>Could not check health data consent. Retry before accepting this invitation.</Trans>
            <Button variant="outline" size="sm" onClick={() => void consentStatus.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          </div>
        ) : null}
        {needsHealthConsent(consentStatus.data) ? (
          <div className="grid gap-2 rounded-2xl border border-signal/30 bg-signal-soft/40 p-4">
            <p className="text-sm text-ink-2">
              <Trans>I consent to OpenValens processing my health data to provide the service.</Trans>{" "}
              {consentStatus.data?.privacyUrl ? (
                <a href={consentStatus.data.privacyUrl} target="_blank" rel="noreferrer" className={linkClass}>
                  <Trans>Read the privacy policy</Trans>
                </a>
              ) : null}
            </p>
            <p className="text-xs text-ink-3">
              <Trans>Consent version: {consentStatus.data?.currentVersion}</Trans>
            </p>
            <label className="flex items-start gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={healthConsentChecked}
                onChange={(event) => setHealthConsentChecked(event.target.checked)}
              />
              <span><Trans>I agree to this health data processing.</Trans></span>
            </label>
          </div>
        ) : null}

        {ownedAction.kind === "error" ? (
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {i18n._(ownedAction.message)}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1"
            onClick={handleAccept}
            disabled={busy || mismatch || consentStatus.isPending || consentStatus.isError || (needsHealthConsent(consentStatus.data) && !healthConsentChecked)}
          >
            {ownedAction.kind === "accepting" ? <Trans>Accepting…</Trans> : <Trans>Accept</Trans>}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={handleReject}
            disabled={busy || mismatch}
          >
            {ownedAction.kind === "rejecting" ? <Trans>Declining…</Trans> : <Trans>Decline</Trans>}
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
    <Card className="mx-auto w-full max-w-md sm:py-7">
      <CardHeader className="gap-2 sm:px-7">
        <ToneIcon icon={Mail} tone="signal" size="lg" />
        <CardTitle className="pt-1 text-2xl">
          <Trans>Sign in to view</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            This invitation is linked to an email address. Sign in to see the details and accept or
            decline.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:px-7">
        <Button asChild>
          <a href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>
            <Trans>Sign in with email</Trans>
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
