import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
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
    <section aria-labelledby="analytics-title" className="grid min-w-0 content-start gap-4">
      <div className="grid min-w-0 gap-1">
        <h2 id="analytics-title" className="text-xl leading-tight text-ink">
          <Trans>Usage analytics</Trans>
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">
          <Trans comment="safety">
            Optional usage analytics via PostHog EU. Sends approved settings-action names and a new
            random event ID for each event; events are not linked to your account, device, session,
            or workspace. No health records or free text are sent. PostHog retains events and their
            IDs and sees our server’s network IP, not your forwarded IP. Turning this off stops new
            sends; already-sent events cannot be recalled.
          </Trans>
        </p>
      </div>
      <div className="sheet grid gap-3 px-5 py-4">
        <label className="flex min-h-11 items-center justify-between gap-6">
          <span className="font-display font-medium text-ink">
            <Trans comment="safety">Share optional usage analytics</Trans>
          </span>
          <input
            aria-label={t({ message: "Share optional usage analytics", comment: "safety" })}
            type="checkbox"
            className="size-5 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-55"
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
        </label>
        <p role="status" className="text-sm text-ink-3">
          {status}
        </p>
        {(error || (pending === null && !preference)) && (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={error ? consent.retry : consent.refresh}
            >
              <Trans>Retry</Trans>
            </Button>
          </div>
        )}
        {error === "revoke" && (
          <p role="alert" className="text-sm text-destructive">
            {stoppedLocally}
          </p>
        )}
      </div>
    </section>
  );
}
