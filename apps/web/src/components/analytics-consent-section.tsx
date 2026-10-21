import { useMemo } from "react";

import { useAnalyticsConsent } from "@openvalens/ui/hooks/use-analytics-consent";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

const analyticsApi = client.analytics;

export function AnalyticsConsentSection() {
  const { data: auth, isPending } = authClient.useSession();
  const user = auth?.user?.id;
  const org = auth?.session.activeOrganizationId;
  const scope = useMemo(() => !isPending && user && org ? JSON.stringify([user, org]) : "", [isPending, user, org]);
  const consent = useAnalyticsConsent({ api: analyticsApi, scope, ownerId: user ?? "" });
  const { preference, pending, error, gate, locallyRevoked } = consent;
  const busy = pending !== null;
  const checked = preference?.enabled === true && !locallyRevoked;
  const status = isPending || !scope || !preference && !error
    ? "Checking your account and server settings…"
    : error === "read" ? "Could not load your preference."
    : error === "revoke" ? "Stopped locally; server change unconfirmed. Retry turning it off."
    : error === "enable" ? "Could not confirm enabling. Sharing remains off."
    : !preference?.available ? "Analytics are unavailable on this server. You can still turn off sharing."
    : busy ? "Updating your setting…"
    : gate ? "Sharing is on." : "Sharing is off unless you explicitly opt in.";

  return <section aria-labelledby="analytics-title" className="rounded-xl border bg-card p-5 shadow-sm">
    <h2 id="analytics-title" className="text-lg font-semibold">Usage analytics</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Optional usage analytics via PostHog EU. Sends approved settings-action names and a new random event ID for each event; events are not linked to your account, device, session, or workspace. No health records or free text are sent. PostHog retains events and their IDs and sees our server’s network IP, not your forwarded IP. Turning this off stops new sends; already-sent events cannot be recalled.</p>
    <p role="status" className="mt-3 text-sm text-muted-foreground">{status}</p>
    {(error || pending === null && !preference) && <button className="mt-2 min-h-11 underline" disabled={busy} onClick={error ? consent.retry : consent.refresh}>Retry</button>}
    <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium"><input aria-label="Share optional usage analytics" type="checkbox" className="size-5 accent-primary" checked={checked} disabled={busy || !scope || isPending || !preference || (!preference.available && !preference.enabled && error !== "revoke")} onChange={(event) => void consent.setPreference(event.currentTarget.checked)} />Share optional usage analytics</label>
    {error === "revoke" && <p role="alert" className="text-sm text-destructive">Stopped locally; server change unconfirmed. Retry turning it off.</p>}
  </section>;
}
