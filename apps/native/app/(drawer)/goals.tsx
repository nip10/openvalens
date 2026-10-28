import { Trans } from "@lingui/react/macro";
import { Page, PageHeader } from "@/components/bloom";
import { Container } from "@/components/container";
import { GoalsContent } from "./workouts";

/** Goals remain reachable while their full editor is separated from training. */
export default function GoalsRoute() {
  return (
    <Container>
      <Page>
        <PageHeader title={<Trans>Goals</Trans>} />
        <GoalsContent />
      </Page>
    </Container>
  );
}
