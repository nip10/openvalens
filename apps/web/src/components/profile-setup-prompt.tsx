import {
  describeProfileSaveError,
  nextSetupSection,
  SECTION_TITLES,
  setupProgress,
  shouldOfferSetup,
} from "@openvalens/api/presenters/wellness-profile";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  if (!shouldOfferSetup(snapshot)) return null;

  const progress = setupProgress(snapshot);
  const next = nextSetupSection(snapshot);
  const started = snapshot.setupStatus === "in_progress";

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          {started ? "Continue setting up (optional)" : "Set up your profile (optional)"}
        </CardTitle>
        <CardDescription>
          A few optional questions so the app can show what matters to you. Skip any of them —
          everything else works without them.
          {started ? ` ${progress.answered} of ${progress.available} sections answered.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Link to="/profile" search={{ section: next ?? undefined }}>
          <Button>{started && next ? `Continue: ${SECTION_TITLES[next]}` : "Start"}</Button>
        </Link>
        <Button
          variant="outline"
          disabled={update.isPending}
          onClick={() => {
            setError(null);
            update.mutate(
              { expectedRevision: snapshot.revision, setupStatus: "skipped" },
              { onError: (e) => setError(describeProfileSaveError(e).message) },
            );
          }}
        >
          Not now
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
