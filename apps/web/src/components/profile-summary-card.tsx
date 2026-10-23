import { Trans } from "@lingui/react/macro";
import {
  describeAnswer,
  WELLNESS_FIELD_COPY,
  WELLNESS_PROFILE_FIELDS,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Link } from "@tanstack/react-router";

import { useWellnessProfile } from "@/utils/wellness-profile";

/** Issue #98 — read-only profile overview in Settings with a link to edit. */
export function ProfileSummarySection() {
  const profile = useWellnessProfile();
  if (profile.isPending) return <Skeleton className="h-40 w-full" />;
  if (profile.isError || !profile.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Profile</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Could not load your profile.</Trans>{" "}
            <button className="underline" onClick={() => void profile.refetch()}>
              <Trans>Retry</Trans>
            </button>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return <ProfileSummaryCard snapshot={profile.data} />;
}

export function ProfileSummaryCard({ snapshot }: { snapshot: WellnessProfileSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Profile</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Optional answers only you can see.</Trans>{" "}
          <Link to="/profile" className="underline">
            <Trans>Edit profile</Trans>
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProfileSummaryList snapshot={snapshot} />
      </CardContent>
    </Card>
  );
}

export function ProfileSummaryList({ snapshot }: { snapshot: WellnessProfileSnapshot }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {WELLNESS_PROFILE_FIELDS.map((field) => (
        <div key={field} className="contents">
          <dt className="text-muted-foreground">{WELLNESS_FIELD_COPY[field].title}</dt>
          <dd>{describeAnswer(field, snapshot[field])}</dd>
        </div>
      ))}
    </dl>
  );
}
