import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileCheck2, ShieldCheck } from "lucide-react";

import { Section } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { client } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";
const STATUS_KEY = ["healthConsent", "status"] as const;

const LINK = "font-medium text-ink underline decoration-signal underline-offset-2";

/**
 * Settings › Privacy & data: whether you agreed to the health data terms,
 * said in plain words (#settings-8), with the way out (export, then delete).
 * Version identifiers stay behind the ⓘ.
 */
export function HealthDataConsentStatus() {
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const { i18n } = useLingui();
  const status = useQuery({
    queryKey: [...STATUS_KEY, userId],
    queryFn: () => client.healthConsent.status({}),
    enabled: !!userId && !session.isPending,
    staleTime: 60_000,
  });
  const agreedOn = status.data?.acceptedAt
    ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" }).format(
        new Date(status.data.acceptedAt),
      )
    : null;

  return (
    <Section
      title={<Trans>Health data consent</Trans>}
      icon={ShieldCheck}
      tone="signal"
      info={
        status.data?.required && status.data.currentVersion ? (
          <Trans>Terms version {status.data.currentVersion}.</Trans>
        ) : undefined
      }
    >
      <SettingsGroup>
        {status.isPending ? (
          <p className="py-4 text-sm text-ink-3">
            <Trans>Loading consent status…</Trans>
          </p>
        ) : status.isError ? (
          <p className="py-4 text-sm text-ink-3">
            <Trans>Could not load health data consent status.</Trans>
          </p>
        ) : (
          <>
            <SettingsRow
              icon={FileCheck2}
              label={
                !status.data.required ? (
                  <Trans>Consent is not required on this server.</Trans>
                ) : status.data.accepted ? (
                  agreedOn ? (
                    <Trans>You agreed to the current health data terms on {agreedOn}.</Trans>
                  ) : (
                    <Trans>You agreed to the current health data terms.</Trans>
                  )
                ) : (
                  <Trans>No health data consent is recorded.</Trans>
                )
              }
            />
            <div className="grid gap-2 py-4 text-sm text-ink-2">
              <p>
                <Trans>
                  If you no longer want OpenValens to process your health data, you can export your
                  records and delete your account.
                </Trans>
              </p>
              <div className="flex flex-wrap gap-4">
                <Link to="/exports" className={LINK}>
                  <Trans>Export records</Trans>
                </Link>
                <a href="#delete-account" className={LINK}>
                  <Trans>Delete account</Trans>
                </a>
              </div>
            </div>
          </>
        )}
      </SettingsGroup>
    </Section>
  );
}
