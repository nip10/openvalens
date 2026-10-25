import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

import ConnectedAdmissionForm from "@/components/admission-form-connected";
import { admissionStatusQueryOptions } from "@/utils/admission";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const status = useQuery(admissionStatusQueryOptions());
  const { t } = useLingui();

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-5 px-4 pt-16 pb-16">
      {status.data?.setupAvailable && status.data.emailDeliveryAvailable === false ? (
        <p
          role="alert"
          className="mx-auto flex w-full max-w-md items-start gap-3 rounded-2xl bg-warning/12 px-4 py-3 text-sm text-ink"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <Trans>
              This server can't send email yet, so setup can't finish: the verification code is sent
              by email. Add a Resend key with <code>deploy/setup.sh install --reconfigure</code>,
              then reload this page.
            </Trans>
          </span>
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
