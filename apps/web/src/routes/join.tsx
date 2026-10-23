import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import ConnectedAdmissionForm from "@/components/admission-form-connected";
import { signInOptionsQueryOptions } from "@/utils/sign-in-options";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

function JoinPage() {
  const signInOptions = useQuery(signInOptionsQueryOptions());
  const oidc = signInOptions.data?.oidc ?? null;
  const { t } = useLingui();

  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <ConnectedAdmissionForm
        kind="invitation"
        title={t`Join OpenValens`}
        description={t`Paste the invitation token you received to create your account.`}
        tokenLabel={t`Invitation token`}
        tokenHelp={t`Paste the invitation token from your email`}
      />
      {oidc ? (
        // Issue #65 — an invitation is redeemed with the emailed token and
        // code; the IdP identity is bound afterwards, explicitly, by the
        // signed-in user.
        <p className="mx-auto mt-4 max-w-md text-center text-sm text-muted-foreground">
          <Trans>
            To sign in with {oidc.displayName} later, finish joining, sign in with the email link,
            then choose Connect under Settings → Sign-in methods.
          </Trans>
        </p>
      ) : null}
    </main>
  );
}
