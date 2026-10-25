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
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-4 pt-16 pb-16">
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
        <p className="mx-auto w-full max-w-md px-2 text-center text-sm text-ink-3">
          <Trans>
            To sign in with {oidc.displayName} later, finish joining, sign in with the email link,
            then choose Connect under Settings → Sign-in methods.
          </Trans>
        </p>
      ) : null}
    </main>
  );
}
