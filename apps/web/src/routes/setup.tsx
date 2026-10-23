import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import ConnectedAdmissionForm from "@/components/admission-form-connected";
import { admissionStatusQueryOptions } from "@/utils/admission";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const status = useQuery(admissionStatusQueryOptions());
  const { t } = useLingui();

  return (
    <main className="container mx-auto grid max-w-3xl gap-4 px-4 py-6">
      {status.data?.setupAvailable && status.data.emailDeliveryAvailable === false ? (
        <p
          role="alert"
          className="mx-auto w-full max-w-md rounded-md border border-amber-500/50 p-3 text-sm"
        >
          <Trans>
            This server can't send email yet, so setup can't finish: the verification code is sent
            by email. Add a Resend key with <code>deploy/setup.sh install --reconfigure</code>, then
            reload this page.
          </Trans>
        </p>
      ) : null}
      <ConnectedAdmissionForm
        kind="setup"
        title={t`Instance setup`}
        description={t`Enter the setup token from your operator and your email to become the first instance administrator.`}
        tokenLabel={t`Setup token`}
        tokenHelp={t`Paste the token your operator provided`}
        setupAvailable={status.data?.setupAvailable}
        closedCopy={{
          headline: t`Setup is complete`,
          body: t`This instance has already been set up. If you have an account, sign in below.`,
        }}
      />
    </main>
  );
}
