import { useLingui } from "@lingui/react/macro";
import { wellnessProfileQueryKey } from "@openvalens/api/presenters/wellness-profile";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";

import {
  leaveOnboarding,
  OnboardingLoadError,
  OnboardingLoading,
  openFirstRun,
  useHealthConsentStatus,
  useOnboardingProfile,
  type StepNav,
} from "@/components/onboarding/flow";
import { FirstLogStep } from "@/components/onboarding/first-log";
import { ConnectStep, ServerStep, StartStep } from "@/components/onboarding/steps";
import { needsHealthConsent } from "@/lib/health-consent";
import {
  canSkip,
  guardRoute,
  isOnboardingRoute,
  nextRoute,
  previousRoute,
} from "@/lib/onboarding/steps";
import { client } from "@/utils/orpc";

/**
 * Onboarding (#444) — one screen of the first run: before you start (age
 * check and health-data consent), the first log, connect. Later screens wait
 * for screen 1's answers; an unknown step opens screen 1.
 */
export default function OnboardingStepScreen() {
  const params = useLocalSearchParams<{ step?: string }>();
  const requested = isOnboardingRoute(params.step) ? params.step : "start";
  const flow = useOnboardingProfile();
  const consent = useHealthConsentStatus(flow.userId);
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const { snapshot, userId } = flow;

  // Opening the first run marks it as seen, so it opens by itself only once.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !snapshot || snapshot.setupStatus !== null) return;
    marked.current = true;
    void client.profile
      .update({ expectedRevision: snapshot.revision, setupStatus: "in_progress" })
      .then((next) => queryClient.setQueryData(wellnessProfileQueryKey(userId), next))
      .catch(() => undefined);
  }, [snapshot, queryClient, userId]);

  if (!userId) return <Redirect href="/" />;
  if (flow.profile.isPending || consent.isLoading) return <OnboardingLoading />;
  if (flow.profile.isError || !snapshot || consent.isError) {
    return (
      <OnboardingLoadError
        onRetry={() => {
          void flow.profile.refetch();
          void consent.refetch();
        }}
      />
    );
  }

  const consentNeeded = consent.data ? needsHealthConsent(consent.data) : null;
  const step = guardRoute(requested, snapshot, { consentNeeded });
  if (step !== requested) {
    return <Redirect href={{ pathname: "/onboarding/[step]", params: { step } }} />;
  }

  /** The first run is over: record it and open Today. */
  const finish = async () => {
    if (snapshot.setupStatus === null || snapshot.setupStatus === "in_progress") {
      if (!(await flow.save({ setupStatus: "completed" }))) return;
    }
    leaveOnboarding();
  };
  const next = nextRoute(step);
  const previous = previousRoute(step);
  const goNext = () => (next ? openFirstRun(next) : void finish());
  const nav: StepNav = {
    step,
    onDone: goNext,
    // The last screen's main button already ends the first run.
    onSkip: canSkip(step) && next ? goNext : undefined,
    onBack: previous
      ? () => router.dismissTo({ pathname: "/onboarding/[step]", params: { step: previous } })
      : undefined,
    doneLabel: next ? undefined : t`Go to Today`,
  };
  const loaded = { ...flow, snapshot };

  switch (step) {
    case "server":
      return <ServerStep nav={nav} />;
    case "start":
      return <StartStep flow={loaded} nav={nav} />;
    case "first_log":
      return <FirstLogStep flow={loaded} nav={nav} />;
    case "connect":
      return <ConnectStep flow={loaded} nav={nav} />;
  }
}
