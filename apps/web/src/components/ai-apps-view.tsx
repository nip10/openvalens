import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  AI_APPS_HELP_PAGES,
  aiAppCallStatusLabel,
  aiAppCallTone,
  aiAppGrantStatusLabel,
  aiAppScopeTitle,
  aiAppsHelpUrl,
  claudeCodeOAuthCommand,
  splitGrants,
  type AiAppCallLike,
  type AiAppGrantLike,
} from "@openvalens/api/presenters/ai-apps";
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
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { BookOpen, Bot, KeyRound, Link2, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Details, EmptyState, ErrorState, Section, StatusPill, ToneIcon } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";

/** `aiApps.status` as the page sees it. */
export type AiAppsStatus = Awaited<ReturnType<AppRouterClient["aiApps"]["status"]>>;

export type AiAppsViewProps = {
  status: AiAppsStatus;
  grantsStatus: "pending" | "error" | "ready";
  grants: readonly AiAppGrantLike[];
  onRetry: () => void;
  /** The grant waiting for revoke confirmation, if any. */
  confirmRevoke: AiAppGrantLike | null;
  onConfirmRevokeChange: (grant: AiAppGrantLike | null) => void;
  onRevoke: (grant: AiAppGrantLike) => void;
  /** The grant a revoke is running for, so only its button disables. */
  revokingId: string | null;
  /** Value-free message from the last failed revoke. */
  actionError: string | null;
  /** Opens the create-key form; absent when the member cannot create one. */
  onCreateKey?: () => void;
  /** The create-key form or the shown-once key, in place of the button. */
  keyPanel?: ReactNode;
  /** Renders one grant's recent activity (it loads when opened). */
  renderActivity: (grant: AiAppGrantLike) => ReactNode;
};

/**
 * Issue #439 — Settings → Connected AI apps. Presentational: two lists of the
 * member's grants in this workspace, OAuth **connections** and **personal
 * keys**, each with its scopes, consent, dates, recent activity and Revoke,
 * and links to the per-client help pages. The route supplies the data.
 */
export function AiAppsView(props: AiAppsViewProps) {
  const { status } = props;
  const connections = splitGrants(props.grants, "oauth");
  const keys = splitGrants(props.grants, "personal_key");
  const activeKeyCount = keys.active.length;
  const atKeyLimit = activeKeyCount >= status.maxActiveKeys;

  return (
    <div className="grid gap-10">
      {!status.canCreate ? <BlockedNotice reason={status.blockedReason} /> : null}

      {props.actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {props.actionError}
        </p>
      ) : null}

      <Section
        title={<Trans>Connections</Trans>}
        icon={Link2}
        tone="signal"
        info={
          <Trans>
            Apps you approved by signing in from the app itself, such as claude.ai or ChatGPT. Each
            one reads only your own records in this workspace.
          </Trans>
        }
      >
        <GrantList
          {...props}
          kind="oauth"
          active={connections.active}
          inactive={connections.inactive}
          empty={
            <EmptyState
              icon={Bot}
              title={<Trans>No apps connected yet</Trans>}
              description={
                status.oauthEnabled ? (
                  <Trans>
                    You can let an AI assistant read your sleep, workouts, labs and other records so
                    it can answer questions about them. Add this server in the app, then sign in
                    here to approve it.
                  </Trans>
                ) : (
                  <Trans>
                    Signing in from an app is not available on this server. Use a personal key
                    instead.
                  </Trans>
                )
              }
            />
          }
        />
      </Section>

      <Section
        title={<Trans>Personal keys</Trans>}
        icon={KeyRound}
        tone="signal"
        info={
          <Trans>
            A key works like a password for one app, such as Claude Code, Cursor, a script or a
            local model. You see it once when you create it. You can have up to{" "}
            {status.maxActiveKeys} active keys.
          </Trans>
        }
        actions={
          props.onCreateKey && !props.keyPanel ? (
            <Button onClick={props.onCreateKey} disabled={!status.canCreate || atKeyLimit}>
              <Plus className="size-4" aria-hidden="true" />
              <Trans>Create key</Trans>
            </Button>
          ) : null
        }
      >
        {props.keyPanel}
        {atKeyLimit && status.canCreate ? (
          <p className="text-sm text-ink-3">
            <Trans>
              You have {activeKeyCount} active keys, the most allowed. Revoke one to make another.
            </Trans>
          </p>
        ) : null}
        <GrantList
          {...props}
          kind="personal_key"
          active={keys.active}
          inactive={keys.inactive}
          empty={
            <EmptyState
              icon={KeyRound}
              title={<Trans>No personal keys</Trans>}
              description={
                <Trans>
                  A key lets a tool on your computer, like Claude Code or a local model, read your
                  records to answer questions about your sleep, training and labs.
                </Trans>
              }
            />
          }
        />
      </Section>

      <HelpLinks mcpUrl={status.mcpUrl} oauthEnabled={status.oauthEnabled} />

      <AlertDialog
        open={props.confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open) props.onConfirmRevokeChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {props.confirmRevoke?.kind === "oauth" ? (
                <Trans>Disconnect {props.confirmRevoke.label}?</Trans>
              ) : (
                <Trans>Revoke the key {props.confirmRevoke?.label}?</Trans>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                The app stops reading your records on its next request. What it already read stays
                with the app. This can't be undone; you can connect again later.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => props.confirmRevoke && props.onRevoke(props.confirmRevoke)}
            >
              <Trans>Revoke</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BlockedNotice({ reason }: { reason: AiAppsStatus["blockedReason"] }) {
  if (reason === "WORKSPACE_DISABLED") {
    return (
      <p
        role="status"
        className="rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2"
        data-testid="ai-apps-blocked"
      >
        <Trans>
          The workspace owner has turned off connecting AI apps. Existing keys and connections in
          this workspace are paused until it is turned back on.
        </Trans>
      </p>
    );
  }
  if (reason === "NOT_OWNER") {
    return (
      <p
        role="status"
        className="rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2"
        data-testid="ai-apps-blocked"
      >
        <Trans>
          For now only the workspace owner can connect AI apps, because a workspace holds one
          person's records.
        </Trans>
      </p>
    );
  }
  return null;
}

function GrantList(
  props: AiAppsViewProps & {
    kind: AiAppGrantLike["kind"];
    active: AiAppGrantLike[];
    inactive: AiAppGrantLike[];
    empty: ReactNode;
  },
) {
  if (props.grantsStatus === "pending") {
    return <Skeleton className="h-36 w-full rounded-3xl" />;
  }
  if (props.grantsStatus === "error") {
    return (
      <ErrorState
        title={<Trans>Could not load your connected apps.</Trans>}
        action={
          <Button variant="outline" onClick={props.onRetry}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-3">
      {props.active.length === 0 ? (
        props.empty
      ) : (
        <ul className="grid gap-3">
          {props.active.map((grant) => (
            <GrantCard key={grant.id} grant={grant} {...props} />
          ))}
        </ul>
      )}
      {props.inactive.length > 0 ? (
        <Details
          summary={
            <Plural
              value={props.inactive.length}
              one="# revoked or expired"
              other="# revoked or expired"
            />
          }
        >
          <ul className="grid gap-3">
            {props.inactive.map((grant) => (
              <GrantCard key={grant.id} grant={grant} {...props} />
            ))}
          </ul>
        </Details>
      ) : null}
    </div>
  );
}

function GrantCard(props: AiAppsViewProps & { grant: AiAppGrantLike }) {
  const { t, i18n } = useLingui();
  const { grant } = props;
  const active = grant.status === "active";
  const when = (iso: string | null) => (iso ? friendlyDate(i18n, iso) : null);
  const created = when(grant.createdAt);
  const lastUsed = when(grant.lastUsedAt) ?? t`Never`;
  const expires = grant.expiresAt ? when(grant.expiresAt) : t`Never`;

  return (
    <li className="sheet grid gap-4 p-5" data-grant={grant.id}>
      <div className="flex flex-wrap items-start gap-4">
        <ToneIcon icon={grant.kind === "oauth" ? Bot : KeyRound} tone="neutral" />
        <div className="grid min-w-0 flex-1 basis-48 gap-1">
          <h3 className="font-display text-lg font-medium wrap-anywhere text-ink">{grant.label}</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            {grant.kind === "oauth" ? (
              <>
                <Badge variant="outline">
                  <Trans>Unverified app</Trans>
                </Badge>
                <span className="wrap-anywhere">
                  {grant.clientIdHost ?? t`Registered automatically, no verified identity`}
                </span>
              </>
            ) : grant.displayPrefix ? (
              <code className="num rounded-md bg-paper-2 px-1.5 py-0.5 text-ink-2">
                {grant.displayPrefix}…
              </code>
            ) : null}
            <StatusPill tone={active ? "good" : "neutral"}>
              {i18n._(aiAppGrantStatusLabel(grant.status))}
            </StatusPill>
          </div>
        </div>
        {active ? (
          <Button
            variant="outline"
            onClick={() => props.onConfirmRevokeChange(grant)}
            disabled={props.revokingId === grant.id}
            aria-label={t`Revoke ${grant.label}`}
          >
            {props.revokingId === grant.id ? t`Revoking…` : t`Revoke`}
          </Button>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Fact label={<Trans>Can read</Trans>}>
          {grant.scopes
            .map((scope) => {
              const title = aiAppScopeTitle(scope);
              return title ? i18n._(title) : scope;
            })
            .join(", ")}
        </Fact>
        <Fact label={<Trans>Consent</Trans>}>
          <span className="num">{grant.consentVersion}</span>
        </Fact>
        <Fact label={<Trans>Created</Trans>}>{created}</Fact>
        <Fact label={<Trans>Last used</Trans>}>{lastUsed}</Fact>
        {grant.kind === "personal_key" ? (
          <Fact label={<Trans>Expires</Trans>}>{expires}</Fact>
        ) : null}
        {grant.revokedAt ? <Fact label={<Trans>Ended</Trans>}>{when(grant.revokedAt)}</Fact> : null}
      </dl>

      {props.renderActivity(grant)}
    </li>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="wrap-anywhere text-ink-2">{children}</dd>
    </div>
  );
}

export type AiAppActivityProps = {
  status: "pending" | "error" | "ready";
  calls: readonly AiAppCallLike[];
  onRetry: () => void;
};

/** One grant's recent calls: tool, time, status and rows (kept 90 days). */
export function AiAppActivity(props: AiAppActivityProps) {
  const { t, i18n } = useLingui();
  if (props.status === "pending") return <Skeleton className="h-16 w-full" />;
  if (props.status === "error") {
    return (
      <ErrorState
        title={<Trans>Could not load the recent activity.</Trans>}
        action={
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }
  if (props.calls.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        <Trans>No requests in the last 90 days.</Trans>
      </p>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">
        <Trans>Recent requests, newest first. Kept for 90 days.</Trans>
      </caption>
      <thead className="text-ink-3">
        <tr>
          <th scope="col" className="py-1 pr-3 font-normal">
            <Trans>Tool</Trans>
          </th>
          <th scope="col" className="py-1 pr-3 font-normal">
            <Trans>When</Trans>
          </th>
          <th scope="col" className="py-1 pr-3 font-normal">
            <Trans>Result</Trans>
          </th>
          <th scope="col" className="py-1 text-right font-normal">
            <Trans>Rows</Trans>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-rule">
        {props.calls.map((call, index) => (
          <tr key={`${call.createdAt}-${index}`}>
            <td className="py-1.5 pr-3">
              <code className="text-ink">{call.tool}</code>
            </td>
            <td className="py-1.5 pr-3 text-ink-2">
              <time dateTime={call.createdAt}>{new Date(call.createdAt).toLocaleString()}</time>
            </td>
            <td className="py-1.5 pr-3">
              <StatusPill tone={aiAppCallTone(call.status)}>
                {i18n._(aiAppCallStatusLabel(call.status))}
              </StatusPill>
            </td>
            <td className="num py-1.5 text-right text-ink-2">
              {call.rowCount === null ? t`None` : call.rowCount}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HelpLinks({ mcpUrl, oauthEnabled }: { mcpUrl: string | null; oauthEnabled: boolean }) {
  const { t } = useLingui();
  return (
    <Section
      title={<Trans>How to connect an app</Trans>}
      icon={BookOpen}
      tone="signal"
      info={
        <Trans>
          Web apps such as claude.ai and ChatGPT connect from their own servers, so this server has
          to be reachable on the public internet over HTTPS. A server on a home network or VPN works
          with personal keys from apps on your own computer.
        </Trans>
      }
    >
      <div className="sheet grid gap-4 p-5">
        {mcpUrl ? (
          <div className="grid gap-1">
            <span className="text-sm text-ink-3">
              <Trans>Server address for your app</Trans>
            </span>
            <code className="num rounded-xl bg-paper-2 px-3 py-2 text-sm break-all text-ink select-all">
              {mcpUrl}
            </code>
            {oauthEnabled ? (
              <span className="text-sm text-ink-3">
                <Trans>Claude Code, signing in from the app:</Trans>{" "}
                <code className="break-all text-ink-2">{claudeCodeOAuthCommand(mcpUrl)}</code>
              </span>
            ) : null}
          </div>
        ) : null}
        <ul className="flex flex-wrap gap-2" aria-label={t`Step-by-step guides`}>
          {AI_APPS_HELP_PAGES.map((page) => (
            <li key={page.id}>
              <a
                href={aiAppsHelpUrl(page.file)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center rounded-full border border-rule-2 px-4 text-sm font-medium text-ink no-underline hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {page.name ?? t`A local model`}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
