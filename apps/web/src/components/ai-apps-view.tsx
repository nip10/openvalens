import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  AI_APPS_HELP_PAGES,
  aiAppCallStatusLabel,
  aiAppCallTone,
  aiAppGrantIdentity,
  aiAppGrantStatusLabel,
  aiAppName,
  aiAppScopeTitle,
  aiAppsHelpUrl,
  claudeCodeOAuthCommand,
  isAiAppWriteScope,
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
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";

import { CopyField } from "@/components/ai-app-key-form";
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
  /**
   * "Delete everything this app wrote" (M2): the grant waiting for
   * confirmation, and the delete itself. Absent hides the action.
   */
  confirmDeleteWrites?: AiAppGrantLike | null;
  onConfirmDeleteWritesChange?: (grant: AiAppGrantLike | null) => void;
  onDeleteWrites?: (grant: AiAppGrantLike) => void;
  /** The grant a delete is running for, so only its button disables. */
  deletingWritesId?: string | null;
  /** A link to the timeline filtered to what this grant wrote. */
  renderTimelineLink?: (grant: AiAppGrantLike) => ReactNode;
};

/**
 * Issue #439 — Settings → Connected AI apps. Presentational: two lists of the
 * member's grants in this workspace, OAuth **connections** and **personal
 * keys**, each with its scopes, consent, dates, recent activity and Revoke,
 * and links to the per-client help pages. The route supplies the data.
 */
export function AiAppsView(props: AiAppsViewProps) {
  const { i18n } = useLingui();
  const { status } = props;
  // #507 — an OAuth app is named with its host, a key as a personal key.
  const nameOf = (grant: AiAppGrantLike | null | undefined) =>
    grant ? aiAppName(aiAppGrantIdentity(grant), i18n) : "";
  const revokeName = nameOf(props.confirmRevoke);
  const deleteWritesName = nameOf(props.confirmDeleteWrites);
  const connections = splitGrants(props.grants, "oauth");
  const keys = splitGrants(props.grants, "personal_key");
  const activeKeyCount = keys.active.length;
  const atKeyLimit = activeKeyCount >= status.maxActiveKeys;
  // #settings-ai-apps-4: with nothing connected yet, the how-to leads and the
  // two empty lists fold into one line under it.
  const nothingYet = props.grantsStatus === "ready" && props.grants.length === 0;
  const createKeyButton =
    props.onCreateKey && !props.keyPanel ? (
      <Button onClick={props.onCreateKey} disabled={!status.canCreate || atKeyLimit}>
        <Plus className="size-4" aria-hidden="true" />
        <Trans>Create key</Trans>
      </Button>
    ) : null;

  return (
    <div className="grid gap-10">
      {!status.canCreate ? <BlockedNotice reason={status.blockedReason} /> : null}

      {props.actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {props.actionError}
        </p>
      ) : null}

      {nothingYet ? (
        <>
          <HelpLinks mcpUrl={status.mcpUrl} oauthEnabled={status.oauthEnabled} />
          <Section
            title={<Trans>Your apps and keys</Trans>}
            icon={KeyRound}
            tone="signal"
            info={
              <Trans>
                A key works like a password for one app, such as Claude Code, Cursor, a script or a
                local model. You see it once when you create it. You can have up to{" "}
                {status.maxActiveKeys} active keys.
              </Trans>
            }
            actions={createKeyButton}
          >
            {props.keyPanel}
            <p className="text-sm text-ink-3" data-testid="ai-apps-nothing-yet">
              <Trans>
                No apps or keys yet. Connect an app above, or create a key for a tool on your
                computer.
              </Trans>
            </p>
          </Section>
        </>
      ) : (
        <>
          <Section
            title={<Trans>Connections</Trans>}
            icon={Link2}
            tone="signal"
            info={
              <Trans>
                Apps you approved by signing in from the app itself, such as claude.ai or ChatGPT.
                Each one reads only your own records in this workspace.
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
                        You can let an AI assistant read your sleep, workouts, labs and other
                        records so it can answer questions about them. Add this server in the app,
                        then sign in here to approve it.
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
            actions={createKeyButton}
          >
            {props.keyPanel}
            {atKeyLimit && status.canCreate ? (
              <p className="text-sm text-ink-3">
                <Trans>
                  You have {activeKeyCount} active keys, the most allowed. Revoke one to make
                  another.
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
                      A key lets a tool on your computer, like Claude Code or a local model, read
                      your records to answer questions about your sleep, training and labs.
                    </Trans>
                  }
                />
              }
            />
          </Section>

          <HelpLinks mcpUrl={status.mcpUrl} oauthEnabled={status.oauthEnabled} />
        </>
      )}

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
                <Trans>Disconnect {revokeName}?</Trans>
              ) : (
                <Trans>Revoke the key {props.confirmRevoke?.label}?</Trans>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                The app stops reading your records on its next request. What it already read stays
                with the app. This can't be undone; you can connect again later.
              </Trans>{" "}
              {props.confirmRevoke?.entryCount ? (
                <Trans>
                  Entries it added stay in your records. You can delete them here at any time.
                </Trans>
              ) : null}
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

      <AlertDialog
        open={Boolean(props.confirmDeleteWrites)}
        onOpenChange={(open) => {
          if (!open) props.onConfirmDeleteWritesChange?.(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete everything {deleteWritesName} added?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Plural
                value={props.confirmDeleteWrites?.entryCount ?? 0}
                one="The # entry this app added to your records is deleted. Your own entries and device data stay. This can't be undone."
                other="The # entries this app added to your records are deleted. Your own entries and device data stay. This can't be undone."
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                props.confirmDeleteWrites && props.onDeleteWrites?.(props.confirmDeleteWrites)
              }
            >
              <Trans>Delete entries</Trans>
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
  const scopeNames = (write: boolean) =>
    grant.scopes
      .filter((scope) => isAiAppWriteScope(scope) === write)
      .map((scope) => {
        const title = aiAppScopeTitle(scope);
        return title ? i18n._(title) : scope;
      })
      .join(", ");
  const writes = scopeNames(true);
  const entryCount = grant.entryCount ?? 0;
  const name = aiAppName(aiAppGrantIdentity(grant), i18n);

  return (
    <li className="sheet grid gap-4 p-5" data-grant={grant.id}>
      <div className="flex flex-wrap items-start gap-4">
        <ToneIcon icon={grant.kind === "oauth" ? Bot : KeyRound} tone="neutral" />
        <div className="grid min-w-0 flex-1 basis-48 gap-1">
          <h3 className="font-display text-lg font-medium wrap-anywhere text-ink">{name}</h3>
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
            aria-label={t`Revoke ${name}`}
          >
            {props.revokingId === grant.id ? t`Revoking…` : t`Revoke`}
          </Button>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Fact label={<Trans>Can read</Trans>}>{scopeNames(false)}</Fact>
        {writes ? <Fact label={<Trans>Can add</Trans>}>{writes}</Fact> : null}
        <Fact label={<Trans>Consent</Trans>}>
          <span className="num">{grant.consentVersion}</span>
        </Fact>
        <Fact label={<Trans>Created</Trans>}>{created}</Fact>
        <Fact label={<Trans>Last used</Trans>}>{lastUsed}</Fact>
        {grant.kind === "personal_key" ? (
          <Fact label={<Trans>Expires</Trans>}>{expires}</Fact>
        ) : null}
        {grant.revokedAt ? <Fact label={<Trans>Ended</Trans>}>{when(grant.revokedAt)}</Fact> : null}
        {entryCount > 0 ? (
          <Fact label={<Trans>Entries added</Trans>}>
            <span className="num">{entryCount}</span>
          </Fact>
        ) : null}
      </dl>

      {entryCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="ai-app-writes">
          {props.renderTimelineLink?.(grant)}
          {props.onConfirmDeleteWritesChange ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => props.onConfirmDeleteWritesChange?.(grant)}
              disabled={props.deletingWritesId === grant.id}
            >
              {props.deletingWritesId === grant.id
                ? t`Deleting…`
                : t`Delete everything this app wrote`}
            </Button>
          ) : null}
        </div>
      ) : null}

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

type HelpPageId = (typeof AI_APPS_HELP_PAGES)[number]["id"];

/** The apps that only sign in (no personal key), so they need OAuth on the server. */
const SIGN_IN_ONLY: ReadonlySet<HelpPageId> = new Set(["claude-ai", "claude-desktop", "chatgpt"]);

/**
 * #settings-ai-apps-1 — "How to connect an app": pick the app from a tab bar,
 * and the short steps below swap to match, with its full guide one tap away.
 * Every panel stays in the page (hidden), so search and tests still see them.
 */
function HelpLinks({ mcpUrl, oauthEnabled }: { mcpUrl: string | null; oauthEnabled: boolean }) {
  const { t } = useLingui();
  // Without sign-in on the server, start at an app that works with a key.
  const [selected, setSelected] = useState<HelpPageId>(
    oauthEnabled ? AI_APPS_HELP_PAGES[0].id : "claude-code",
  );
  const baseId = useId();
  const tabId = (id: HelpPageId) => `${baseId}-tab-${id}`;
  const panelId = (id: HelpPageId) => `${baseId}-panel-${id}`;
  const ids = AI_APPS_HELP_PAGES.map((page) => page.id);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = ids.indexOf(selected);
    const next =
      event.key === "ArrowRight"
        ? ids[(index + 1) % ids.length]
        : event.key === "ArrowLeft"
          ? ids[(index - 1 + ids.length) % ids.length]
          : event.key === "Home"
            ? ids[0]
            : event.key === "End"
              ? ids[ids.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    setSelected(next);
    document.getElementById(tabId(next))?.focus();
  };

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
      <div className="sheet grid min-w-0 gap-5 p-5">
        <div className="grid min-w-0 gap-2">
          <span id={`${baseId}-label`} className="text-sm text-ink-3">
            <Trans>Pick your app</Trans>
          </span>
          <div
            role="tablist"
            aria-labelledby={`${baseId}-label`}
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          >
            {AI_APPS_HELP_PAGES.map((page) => {
              const active = page.id === selected;
              return (
                <button
                  key={page.id}
                  id={tabId(page.id)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelId(page.id)}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setSelected(page.id)}
                  onKeyDown={onKeyDown}
                  className={`inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--dur-short)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    active
                      ? "border-transparent bg-sidebar-accent text-signal"
                      : "border-rule-2 text-ink hover:bg-paper-2"
                  }`}
                >
                  {page.name ?? t`A local model`}
                </button>
              );
            })}
          </div>
        </div>

        {mcpUrl ? (
          <div className="grid min-w-0 gap-1">
            <span className="text-sm text-ink-3">
              <Trans>Server address for your app</Trans>
            </span>
            <CopyField value={mcpUrl} kind="address" />
          </div>
        ) : null}

        {AI_APPS_HELP_PAGES.map((page) => (
          <div
            key={page.id}
            id={panelId(page.id)}
            role="tabpanel"
            aria-labelledby={tabId(page.id)}
            hidden={page.id !== selected}
            className="grid min-w-0 gap-4"
          >
            {SIGN_IN_ONLY.has(page.id) && !oauthEnabled ? (
              <p className="text-sm text-ink-2">
                <Trans>
                  This app connects by signing in, which this server doesn't offer. Use an app on
                  your computer with a personal key instead, such as Claude Code or Cursor.
                </Trans>
              </p>
            ) : (
              <ol className="grid list-decimal gap-2 pl-5 text-sm text-ink-2 marker:text-ink-3">
                <HelpSteps id={page.id} mcpUrl={mcpUrl} oauthEnabled={oauthEnabled} />
              </ol>
            )}
            <a
              href={aiAppsHelpUrl(page.file)}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-sm font-medium text-ink underline decoration-signal underline-offset-2"
            >
              <Trans>Step-by-step guide</Trans>
            </a>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** The few steps for one app; its guide has the detail. */
function HelpSteps({
  id,
  mcpUrl,
  oauthEnabled,
}: {
  id: HelpPageId;
  mcpUrl: string | null;
  oauthEnabled: boolean;
}) {
  switch (id) {
    case "claude-ai":
      return (
        <>
          <li>
            <Trans>In claude.ai, open Customize › Connectors and add a custom connector.</Trans>
          </li>
          <li>
            <Trans>Paste the server address, then select Add and Connect.</Trans>
          </li>
          <li>
            <Trans>Sign in to OpenValens and approve the connection.</Trans>
          </li>
        </>
      );
    case "claude-desktop":
      return (
        <>
          <li>
            <Trans>
              In Claude Desktop or claude.ai, open Customize › Connectors and add a custom
              connector.
            </Trans>
          </li>
          <li>
            <Trans>Paste the server address, then select Add and Connect.</Trans>
          </li>
          <li>
            <Trans>
              Sign in to OpenValens and approve. It works in Claude Desktop from then on.
            </Trans>
          </li>
        </>
      );
    case "claude-code":
      return oauthEnabled && mcpUrl ? (
        <>
          <li className="grid min-w-0 gap-1">
            <Trans>Run this in a terminal:</Trans>
            <CopyField value={claudeCodeOAuthCommand(mcpUrl)} kind="command" />
          </li>
          <li>
            <Trans>In Claude Code, run /mcp, choose openvalens and sign in.</Trans>
          </li>
          <li>
            <Trans>Approve the connection in OpenValens.</Trans>
          </li>
        </>
      ) : (
        <>
          <li>
            <Trans>Create a personal key on this page.</Trans>
          </li>
          <li>
            <Trans>Add the server address with your key, using the command in the guide.</Trans>
          </li>
        </>
      );
    case "cursor":
      return (
        <>
          <li>
            <Trans>Create a personal key on this page.</Trans>
          </li>
          <li>
            <Trans>Add the server address and your key to ~/.cursor/mcp.json.</Trans>
          </li>
          <li>
            <Trans>Restart Cursor.</Trans>
          </li>
        </>
      );
    case "chatgpt":
      return (
        <>
          <li>
            <Trans>In ChatGPT, open Plugins and add a custom MCP server.</Trans>
          </li>
          <li>
            <Trans>Paste the server address as the Server URL and choose OAuth.</Trans>
          </li>
          <li>
            <Trans>Sign in to OpenValens and approve the connection.</Trans>
          </li>
        </>
      );
    case "local":
      return (
        <>
          <li>
            <Trans>Create a personal key on this page.</Trans>
          </li>
          <li>
            <Trans>
              Add the server address and your key to the app's MCP settings (mcp.json in LM Studio).
            </Trans>
          </li>
        </>
      );
  }
}
