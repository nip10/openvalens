import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Section } from "@/components/page";
import { client } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";
const STATUS_KEY = ["healthConsent", "status"] as const;

export function HealthDataConsentStatus() {
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const status = useQuery({
    queryKey: [...STATUS_KEY, userId],
    queryFn: () => client.healthConsent.status({}),
    enabled: !!userId && !session.isPending,
    staleTime: 60_000,
  });

  return (
    <Section title={<Trans>Health data consent</Trans>}>
      {status.isPending ? (
        <p className="text-sm text-ink-3">
          <Trans>Loading consent status…</Trans>
        </p>
      ) : status.isError ? (
        <p className="text-sm text-ink-3">
          <Trans>Could not load health data consent status.</Trans>
        </p>
      ) : (
        <div className="grid gap-3 text-sm text-ink-2">
          <p>
            {!status.data.required ? (
              <Trans>Consent is not required on this server.</Trans>
            ) : status.data.accepted ? (
              <Trans>Consent recorded for version {status.data.acceptedVersion}.</Trans>
            ) : (
              <Trans>No health data consent is recorded.</Trans>
            )}
            {status.data.acceptedAt ? (
              <>
                {" "}
                <Trans>Recorded on {new Date(status.data.acceptedAt).toLocaleDateString()}.</Trans>
              </>
            ) : null}
            {status.data.required && status.data.currentVersion ? (
              <>
                {" "}
                <Trans>Current version: {status.data.currentVersion}.</Trans>
              </>
            ) : null}
          </p>
          <p>
            <Trans>
              If you no longer want OpenValens to process your health data, you can export your
              records and delete your account.
            </Trans>
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/exports"
              className="font-medium text-ink underline decoration-signal underline-offset-2"
            >
              <Trans>Export records</Trans>
            </Link>
            <a
              href="#delete-account"
              className="font-medium text-ink underline decoration-signal underline-offset-2"
            >
              <Trans>Delete account</Trans>
            </a>
          </div>
        </div>
      )}
    </Section>
  );
}
