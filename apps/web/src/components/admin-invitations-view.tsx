import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { CalendarX, CircleCheck, Clock, Mail, MailPlus, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatTile,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
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
        icon={MailPlus}
        tone="signal"
        title={<Trans>Invite a user</Trans>}
        info={
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

/** Local calendar day as YYYY-MM-DD, for friendlyDate. */
function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  const { t, i18n } = useLingui();
  const count = (status: AdmissionInvitationSummary["status"]) =>
    invitations.filter((invitation) => invitation.status === status).length;
  return (
    <div className="grid gap-8">
      {invitations.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile icon={Clock} label={<Trans>Pending</Trans>} value={count("pending")} />
          <StatTile icon={CircleCheck} label={<Trans>Consumed</Trans>} value={count("consumed")} />
          <StatTile icon={CalendarX} label={<Trans>Expired</Trans>} value={count("expired")} />
        </div>
      ) : null}
      <Section
        icon={Mail}
        tone="signal"
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
          <EmptyState icon={MailPlus} title={<Trans>No invitations yet.</Trans>} />
        ) : (
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label={t`Invitations`}>
            {invitations.map((invitation) => (
              <li key={invitation.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                <div className="flex items-start gap-3">
                  <ToneIcon icon={Mail} tone="signal" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <span className="font-semibold break-all text-ink">{invitation.email}</span>
                    {invitation.expiresAt ? (
                      <span className="text-sm text-ink-3">
                        <Trans>Expires</Trans>{" "}
                        <time
                          dateTime={invitation.expiresAt.toISOString()}
                          title={invitation.expiresAt.toLocaleString()}
                        >
                          {friendlyDate(i18n, localDay(invitation.expiresAt))}
                        </time>
                      </span>
                    ) : null}
                  </div>
                  <StatusBadge status={invitation.status} />
                </div>
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
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function StatusBadge({ status }: { status: AdmissionInvitationSummary["status"] }) {
  if (status === "consumed") {
    return (
      <StatusPill tone="good">
        <Trans>Consumed</Trans>
      </StatusPill>
    );
  }
  if (status === "expired") {
    return (
      <StatusPill tone="neutral">
        <Trans>Expired</Trans>
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="warn">
      <Trans>Pending</Trans>
    </StatusPill>
  );
}

function LoadingCard() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      <Skeleton className="h-28 w-full rounded-3xl" />
      <Skeleton className="h-28 w-full rounded-3xl" />
      <Skeleton className="h-28 w-full rounded-3xl" />
      <Skeleton className="h-28 w-full rounded-3xl" />
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
      icon={ShieldX}
      title={<Trans>Access denied</Trans>}
      description={<Trans>You do not have access to instance administration.</Trans>}
    />
  );
}
