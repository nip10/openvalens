import { createFileRoute } from "@tanstack/react-router";

import ConnectedAdmissionForm from "@/components/admission-form-connected";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

function JoinPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-6">
      <ConnectedAdmissionForm
        kind="invitation"
        title="Join OpenValens"
        description="Paste the invitation token you received to create your account."
        tokenLabel="Invitation token"
        tokenHelp="Paste the invitation token from your email"
      />
    </main>
  );
}
