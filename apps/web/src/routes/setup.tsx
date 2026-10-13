import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import ConnectedAdmissionForm from "@/components/admission-form-connected";
import { admissionStatusQueryOptions } from "@/utils/admission";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const status = useQuery(admissionStatusQueryOptions());

  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <ConnectedAdmissionForm
        kind="setup"
        title="Instance setup"
        description="Enter the setup token from your operator and your email to become the first instance administrator."
        tokenLabel="Setup token"
        tokenHelp="Paste the token your operator provided"
        setupAvailable={status.data?.setupAvailable}
        closedCopy={{
          headline: "Setup is complete",
          body: "This instance has already been set up. If you have an account, sign in below.",
        }}
      />
    </main>
  );
}
