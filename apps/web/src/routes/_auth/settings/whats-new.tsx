import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";

import { Page, PageHeader } from "@/components/page";
import { WhatsNewChangelog } from "@/components/whats-new-changelog";
import { WhatsNewSection } from "@/components/whats-new-section";

export const Route = createFileRoute("/_auth/settings/whats-new")({
  component: WhatsNewPage,
});

/** Settings › What's new (#dashboard-6): the full changelog, and the dialog's switch. */
function WhatsNewPage() {
  return (
    <Page width="narrow">
      <PageHeader title={<Trans>What's new</Trans>} />
      <WhatsNewSection />
      <WhatsNewChangelog />
    </Page>
  );
}
