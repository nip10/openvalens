import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { Link } from "@tanstack/react-router";
import { Bot, Building2, ChevronRight } from "lucide-react";

import { ErrorState, Section } from "@/components/page";
import { SettingsGroup, SettingsIcon, SettingsRow } from "@/components/settings-rows";

export type AiAppsSettingsCardProps = {
  /** `null` while the workspace setting loads or failed. */
  setting: { membersCanConnect: boolean; canManage: boolean } | null;
  settingStatus: "pending" | "error" | "ready";
  isSaving: boolean;
  onRetry: () => void;
  onChange: (membersCanConnect: boolean) => void;
};

/**
 * Issue #439 — the "Connected AI apps" entry in Settings: a link to the page
 * and the workspace owner's switch "Members can connect AI apps" (on by
 * default; turning it off stops existing keys and connections in this
 * workspace on their next call). Separate from the Coach AI switch.
 * Presentational; rendered only while the server has AI apps on.
 */
export function AiAppsSettingsCard(props: AiAppsSettingsCardProps) {
  const { t } = useLingui();
  const on = props.setting?.membersCanConnect === true;
  const canManage = props.setting?.canManage === true;

  return (
    <Section
      title={<Trans>Connected AI apps</Trans>}
      icon={Bot}
      tone="signal"
      info={
        <Trans comment="safety">
          Let an AI app such as Claude or ChatGPT read your own records to answer your questions.
          This is separate from Coach AI and needs its own consent.
        </Trans>
      }
    >
      <SettingsGroup className="px-0">
        <Link
          to="/settings/ai-apps"
          className="flex min-h-16 items-center gap-4 px-5 py-3 no-underline transition-colors duration-[var(--dur-short)] first:rounded-t-3xl hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <SettingsIcon icon={Bot} />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="font-medium text-ink">
              <Trans>Connected AI apps</Trans>
            </span>
            <span className="text-sm text-ink-3">
              <Trans>Connections, personal keys and recent activity</Trans>
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
        </Link>
        <div className="px-5">
          {props.settingStatus === "pending" ? (
            <Skeleton className="my-3 h-10 w-full" />
          ) : props.settingStatus === "error" ? (
            <ErrorState
              className="my-3"
              title={<Trans>Could not load the workspace setting.</Trans>}
              action={
                <Button variant="outline" size="sm" onClick={props.onRetry}>
                  <Trans>Retry</Trans>
                </Button>
              }
            />
          ) : (
            <SettingsRow
              icon={Building2}
              label={<Trans>Members can connect AI apps</Trans>}
              description={
                canManage
                  ? on
                    ? t`On. Turning it off stops every key and connection in this workspace.`
                    : t`Off. Keys and connections in this workspace are paused.`
                  : on
                    ? t`On. Only the workspace owner can change this.`
                    : t`Off. Only the workspace owner can change this.`
              }
            >
              <Switch
                aria-label={t`Members can connect AI apps`}
                checked={on}
                disabled={!canManage || props.isSaving}
                onCheckedChange={(checked) => props.onChange(checked)}
              />
            </SettingsRow>
          )}
        </div>
      </SettingsGroup>
    </Section>
  );
}
