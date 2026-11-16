import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { BellRing } from "lucide-react";

import { Page, Section } from "@/components/page";
import { SettingsPageHeader } from "@/components/settings-back-link";
import { SettingsGroup } from "@/components/settings-rows";
import { TelegramChannel } from "@/components/telegram-channel";

/**
 * Settings › Telegram. Telegram now sits with the other reminder channels in
 * Settings › Notifications; this page stays for the bot's replies and the
 * mobile app, which still link here.
 */
export const Route = createFileRoute("/_auth/settings/telegram")({
  component: TelegramSettingsPage,
});

export function TelegramSettingsPage() {
  return (
    <Page width="narrow">
      <SettingsPageHeader title="Telegram" />
      <Section title={<Trans>Daily reminders over Telegram</Trans>} icon={BellRing} tone="signal">
        <SettingsGroup className="py-4">
          <TelegramChannel />
        </SettingsGroup>
      </Section>
    </Page>
  );
}
