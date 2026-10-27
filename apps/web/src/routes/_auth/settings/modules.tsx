import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";

import { ModulesSettings } from "@/components/modules-settings";
import { Page, PageHeader } from "@/components/page";

export const Route = createFileRoute("/_auth/settings/modules")({
  component: ModulesSettingsPage,
});

function ModulesSettingsPage() {
  return (
    <Page>
      <PageHeader
        title={<Trans>Modules</Trans>}
        description={<Trans>Choose the parts of the app you use.</Trans>}
      />
      <ModulesSettings />
    </Page>
  );
}
