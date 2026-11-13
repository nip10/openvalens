import { Trans, useLingui } from "@lingui/react/macro";
import type { AppRouterClient } from "@openvalens/api/routers/index";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { ShieldAlert } from "lucide-react";
import { useId } from "react";

import { ToneIcon } from "@/components/page";
import { SETTINGS_SELECT } from "@/components/settings-rows";

/** What the consent screen shows, from `aiApps.oauth.describe`. */
export type OAuthConsentRequest = Awaited<
  ReturnType<AppRouterClient["aiApps"]["oauth"]["describe"]>
>;

export type OAuthConsentViewProps = {
  status: "pending" | "error" | "ready";
  request: OAuthConsentRequest | null;
  /** Message for `status: "error"` (an expired or foreign request, a server off). */
  errorMessage: string | null;
  organizationId: string | null;
  onOrganizationChange: (organizationId: string) => void;
  /** Opt-in scopes the member ticked (`records:read` is always included). */
  selectedScopes: readonly string[];
  onScopeChange: (scope: string, selected: boolean) => void;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  isSubmitting: boolean;
  onApprove: () => void;
  onDeny: () => void;
};

/**
 * Issue #439 (M1b) — the OAuth consent screen for connecting an AI app.
 * Presentational: no data hooks, so tests can render it alone.
 *
 * Nothing is pre-approved and nothing sensitive is pre-ticked: the base read
 * scope is required and shown ticked; nutrition, private body measurements and
 * notes start unticked even when the app asked for them. The app's name is
 * its own claim and always labelled unverified, next to the host its client id
 * lives on and the host it will return to. Writing is not offered.
 */
export function OAuthConsentView(props: OAuthConsentViewProps) {
  const { t } = useLingui();
  const workspaceId = useId();
  const agreeId = useId();

  if (props.status === "pending") {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (props.status === "error" || !props.request) {
    return (
      <div className="grid justify-items-center gap-3 text-center">
        <ToneIcon icon={ShieldAlert} tone="neutral" size="lg" />
        <h1 className="text-2xl">
          <Trans>This connection request cannot be used</Trans>
        </h1>
        <p className="text-ink-2">
          {props.errorMessage ?? t`Start connecting again from the app.`}
        </p>
      </div>
    );
  }

  const { client, scopes, workspaces, consentVersion } = props.request;
  const appName = client.name ?? t`An unnamed app`;
  const allowedWorkspaces = workspaces.filter((workspace) => workspace.allowed);
  const canApprove =
    allowedWorkspaces.some((workspace) => workspace.organizationId === props.organizationId) &&
    props.agreed &&
    !props.isSubmitting;

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApprove) props.onApprove();
      }}
    >
      <header className="grid gap-2">
        <h1 className="text-3xl">
          <Trans>Connect {appName} to OpenValens?</Trans>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="oauth-unverified">
            <Trans>Unverified app</Trans>
          </Badge>
          <span className="text-sm text-ink-3">
            <Trans>The name is the app's own description and has not been checked.</Trans>
          </span>
        </div>
        <dl className="grid gap-1 text-sm text-ink-2">
          <div className="flex flex-wrap gap-1">
            <dt className="text-ink-3">
              <Trans>App identity:</Trans>
            </dt>
            <dd className="font-medium wrap-anywhere">
              {client.clientIdHost ?? t`registered automatically, no verified identity`}
            </dd>
          </div>
          <div className="flex flex-wrap gap-1">
            <dt className="text-ink-3">
              <Trans>Returns you to:</Trans>
            </dt>
            <dd className="font-medium wrap-anywhere">{client.redirectHost}</dd>
          </div>
        </dl>
      </header>

      <section className="grid gap-2">
        <label htmlFor={workspaceId} className="font-medium">
          <Trans>Workspace</Trans>
        </label>
        {allowedWorkspaces.length === 0 ? (
          <p className="text-ink-2">
            <Trans>
              You can only connect AI apps to a workspace you own, and the owner must allow it. None
              of your workspaces can be connected right now.
            </Trans>
          </p>
        ) : (
          <select
            id={workspaceId}
            className={SETTINGS_SELECT}
            value={props.organizationId ?? ""}
            onChange={(event) => props.onOrganizationChange(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option
                key={workspace.organizationId}
                value={workspace.organizationId}
                disabled={!workspace.allowed}
              >
                {workspace.reason === "NOT_OWNER"
                  ? t`${workspace.name} (only the owner can connect apps)`
                  : workspace.reason === "WORKSPACE_DISABLED"
                    ? t`${workspace.name} (turned off by the owner)`
                    : workspace.name}
              </option>
            ))}
          </select>
        )}
        <p className="text-sm text-ink-3">
          <Trans>The app reads only your own records in this workspace.</Trans>
        </p>
      </section>

      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">
          <Trans>What the app may read</Trans>
        </legend>
        {scopes.map((entry) => (
          <ScopeRow
            key={entry.scope}
            scope={entry.scope}
            required={entry.required}
            requestedByApp={entry.requestedByApp}
            checked={entry.required || props.selectedScopes.includes(entry.scope)}
            onChange={(selected) => props.onScopeChange(entry.scope, selected)}
          />
        ))}
        <p className="px-3 text-sm text-ink-3">
          <Trans>
            The app cannot change your records. Cycle data and progress photos are never shared.
          </Trans>
        </p>
      </fieldset>

      <section className="grid gap-2 rounded-xl bg-paper-2 p-4 text-sm text-ink-2">
        <p>
          <Trans comment="safety">
            Whatever this connection reads goes to {appName}, under that app's own terms and privacy
            policy. OpenValens cannot control what the app does with it.
          </Trans>
        </p>
        <p>
          <Trans comment="safety">
            This is separate from Coach AI consent. You can revoke the connection at any time in
            Settings → Connected AI apps; revoking stops it on its next request.
          </Trans>
        </p>
        <label htmlFor={agreeId} className="flex items-start gap-3 pt-1">
          <input
            id={agreeId}
            type="checkbox"
            checked={props.agreed}
            onChange={(event) => props.onAgreedChange(event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span>
            <Trans comment="safety">
              I agree to share the records chosen above with this app (consent {consentVersion}).
            </Trans>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={props.onDeny}
          disabled={props.isSubmitting}
        >
          <Trans>Deny</Trans>
        </Button>
        <Button type="submit" disabled={!canApprove}>
          <Trans>Allow access</Trans>
        </Button>
      </div>
    </form>
  );
}

function ScopeRow(props: {
  scope: string;
  required: boolean;
  requestedByApp: boolean;
  checked: boolean;
  onChange: (selected: boolean) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const labels: Record<string, { title: string; detail: string }> = {
    "records:read": {
      title: t`Your records`,
      detail: t`Labs, sleep, workouts, vitals, weight and body composition, supplements and goals. Required.`,
    },
    "nutrition:read": {
      title: t`Nutrition`,
      detail: t`Your food diary and nutrient totals.`,
    },
    "private_body:read": {
      title: t`Private body measurements`,
      detail: t`Measurements you keep private.`,
    },
    "notes:read": {
      title: t`Notes`,
      detail: t`Free-text notes on your workouts, labs and other entries.`,
    },
  };
  const label = labels[props.scope] ?? { title: props.scope, detail: "" };
  return (
    <div className="flex min-h-10 items-start gap-3 rounded-xl px-3 py-2 hover:bg-paper-2">
      <input
        type="checkbox"
        id={id}
        checked={props.checked}
        disabled={props.required}
        onChange={(event) => props.onChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 accent-primary"
        data-scope={props.scope}
      />
      <label htmlFor={id} className="grid flex-1 gap-0.5">
        <span className="font-medium text-ink">
          {label.title}
          {props.requestedByApp && !props.required ? (
            <span className="ml-2 text-xs font-normal text-ink-3">
              <Trans>Requested by the app</Trans>
            </span>
          ) : null}
        </span>
        <span className="text-sm text-ink-2">{label.detail}</span>
      </label>
    </div>
  );
}
