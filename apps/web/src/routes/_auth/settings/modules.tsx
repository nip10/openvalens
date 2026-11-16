import { Trans } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

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
        actions={
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded-full px-1 text-sm font-medium text-ink-2 underline decoration-signal underline-offset-[0.15em] hover:text-ink hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            <Trans>Settings</Trans>
          </Link>
        }
      />
      <ModulesSettings />
    </Page>
  );
}
