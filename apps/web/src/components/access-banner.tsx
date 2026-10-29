import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { orpc } from "@/utils/orpc";

/**
 * Issue #298 — a calm, persistent note when the OpenValens Cloud workspace in
 * use has lost (or is about to lose) write access. Owners get a link to
 * Settings › Plan & billing; members get a neutral note, since the owner's
 * plan covers them. Nothing shows on self-host or with full access.
 */

export type AccessState = {
  mode: "self-hosted" | "cloud";
  level: "full" | "read_only";
  state: "none" | "trialing" | "active" | "past_due" | "canceled" | "ended" | null;
  graceEndsAt: string | null;
  viewer: "owner" | "member";
  ownerName: string | null;
};

export function accessStateQueryOptions() {
  return {
    ...orpc.access.status.queryOptions({ input: {} }),
    staleTime: 5 * 60_000,
    retry: 1,
  };
}

export function AccessBannerView({
  access,
  billingLink,
}: {
  access: AccessState;
  /** The link to Settings › Plan & billing, shown to owners only. */
  billingLink: ReactNode;
}) {
  const { t, i18n } = useLingui();
  if (access.mode !== "cloud") return null;
  const pastDueGrace = access.level === "full" && access.state === "past_due";
  if (access.level === "full" && !pastDueGrace) return null;
  // During a payment grace period only the owner, who can fix it, is told.
  if (pastDueGrace && access.viewer !== "owner") return null;

  const graceEnd = access.graceEndsAt
    ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: "long" }).format(
        new Date(access.graceEndsAt),
      )
    : null;
  const owner = access.ownerName;

  let message: string;
  if (pastDueGrace) {
    message = graceEnd
      ? t`We couldn’t take your latest OpenValens Cloud payment. Update your payment method by ${graceEnd} to keep adding and syncing records.`
      : t`We couldn’t take your latest OpenValens Cloud payment. Update your payment method to keep adding and syncing records.`;
  } else if (access.viewer === "owner") {
    message = t`Your OpenValens Cloud access has ended. Your records are still here: you can read, export or delete them. Adding and syncing records starts again when you choose a plan.`;
  } else {
    message = owner
      ? t`Your access to this workspace comes from ${owner}’s plan, which has ended. Its records are still here to read and export.`
      : t`Your access to this workspace comes from its owner’s plan, which has ended. Its records are still here to read and export.`;
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-8 lg:px-10">
      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3 text-sm text-ink-2"
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          {message}
          {access.viewer === "owner" ? <> {billingLink}</> : null}
        </p>
      </div>
    </div>
  );
}

export function AccessBanner() {
  const access = useQuery(accessStateQueryOptions());
  if (!access.data) return null;
  return (
    <AccessBannerView
      access={access.data}
      billingLink={
        <Link
          to="/settings/billing"
          className="font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2"
        >
          <Trans>Plan & billing</Trans>
        </Link>
      }
    />
  );
}
