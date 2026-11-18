import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { accessStateQueryOptions } from "@/components/access-banner";
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
import { cn } from "@openvalens/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Sprout } from "lucide-react";
import { useId, useState } from "react";
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
  const access = useQuery(accessStateQueryOptions());
  const { i18n } = useLingui();
  const profile = useWellnessProfile();
  const maybe = !!profile.data && profile.data.setupStatus !== "skipped";
  const facts = useOnboardingFacts(maybe);
  const update = useUpdateWellnessProfile(profile.userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  if (!profile.data || !maybe || access.data?.demo) return null;
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
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!shouldShowSetupCard(snapshot, facts)) return null;
  const { done, total } = setupProgress(snapshot, facts);
  const next = SETUP_ITEMS.find((item) => !isSetupItemDone(item, snapshot, facts));
  // One row (#dashboard-5): the count, the next step and a way to see them all.
  return (
    <section aria-labelledby="finish-setup-title" className="sheet grid gap-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ToneIcon icon={Sprout} tone="signal" size="sm" />
        <h2
          id="finish-setup-title"
          className="font-body text-base leading-tight font-semibold text-ink"
        >
          <Trans>
            Finish setting up, {done} of {total}
          </Trans>
        </h2>
        <Meter
          value={done / total}
          tone="signal"
          label={t`${done} of ${total} setup steps done`}
          className="hidden w-24 sm:block"
        />
        {next ? (
          <Link
            to="/setup/$item"
            params={{ item: next }}
            className="inline-flex min-h-9 items-center gap-0.5 rounded-full px-1 text-sm font-medium text-ink no-underline hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {i18n._(SETUP_ITEM_COPY[next].title)}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <Trans>Hide steps</Trans> : <Trans>All steps</Trans>}
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-[var(--dur-short)] motion-reduce:transition-none",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-ink-3"
            disabled={dismissing}
            onClick={onDismiss}
          >
            <Trans>Dismiss</Trans>
          </Button>
        </div>
      </div>
      <ul
        id={listId}
        hidden={!open}
        className="grid gap-1 pb-1 sm:grid-cols-2"
        aria-label={t`Setup steps`}
      >
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
