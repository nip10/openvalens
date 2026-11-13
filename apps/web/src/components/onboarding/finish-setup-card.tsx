import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  canRestoreSetupCard,
  isSetupItemDone,
  SETUP_ITEM_COPY,
  SETUP_ITEMS,
  setupProgress,
  shouldShowSetupCard,
  type OnboardingFacts,
  type OnboardingProfile,
} from "@openvalens/api/presenters/onboarding";
import { describeProfileSaveError } from "@openvalens/api/presenters/wellness-profile";
import { Button } from "@openvalens/ui/components/button";
import { Sprout } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SetupItemLink } from "@/components/onboarding/onboarding-steps";
import { Meter, ToneIcon } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { useOnboardingFacts } from "@/utils/onboarding-data";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Onboarding (#444) — "Finish setting up" on Today: everything the first run
 * left out (the first log and connect if skipped, modules, basics, one goal,
 * privacy), each opening its own screen. Shows until every item has an answer
 * or it is dismissed (`setupStatus: skipped`); Settings brings it back.
 */
const COPY = {
  dismissed: msg`Hidden. Bring it back any time in Settings › Profile.`,
};

export function FinishSetupCard() {
  const { i18n } = useLingui();
  const profile = useWellnessProfile();
  const maybe = !!profile.data && profile.data.setupStatus !== "skipped";
  const facts = useOnboardingFacts(maybe);
  const update = useUpdateWellnessProfile(profile.userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  if (!profile.data || !maybe) return null;
  const snapshot = profile.data;
  return (
    <FinishSetupCardView
      snapshot={snapshot}
      facts={facts}
      dismissing={update.isPending}
      error={error}
      onDismiss={() => {
        setError(null);
        update.mutate(
          { expectedRevision: snapshot.revision, setupStatus: "skipped" },
          {
            onSuccess: () => toast(i18n._(COPY.dismissed)),
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
  facts,
  dismissing,
  error,
  onDismiss,
}: {
  snapshot: OnboardingProfile;
  facts: OnboardingFacts;
  dismissing: boolean;
  error: MessageDescriptor | null;
  onDismiss: () => void;
}) {
  const { t, i18n } = useLingui();
  if (!shouldShowSetupCard(snapshot, facts)) return null;
  const { done, total } = setupProgress(snapshot, facts);
  return (
    <section
      aria-labelledby="finish-setup-title"
      className="sheet grid gap-5 bg-[linear-gradient(120deg,var(--sidebar-accent),transparent_70%)] p-6"
    >
      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-x-6">
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
            <Trans>Each one takes a minute. Skip anything you like.</Trans>
          </p>
        </div>
        <Button
          variant="ghost"
          className="justify-self-start"
          disabled={dismissing}
          onClick={onDismiss}
        >
          <Trans>Dismiss</Trans>
        </Button>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2" aria-label={t`Setup steps`}>
        {SETUP_ITEMS.map((item) => (
          <li key={item}>
            <SetupItemLink
              item={item}
              title={i18n._(SETUP_ITEM_COPY[item].title)}
              description={i18n._(SETUP_ITEM_COPY[item].description)}
              done={isSetupItemDone(item, snapshot, facts)}
            />
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {i18n._(error)}
        </p>
      ) : null}
    </section>
  );
}

/** Settings: bring back a dismissed "Finish setting up" card (#444). */
export function SetupCardSetting() {
  const { i18n } = useLingui();
  const profile = useWellnessProfile();
  const update = useUpdateWellnessProfile(profile.userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  if (!profile.data || !canRestoreSetupCard(profile.data)) return null;
  const snapshot = profile.data;
  return (
    <SettingsGroup>
      <SettingsRow
        icon={Sprout}
        label={<Trans>Finish setting up</Trans>}
        description={
          error ? (
            <span role="alert" className="text-destructive">
              {i18n._(error)}
            </span>
          ) : (
            <Trans>The card on Today with the setup steps you skipped.</Trans>
          )
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={update.isPending}
          onClick={() => {
            setError(null);
            update.mutate(
              { expectedRevision: snapshot.revision, setupStatus: "completed" },
              {
                onError: (e) => {
                  const described = describeProfileSaveError(e);
                  if (described.kind === "conflict") void profile.refetch();
                  setError(described.message);
                },
              },
            );
          }}
        >
          <Trans>Show on Today</Trans>
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}
