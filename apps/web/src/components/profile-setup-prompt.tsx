import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  describeProfileSaveError,
  nextSetupSection,
  SECTION_TITLES,
  setupProgress,
  shouldOfferSetup,
} from "@openvalens/api/presenters/wellness-profile";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { ArrowRight, Sprout } from "lucide-react";

import { Ring, ToneIcon } from "@/components/page";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

/**
 * Issue #98 — optional setup prompt on the dashboard. Shown only while setup
 * was never opened or left part-way; "Not now" records a skip. The rest of the
 * dashboard never waits on it, and a load failure simply hides it.
 */
export function ProfileSetupPrompt() {
  const profile = useWellnessProfile();
  if (!profile.data) return null;
  return <ProfileSetupPromptCard snapshot={profile.data} userId={profile.userId} />;
}

export function ProfileSetupPromptCard({
  snapshot,
  userId,
}: {
  snapshot: WellnessProfileSnapshot;
  userId: string;
}) {
  const update = useUpdateWellnessProfile(userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const { t, i18n } = useLingui();
  if (!shouldOfferSetup(snapshot)) return null;

  const progress = setupProgress(snapshot);
  const next = nextSetupSection(snapshot);
  const started = snapshot.setupStatus === "in_progress";

  return (
    <section
      aria-labelledby="profile-setup-title"
      className="sheet grid gap-5 bg-[linear-gradient(120deg,var(--sidebar-accent),transparent_70%)] p-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-x-6"
    >
      {started && progress.available > 0 ? (
        <Ring value={progress.answered / progress.available} tone="signal" size={64}>
          <span className="num">
            {progress.answered}/{progress.available}
          </span>
        </Ring>
      ) : (
        <ToneIcon icon={Sprout} tone="signal" size="lg" />
      )}
      <div className="grid min-w-0 gap-1.5">
        <h2 id="profile-setup-title" className="text-xl leading-tight text-ink">
          {started ? t`Continue setting up (optional)` : t`Set up your profile (optional)`}
        </h2>
        <p className="max-w-[60ch] text-sm text-ink-2">
          <Trans>
            A few optional questions so the app can show what matters to you. Skip any of them;
            everything else works without them.
          </Trans>
          {started ? (
            <>
              {" "}
              <Trans>
                {progress.answered} of {progress.available} sections answered.
              </Trans>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          asChild
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Link to="/profile" search={{ section: next ?? undefined }}>
            {started && next ? t`Continue: ${i18n._(SECTION_TITLES[next])}` : t`Start`}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          disabled={update.isPending}
          onClick={() => {
            setError(null);
            update.mutate(
              { expectedRevision: snapshot.revision, setupStatus: "skipped" },
              { onError: (e) => setError(describeProfileSaveError(e).message) },
            );
          }}
        >
          <Trans>Not now</Trans>
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
