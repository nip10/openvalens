import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";

import { ModulesSettings } from "@/components/modules-settings";
import { Page } from "@/components/page";
import { SettingsPageHeader } from "@/components/settings-back-link";

export const Route = createFileRoute("/_auth/settings/modules")({
  component: ModulesSettingsPage,
});

function ModulesSettingsPage() {
  return (
    <Page>
      <SettingsPageHeader
        title={<Trans>Modules</Trans>}
        description={<Trans>Choose the parts of the app you use.</Trans>}
      />
      <ModulesSettings />
    </Page>
  );
}
