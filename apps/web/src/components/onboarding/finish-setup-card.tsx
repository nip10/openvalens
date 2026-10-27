import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { describeProfileSaveError } from "@openvalens/api/presenters/wellness-profile";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Sprout } from "lucide-react";
import { useState } from "react";

import { Meter, ToneIcon } from "@/components/page";
import {
  onboardingProgress,
  shouldShowFinishSetup,
  type OnboardingExtras,
} from "@/utils/onboarding";
import { useOnboardingExtras } from "@/utils/onboarding-data";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Onboarding stage 2 — "Finish setting up, N of 8" on the dashboard, until
 * the flow is completed or dismissed. Replaces the older profile setup
 * prompt (one prompt, not two). "Dismiss" records `setupStatus: skipped`.
 */
export function FinishSetupCard() {
  const profile = useWellnessProfile();
  const show = shouldShowFinishSetup(profile.data);
  const extras = useOnboardingExtras(show);
  const update = useUpdateWellnessProfile(profile.userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  if (!profile.data || !show) return null;
  const snapshot = profile.data;
  return (
    <FinishSetupCardView
      snapshot={snapshot}
      extras={extras}
      dismissing={update.isPending}
      error={error}
      onDismiss={() => {
        setError(null);
        update.mutate(
          { expectedRevision: snapshot.revision, setupStatus: "skipped" },
          {
            onError: (e) => {
              const described = describeProfileSaveError(e);
              if (described.kind === "conflict") void profile.refetch();
              setError(described.message);
            },
          },
        );
      }}
    />
  );
}

export function FinishSetupCardView({
  snapshot,
  extras,
  dismissing,
  error,
  onDismiss,
}: {
  snapshot: Pick<
    WellnessProfileSnapshot,
    | "setupStatus"
    | "eligibility"
    | "enabledModules"
    | "inputMethod"
    | "region"
    | "birthYear"
    | "sex"
  >;
  extras: OnboardingExtras;
  dismissing: boolean;
  error: MessageDescriptor | null;
  onDismiss: () => void;
}) {
  const { t, i18n } = useLingui();
  if (!shouldShowFinishSetup(snapshot)) return null;
  const { done, total } = onboardingProgress(snapshot, extras);
  return (
    <section
      aria-labelledby="finish-setup-title"
      className="sheet grid gap-5 bg-[linear-gradient(120deg,var(--sidebar-accent),transparent_70%)] p-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-x-6"
    >
      <ToneIcon icon={Sprout} tone="signal" size="lg" />
      <div className="grid min-w-0 gap-2">
        <h2 id="finish-setup-title" className="text-xl leading-tight text-ink">
          <Trans>
            Finish setting up, {done} of {total}
          </Trans>
        </h2>
        <Meter
          value={done / total}
          tone="signal"
          label={t`${done} of ${total} setup steps done`}
          className="max-w-sm"
        />
        <p className="max-w-[60ch] text-sm text-ink-2">
          <Trans>Pick your modules and a few basics. Skip anything you like.</Trans>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link to="/welcome">
            <Trans>Continue</Trans>
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button variant="ghost" disabled={dismissing} onClick={onDismiss}>
          <Trans>Dismiss</Trans>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive md:col-span-3">
          {i18n._(error)}
        </p>
      ) : null}
    </section>
  );
}
