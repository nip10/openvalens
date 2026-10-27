import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  DatabaseBackup,
  Mail,
  MailPlus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { StatusPill, type StatusTone } from "@/components/page";
import { SettingsGroup, SettingsIcon } from "@/components/settings-rows";
import {
  adminBackupStatusQueryOptions,
  adminConfigurationQueryOptions,
} from "@/utils/admin-settings";
import type { AdminBackupStatusOutput } from "@/utils/admin-settings-keys";
import { admissionStatusQueryOptions } from "@/utils/admission";
import { orpc } from "@/utils/orpc";

/**
 * Onboarding stage 2 — the server owner's short checklist, shown before their
 * own onboarding. Links to the existing admin pages and shows the readiness
 * the server already reports; nothing here changes a setting.
 */
export type ServerChecklistState = {
  /** `null` while loading or unknown. */
  emailDelivery: boolean | null;
  backups: AdminBackupStatusOutput["state"] | null;
  aiProviderConfigured: boolean | null;
  workspaceAiOn: boolean | null;
};

export function ServerChecklistView({
  state,
  onContinue,
}: {
  state: ServerChecklistState;
  onContinue: () => void;
}) {
  const { t } = useLingui();
  const unknown = { tone: "neutral" as const, label: t`Checking…` };
  const email =
    state.emailDelivery === null
      ? unknown
      : state.emailDelivery
        ? { tone: "good" as const, label: t`Ready` }
        : { tone: "warn" as const, label: t`Not set up` };
  const backups =
    state.backups === null
      ? unknown
      : state.backups === "ok"
        ? { tone: "good" as const, label: t`Backups healthy` }
        : state.backups === "failing"
          ? { tone: "bad" as const, label: t`Backups failing` }
          : state.backups === "stale"
            ? { tone: "warn" as const, label: t`No recent backup` }
            : { tone: "neutral" as const, label: t`Not reported` };
  const ai =
    state.aiProviderConfigured === null
      ? unknown
      : !state.aiProviderConfigured
        ? { tone: "neutral" as const, label: t`Off` }
        : state.workspaceAiOn
          ? { tone: "good" as const, label: t`On` }
          : { tone: "neutral" as const, label: t`Provider set, AI off` };

  return (
    <section aria-labelledby="server-checklist-title" className="sheet grid gap-6 p-6 md:p-8">
      <div className="grid gap-1.5">
        <h1
          id="server-checklist-title"
          className="text-[1.75rem] leading-tight tracking-[-0.02em] text-ink"
        >
          <Trans>Server checklist</Trans>
        </h1>
        <p className="max-w-[60ch] text-ink-2">
          <Trans>
            You set up this server. A quick look at what it reports, then your own setup.
          </Trans>
        </p>
      </div>
      <SettingsGroup className="px-0">
        <ChecklistLink
          to="/admin/settings"
          icon={Mail}
          label={<Trans>Email delivery</Trans>}
          description={<Trans>Sign-in codes and invitations are sent by email.</Trans>}
          status={email}
        />
        <ChecklistLink
          to="/admin/settings"
          icon={DatabaseBackup}
          label={<Trans>Backups</Trans>}
          description={<Trans>Taken and verified with deploy/setup.sh on the server.</Trans>}
          status={backups}
        />
        <ChecklistLink
          to="/settings"
          hash="ai"
          icon={Sparkles}
          label={<Trans>AI provider</Trans>}
          description={<Trans>Off unless a provider is configured and you turn AI on.</Trans>}
          status={ai}
        />
        <ChecklistLink
          to="/admin/invitations"
          icon={MailPlus}
          label={<Trans>Invite people</Trans>}
          description={<Trans>Send an invitation to each person who should have an account.</Trans>}
        />
      </SettingsGroup>
      <div>
        <Button onClick={onContinue}>
          <Trans>Continue to your setup</Trans>
        </Button>
      </div>
    </section>
  );
}

function ChecklistLink({
  to,
  hash,
  icon,
  label,
  description,
  status,
}: {
  to: "/admin/settings" | "/admin/invitations" | "/settings";
  hash?: string;
  icon: LucideIcon;
  label: ReactNode;
  description: ReactNode;
  status?: { tone: StatusTone; label: string };
}) {
  return (
    <Link
      to={to}
      hash={hash}
      className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 no-underline transition-colors duration-[var(--dur-short)] first:rounded-t-3xl last:rounded-b-3xl hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <SettingsIcon icon={icon} />
      <span className="grid min-w-0 flex-1 basis-40 gap-0.5">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-sm text-ink-3">{description}</span>
      </span>
      {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
    </Link>
  );
}

/** The connected checklist: reads the admin readiness queries (instance admins only). */
export function ServerChecklist({
  userId,
  onContinue,
}: {
  userId: string;
  onContinue: () => void;
}) {
  const admission = useQuery(admissionStatusQueryOptions());
  const backups = useQuery(adminBackupStatusQueryOptions(userId));
  const config = useQuery(adminConfigurationQueryOptions(userId));
  const workspaceAi = useQuery({
    ...orpc.ai.workspaceConsent.get.queryOptions({ input: {} }),
    retry: 1,
  });
  const aiProvider = config.data?.entries.find((entry) => entry.key === "AI_PROVIDER");
  return (
    <ServerChecklistView
      state={{
        emailDelivery: admission.data ? admission.data.emailDeliveryAvailable : null,
        backups: backups.data ? backups.data.state : backups.isError ? "unknown" : null,
        aiProviderConfigured: config.data ? aiProvider?.configured === true : null,
        workspaceAiOn: workspaceAi.data ? workspaceAi.data.enabled : null,
      }}
      onContinue={onContinue}
    />
  );
}
