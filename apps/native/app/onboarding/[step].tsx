import { Trans } from "@lingui/react/macro";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Button } from "heroui-native";

import { ErrorState, Page, Sheet } from "@/components/bloom";
import { Container } from "@/components/container";
import { useOnboardingFlow } from "@/components/onboarding/flow";
import { STEP_SCREENS } from "@/components/onboarding/steps";
import { guardStep, isOnboardingRoute } from "@/lib/onboarding/steps";

/**
 * Onboarding stage 3 — one step of the first-run flow. Steps after the age
 * check wait for its answer; an unknown step opens the welcome.
 */
export default function OnboardingStepScreen() {
  const params = useLocalSearchParams<{ step?: string }>();
  const requested = isOnboardingRoute(params.step) ? params.step : "welcome";
  const flow = useOnboardingFlow(requested);
  const { profile, snapshot } = flow;

  if (!flow.userId) return <Redirect href="/" />;
  if (profile.isPending) {
    return (
      <Container>
        <Page className="pt-16">
          <Sheet className="h-24" />
          <Sheet className="h-48" />
        </Page>
      </Container>
    );
  }
  if (profile.isError || !snapshot) {
    return (
      <Container>
        <Page className="pt-16">
          <ErrorState
            title={<Trans>Could not load your profile. Nothing has changed.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void profile.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );
  }
  const step = guardStep(requested, snapshot);
  if (step !== requested) {
    return <Redirect href={{ pathname: "/onboarding/[step]", params: { step } }} />;
  }
  const Screen = STEP_SCREENS[step];
  return <Screen flow={{ ...flow, snapshot }} />;
}
