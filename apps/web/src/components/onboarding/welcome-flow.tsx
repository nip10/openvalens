import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  FIRST_RUN_STEP_TITLES,
  firstRunPosition,
  firstRunResumeStep,
  nextFirstRunStep,
  previousFirstRunStep,
  type FirstRunStep,
} from "@openvalens/api/presenters/onboarding";
import { describeProfileSaveError } from "@openvalens/api/presenters/wellness-profile";
import type {
  EligibilityAnswer,
  WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { AgeBody, ConsentBody, StepFrame } from "@/components/onboarding/onboarding-steps";
import { ServerChecklist } from "@/components/onboarding/server-checklist";
import { ConnectStep, FirstLogStep } from "@/components/onboarding/setup-steps";
import { ErrorState, Page } from "@/components/page";
import { adminAccessQueryOptions } from "@/utils/admin-settings";
import { needsHealthConsent, type HealthConsentStatus } from "@/utils/health-consent";
import { healthConsentStatusQueryOptions } from "@/utils/onboarding-data";
import { client } from "@/utils/orpc";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

const COPY = {
  consentFailed: msg`Consent could not be saved. The version may have changed; review it and try again.`,
  goToToday: msg`Go to Today`,
};

/**
 * Onboarding (#444) — the web first run at `/welcome`, three screens:
 * age check plus health-data consent (required), the first log, and connect.
 * Each screen saves as the person goes; leaving part-way loses nothing, and
 * everything else waits on Today's "Finish setting up" card.
 */
export function WelcomeFlow() {
  const profile = useWellnessProfile();
  const consent = useQuery({
    ...healthConsentStatusQueryOptions(profile.userId),
    enabled: !!profile.userId,
  });
  const { t } = useLingui();
  if (profile.isPending || (consent.isPending && !!profile.userId)) {
    return (
      <Page>
        <Skeleton className="h-96 w-full rounded-3xl" />
      </Page>
    );
  }
  if (profile.isError || !profile.data || consent.isError) {
    return (
      <Page width="narrow">
        <ErrorState
          title={t`Could not load your profile. Nothing has changed.`}
          action={
            <Button
              onClick={() => {
                void profile.refetch();
                void consent.refetch();
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }
  return (
    <WelcomeFlowLoaded
      snapshot={profile.data}
      consent={consent.data ?? null}
      userId={profile.userId}
      reload={() => profile.refetch()}
    />
  );
}

function WelcomeFlowLoaded({
  snapshot,
  consent,
  userId,
  reload,
}: {
  snapshot: WellnessProfileSnapshot;
  consent: HealthConsentStatus | null;
  userId: string;
  reload: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const { i18n } = useLingui();
  const update = useUpdateWellnessProfile(userId);
  const access = useQuery({ ...adminAccessQueryOptions(userId), enabled: !!userId });
  const consentNeeded = needsHealthConsent(consent);

  // Where to start, fixed on first load: screen 1 until it is answered.
  const [initial] = useState(() => ({
    step: firstRunResumeStep(snapshot, { consentNeeded }),
    firstRun: snapshot.setupStatus === null,
  }));
  const [step, setStep] = useState<FirstRunStep>(initial.step);
  const [checklistDone, setChecklistDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);

  // Opening the first run marks it as seen, so the first-sign-in redirect happens once.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || snapshot.setupStatus !== null) return;
    marked.current = true;
    update.mutate({ expectedRevision: snapshot.revision, setupStatus: "in_progress" });
  }, [snapshot.revision, snapshot.setupStatus, update]);

  const progress = (current: FirstRunStep) => ({
    ...firstRunPosition(current),
    label: i18n._(FIRST_RUN_STEP_TITLES[current]),
  });
  const go = (target: FirstRunStep | null) => {
    if (!target) return;
    setError(null);
    setStep(target);
  };

  /** The first run is over: record it and open Today. */
  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      if (snapshot.setupStatus === null || snapshot.setupStatus === "in_progress") {
        await update.mutateAsync({ expectedRevision: snapshot.revision, setupStatus: "completed" });
      }
      await navigate({ to: "/dashboard" });
    } catch (e) {
      const described = describeProfileSaveError(e);
      if (described.kind === "conflict") await reload();
      setError(described.message);
    } finally {
      setFinishing(false);
    }
  };

  const showChecklist =
    initial.firstRun && !checklistDone && step === "start" && access.data?.isInstanceAdmin === true;

  let body;
  if (showChecklist) {
    body = <ServerChecklist userId={userId} onContinue={() => setChecklistDone(true)} />;
  } else if (step === "start") {
    body = (
      <StartStep
        snapshot={snapshot}
        consent={consent}
        userId={userId}
        reload={reload}
        progress={progress("start")}
        onDone={() => go(nextFirstRunStep("start"))}
      />
    );
  } else if (step === "first_log") {
    body = (
      <FirstLogStep
        snapshot={snapshot}
        progress={progress("first_log")}
        onDone={() => go(nextFirstRunStep("first_log"))}
        onBack={() => go(previousFirstRunStep("first_log"))}
      />
    );
  } else {
    body = (
      <div className="grid gap-3">
        <ConnectStep
          progress={progress("connect")}
          doneLabel={COPY.goToToday}
          onDone={() => void finish()}
          onBack={finishing ? undefined : () => go(previousFirstRunStep("connect"))}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {i18n._(error)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Page width="narrow" className="max-w-3xl">
      {body}
    </Page>
  );
}

/**
 * Screen 1: the age check and, when this server asks for it, the health-data
 * consent. The only screen without Skip.
 */
function StartStep({
  snapshot,
  consent,
  userId,
  reload,
  progress,
  onDone,
}: {
  snapshot: WellnessProfileSnapshot;
  consent: HealthConsentStatus | null;
  userId: string;
  reload: () => Promise<unknown>;
  progress: { index: number; total: number; label: string };
  onDone: () => void;
}) {
  const { i18n } = useLingui();
  const titleId = useId();
  const queryClient = useQueryClient();
  const update = useUpdateWellnessProfile(userId);
  const [eligibility, setEligibility] = useState<EligibilityAnswer>(snapshot.eligibility);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const consentNeeded = needsHealthConsent(consent);
  const version = consent?.currentVersion ?? null;

  const accept = useMutation({
    mutationFn: (v: string) =>
      client.healthConsent.accept({ acceptedHealthDataConsent: true, version: v }),
    onSuccess: (next) =>
      queryClient.setQueryData(healthConsentStatusQueryOptions(userId).queryKey, next),
  });

  const onContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      if (consentNeeded && version) {
        try {
          await accept.mutateAsync(version);
        } catch {
          setAgreed(false);
          void queryClient.invalidateQueries({
            queryKey: healthConsentStatusQueryOptions(userId).queryKey,
          });
          setError(COPY.consentFailed);
          return;
        }
      }
      if (JSON.stringify(eligibility) !== JSON.stringify(snapshot.eligibility)) {
        try {
          await update.mutateAsync({
            expectedRevision: snapshot.revision,
            eligibility,
            ...(snapshot.setupStatus === null ? { setupStatus: "in_progress" as const } : {}),
          });
        } catch (e) {
          const described = describeProfileSaveError(e);
          if (described.kind === "conflict") await reload();
          setError(described.message);
          return;
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      titleId={titleId}
      progress={progress}
      title={<Trans>Before you start</Trans>}
      description={
        <Trans>
          A quick check, then you're in. OpenValens is for personal record-keeping and general
          wellness.
        </Trans>
      }
      continueDisabled={eligibility.state === "unknown" || (consentNeeded && !agreed)}
      busy={busy}
      onContinue={() => void onContinue()}
      error={error ? i18n._(error) : undefined}
    >
      <div className="grid gap-6">
        <AgeBody value={eligibility} onChange={setEligibility} />
        {consentNeeded && version ? (
          <ConsentBody
            currentVersion={version}
            privacyUrl={consent?.privacyUrl ?? null}
            checked={agreed}
            onCheckedChange={setAgreed}
          />
        ) : null}
      </div>
    </StepFrame>
  );
}
