import { isSetupItem } from "@openvalens/api/presenters/onboarding";
import { Redirect, useLocalSearchParams } from "expo-router";

import {
  closeSetupItem,
  OnboardingLoadError,
  OnboardingLoading,
  useOnboardingProfile,
  type StepNav,
} from "@/components/onboarding/flow";
import { FirstLogStep } from "@/components/onboarding/first-log";
import {
  BasicsStep,
  ConnectStep,
  GoalStep,
  ModulesStep,
  PrivacyStep,
} from "@/components/onboarding/steps";

/**
 * Onboarding (#444) — one "Finish setting up" item on its own screen.
 * Saving or going back returns to Today, where the card ticks the item off.
 */
export default function SetupItemScreen() {
  const params = useLocalSearchParams<{ item?: string }>();
  const flow = useOnboardingProfile();
  const { snapshot } = flow;

  if (!isSetupItem(params.item)) return <Redirect href="/(drawer)/(tabs)" />;
  if (!flow.userId) return <Redirect href="/" />;
  if (flow.profile.isPending) return <OnboardingLoading />;
  if (flow.profile.isError || !snapshot) {
    return <OnboardingLoadError onRetry={() => void flow.profile.refetch()} />;
  }

  const nav: StepNav = { step: null, onDone: closeSetupItem, onBack: closeSetupItem };
  const props = { flow: { ...flow, snapshot }, nav };
  switch (params.item) {
    case "first_log":
      return <FirstLogStep {...props} />;
    case "connect":
      return <ConnectStep {...props} />;
    case "modules":
      return <ModulesStep {...props} />;
    case "basics":
      return <BasicsStep {...props} />;
    case "goal":
      return <GoalStep {...props} />;
    case "privacy":
      return <PrivacyStep nav={nav} />;
  }
}
