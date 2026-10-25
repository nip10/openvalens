import { Trans } from "@lingui/react/macro";
import {
  describeAnswer,
  WELLNESS_FIELD_COPY,
  WELLNESS_PROFILE_FIELDS,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Button } from "@openvalens/ui/components/button";
import { Link } from "@tanstack/react-router";

import { ErrorState, Section } from "@/components/page";
import { useWellnessProfile } from "@/utils/wellness-profile";

/** Issue #98 — read-only profile overview in Settings with a link to edit. */
export function ProfileSummarySection() {
  const profile = useWellnessProfile();
  if (profile.isPending) return <Skeleton className="h-40 w-full" />;
  if (profile.isError || !profile.data) {
    return (
      <Section title={<Trans>Profile</Trans>}>
        <ErrorState
          title={<Trans>Could not load your profile.</Trans>}
          action={
            <Button variant="outline" size="sm" onClick={() => void profile.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Section>
    );
  }
  return <ProfileSummaryCard snapshot={profile.data} />;
}

export function ProfileSummaryCard({ snapshot }: { snapshot: WellnessProfileSnapshot }) {
  return (
    <Section
      title={<Trans>Profile</Trans>}
      description={<Trans>Optional answers only you can see.</Trans>}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link to="/profile">
            <Trans>Edit profile</Trans>
          </Link>
        </Button>
      }
    >
      <ProfileSummaryList snapshot={snapshot} />
    </Section>
  );
}

export function ProfileSummaryList({ snapshot }: { snapshot: WellnessProfileSnapshot }) {
  return (
    <dl className="grid border-t border-rule text-sm">
      {WELLNESS_PROFILE_FIELDS.map((field) => (
        <div
          key={field}
          className="grid gap-x-6 gap-y-0.5 border-b border-rule py-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
        >
          <dt className="text-ink-3">{WELLNESS_FIELD_COPY[field].title}</dt>
          <dd className="m-0 text-ink">{describeAnswer(field, snapshot[field])}</dd>
        </div>
      ))}
    </dl>
  );
}
