import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { client } from "@/utils/orpc";
import { authClient } from "@/lib/auth-client";
import { needsHealthConsent } from "@/utils/health-consent";

const STATUS_KEY = ["healthConsent", "status"] as const;

const linkClass = "font-medium text-ink underline decoration-signal underline-offset-2";

export function HealthDataConsentPrompt() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const statusKey = [...STATUS_KEY, userId] as const;
  const [checked, setChecked] = useState(false);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => client.healthConsent.status({}),
    enabled: !!userId && !session.isPending,
    staleTime: 60_000,
  });
  const accept = useMutation({
    mutationFn: (version: string) =>
      client.healthConsent.accept({ acceptedHealthDataConsent: true, version }),
    onSuccess: (next) => {
      queryClient.setQueryData(statusKey, next);
      setChecked(false);
    },
    onError: () => {
      setChecked(false);
      void queryClient.invalidateQueries({ queryKey: statusKey });
    },
  });
  useEffect(() => setChecked(false), [status.data?.currentVersion]);

  if (status.isError) {
    return (
      <section
        role="alert"
        className="mx-auto my-4 flex w-full max-w-5xl flex-wrap items-center gap-3 rounded-3xl border border-rule bg-card p-4"
      >
        <p className="flex-1 text-sm text-ink-2">
          <Trans>Could not check health data consent.</Trans>
        </p>
        <Button variant="outline" onClick={() => void status.refetch()}>
          <Trans>Try again</Trans>
        </Button>
        <Link to="/exports" className={linkClass}>
          <Trans>Export records</Trans>
        </Link>
        <a href="/settings#delete-account" className={linkClass}>
          <Trans>Delete account</Trans>
        </a>
      </section>
    );
  }
  if (!status.data || !needsHealthConsent(status.data)) return null;
  const currentVersion = status.data.currentVersion;
  if (!currentVersion) return null;

  return (
    <section
      aria-labelledby="health-consent-title"
      className="mx-auto my-4 grid w-full max-w-5xl gap-3 rounded-3xl border border-signal/30 bg-signal-soft/40 p-4 sm:p-5"
    >
      <div className="grid gap-1">
        <h2 id="health-consent-title" className="font-display text-lg font-semibold text-ink">
          <Trans>Health data consent</Trans>
        </h2>
        <p className="text-sm text-ink-2">
          <Trans>I consent to OpenValens processing my health data to provide the service.</Trans>{" "}
          {status.data.privacyUrl ? (
            <a className={linkClass} href={status.data.privacyUrl} target="_blank" rel="noreferrer">
              <Trans>Read the privacy policy</Trans>
            </a>
          ) : null}
        </p>
        <p className="text-xs text-ink-3">
          <Trans>Consent version: {currentVersion}</Trans>
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>
          <Trans>I agree to this health data processing.</Trans>
        </span>
      </label>
      {accept.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>
            Consent could not be saved. The version may have changed; review it and try again.
          </Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!checked || accept.isPending}
          onClick={() => accept.mutate(currentVersion)}
        >
          {accept.isPending ? t`Saving…` : t`I consent`}
        </Button>
        <Link to="/exports" className={linkClass}>
          <Trans>Export records</Trans>
        </Link>
        <Link to="/settings" hash="delete-account" className={linkClass}>
          <Trans>Delete account</Trans>
        </Link>
      </div>
    </section>
  );
}
