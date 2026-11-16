import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { Building2 } from "lucide-react";

import { ErrorState, Section } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";

export type AiAppsSettingsCardProps = {
  /** `null` while the workspace setting loads or failed. */
  setting: { membersCanConnect: boolean; canManage: boolean } | null;
  settingStatus: "pending" | "error" | "ready";
  isSaving: boolean;
  onRetry: () => void;
  onChange: (membersCanConnect: boolean) => void;
};

/** The section's anchor, for the "AI apps are off" banner at the top of the page. */
export const AI_APPS_WORKSPACE_ANCHOR = "workspace-ai-apps";

/**
 * Issue #439 — the workspace owner's switch "Members can connect AI apps" (on
 * by default; turning it off stops existing keys and connections in this
 * workspace on their next call). Separate from the Coach AI switch.
 * #settings-ai-apps-2: it lives on Settings › Connected AI apps, next to the
 * keys and connections it can block. Presentational; rendered only while the
 * server has AI apps on.
 */
export function AiAppsSettingsCard(props: AiAppsSettingsCardProps) {
  const { t } = useLingui();
  const on = props.setting?.membersCanConnect === true;
  const canManage = props.setting?.canManage === true;

  return (
    <Section
      id={AI_APPS_WORKSPACE_ANCHOR}
      className="scroll-mt-10"
      title={<Trans>This workspace</Trans>}
      icon={Building2}
      tone="signal"
      info={
        <Trans comment="safety">
          Let an AI app such as Claude or ChatGPT read your own records to answer your questions.
          This is separate from Coach AI and needs its own consent.
        </Trans>
      }
    >
      {props.settingStatus === "pending" ? (
        <Skeleton className="h-16 w-full rounded-3xl" />
      ) : props.settingStatus === "error" ? (
        <ErrorState
          title={<Trans>Could not load the workspace setting.</Trans>}
          action={
            <Button variant="outline" size="sm" onClick={props.onRetry}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : (
        <SettingsGroup>
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
        </SettingsGroup>
      )}
    </Section>
  );
}
