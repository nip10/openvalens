import { useLingui } from "@lingui/react/macro";
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
    <main className="container mx-auto max-w-3xl px-4 py-6">
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
