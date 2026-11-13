import { Trans, useLingui } from "@lingui/react/macro";
import { isSetupItem, type SetupItem } from "@openvalens/api/presenters/onboarding";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import {
  BasicsStep,
  ConnectStep,
  FirstLogStep,
  GoalStep,
  ModulesStep,
  PrivacyStep,
} from "@/components/onboarding/setup-steps";
import { ErrorState, Page } from "@/components/page";
import { orpc } from "@/utils/orpc";
import { useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Onboarding (#444) — one "Finish setting up" item on its own screen. Saving
 * or going back returns to Today, where the card ticks the item off.
 */
export const Route = createFileRoute("/_auth/setup/$item")({
  beforeLoad: ({ params }) => {
    if (!isSetupItem(params.item)) throw redirect({ to: "/dashboard" });
  },
  component: SetupItemPage,
});

function SetupItemPage() {
  const { item } = Route.useParams();
  const profile = useWellnessProfile();
  const { t } = useLingui();
  if (!isSetupItem(item)) return null;
  if (profile.isPending) {
    return (
      <Page width="narrow" className="max-w-3xl">
        <Skeleton className="h-96 w-full rounded-3xl" />
      </Page>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <Page width="narrow">
        <ErrorState
          title={t`Could not load your profile. Nothing has changed.`}
          action={
            <Button onClick={() => void profile.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }
  return (
    <Page width="narrow" className="max-w-3xl">
      <SetupItemScreen
        item={item}
        snapshot={profile.data}
        userId={profile.userId}
        reload={() => profile.refetch()}
      />
    </Page>
  );
}

function SetupItemScreen({
  item,
  snapshot,
  userId,
  reload,
}: {
  item: SetupItem;
  snapshot: WellnessProfileSnapshot;
  userId: string;
  reload: () => unknown;
}) {
  const navigate = useNavigate();
  const toToday = () => void navigate({ to: "/dashboard" });
  const goals = useQuery({
    ...orpc.plans.goals.listGoals.queryOptions({ input: {} }),
    enabled: item === "goal",
  });
  const common = { onDone: toToday, onBack: toToday };
  const profileProps = { ...common, snapshot, userId, reload };
  switch (item) {
    case "first_log":
      return <FirstLogStep {...common} snapshot={snapshot} />;
    case "connect":
      return <ConnectStep {...common} />;
    case "modules":
      return <ModulesStep {...profileProps} />;
    case "basics":
      return <BasicsStep {...profileProps} />;
    case "goal":
      return <GoalStep {...common} snapshot={snapshot} goalCount={goals.data?.length ?? 0} />;
    case "privacy":
      return <PrivacyStep {...common} />;
  }
}
