import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

import { useAnalyticsConsent } from "@openvalens/ui/hooks/use-analytics-consent";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

const analyticsApi = client.analytics;

export function AnalyticsConsentSection() {
  const { data: auth, isPending } = authClient.useSession();
  const user = auth?.user?.id;
  const org = auth?.session.activeOrganizationId;
  const scope = useMemo(
    () => (!isPending && user && org ? JSON.stringify([user, org]) : ""),
    [isPending, user, org],
  );
  const consent = useAnalyticsConsent({ api: analyticsApi, scope, ownerId: user ?? "" });
  const { preference, pending, error, gate, locallyRevoked } = consent;
  const busy = pending !== null;
  const checked = preference?.enabled === true && !locallyRevoked;
  const { t } = useLingui();
  const stoppedLocally = t({
    message: "Stopped locally; server change unconfirmed. Retry turning it off.",
    comment: "safety",
  });
  const status =
    isPending || !scope || (!preference && !error)
      ? t`Checking your account and server settings…`
      : error === "read"
        ? t`Could not load your preference.`
        : error === "revoke"
          ? stoppedLocally
          : error === "enable"
            ? t({ message: "Could not confirm enabling. Sharing remains off.", comment: "safety" })
            : !preference?.available
              ? t({
                  message:
                    "Analytics are unavailable on this server. You can still turn off sharing.",
                  comment: "safety",
                })
              : busy
                ? t`Updating your setting…`
                : gate
                  ? t({ message: "Sharing is on.", comment: "safety" })
                  : t({
                      message: "Sharing is off unless you explicitly opt in.",
                      comment: "safety",
                    });

  return (
    <section aria-labelledby="analytics-title" className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 id="analytics-title" className="text-lg font-semibold">
        <Trans>Usage analytics</Trans>
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        <Trans comment="safety">
          Optional usage analytics via PostHog EU. Sends approved settings-action names and a new
          random event ID for each event; events are not linked to your account, device, session, or
          workspace. No health records or free text are sent. PostHog retains events and their IDs
          and sees our server’s network IP, not your forwarded IP. Turning this off stops new sends;
          already-sent events cannot be recalled.
        </Trans>
      </p>
      <p role="status" className="mt-3 text-sm text-muted-foreground">
        {status}
      </p>
      {(error || (pending === null && !preference)) && (
        <button
          className="mt-2 min-h-11 underline"
          disabled={busy}
          onClick={error ? consent.retry : consent.refresh}
        >
          <Trans>Retry</Trans>
        </button>
      )}
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          aria-label={t({ message: "Share optional usage analytics", comment: "safety" })}
          type="checkbox"
          className="size-5 accent-primary"
          checked={checked}
          disabled={
            busy ||
            !scope ||
            isPending ||
            !preference ||
            (!preference.available && !preference.enabled && error !== "revoke")
          }
          onChange={(event) => void consent.setPreference(event.currentTarget.checked)}
        />
        <Trans comment="safety">Share optional usage analytics</Trans>
      </label>
      {error === "revoke" && (
        <p role="alert" className="text-sm text-destructive">
          {stoppedLocally}
        </p>
      )}
    </section>
  );
}
