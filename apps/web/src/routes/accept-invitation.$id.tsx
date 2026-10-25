import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { AcceptInvitationView } from "@/components/accept-invitation-view";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/accept-invitation/$id")({
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { id: invitationId } = Route.useParams();
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? null;
  const sessionEmail = session.data?.user?.email?.toLowerCase() ?? null;
  const { t } = useLingui();

  // Refetch session when the user returns from a sign-in link opened in
  // another tab, so this page can immediately show the accept/decline UI.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        void session.refetch();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [session]);

  const summary = useQuery({
    queryKey: ["invitation", "summary", invitationId, userId],
    queryFn: async () => {
      const result = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (result.error) throw result.error;
      return result.data ?? null;
    },
    enabled: !!session.data,
    retry: 1,
  });

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 pt-16 pb-16">
      <AcceptInvitationView
        invitationId={invitationId}
        userId={userId}
        sessionEmail={sessionEmail}
        summary={summary.data ?? null}
        summaryError={summary.error ? t`Could not load invitation.` : null}
        summaryLoading={summary.isPending}
        onRetry={() => {
          void session.refetch();
          void summary.refetch();
        }}
      />
    </main>
  );
}
