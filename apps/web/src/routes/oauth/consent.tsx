import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OAuthConsentView } from "@/components/oauth-consent-view";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

/**
 * Issue #439 (M1b) — Better Auth's OAuth consent page for connecting an AI
 * app. The signed authorization request is the page's whole query string; it
 * is checked on the server (signature, expiry, issued for this session) before
 * anything is shown, and sent back unchanged with the member's decision.
 * Framing is refused by the web document's own headers
 * (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).
 */
export const Route = createFileRoute("/oauth/consent")({
  beforeLoad: async () => {
    let signedIn = false;
    try {
      signedIn = Boolean((await authClient.getSession()).data?.session);
    } catch {
      signedIn = false;
    }
    // Signed out (or the session ended): sign in, then the request resumes.
    if (!signedIn) throw redirect({ href: `/oauth/login${window.location.search}` });
  },
  component: OAuthConsentPage,
});

function OAuthConsentPage() {
  const { t } = useLingui();
  const [oauthQuery] = useState(() => window.location.search.replace(/^\?/, ""));
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);

  const request = useQuery({
    queryKey: ["aiApps", "oauth", "describe", oauthQuery],
    queryFn: () => client.aiApps.oauth.describe({ oauthQuery }),
    retry: false,
    staleTime: Infinity,
    enabled: oauthQuery.length > 0,
  });

  // Default to the active workspace when it can be connected, else the first
  // one that can.
  useEffect(() => {
    if (!request.data || organizationId) return;
    const allowed = request.data.workspaces.filter((workspace) => workspace.allowed);
    const active = allowed.find(
      (workspace) => workspace.organizationId === request.data.activeOrganizationId,
    );
    setOrganizationId((active ?? allowed[0])?.organizationId ?? null);
  }, [request.data, organizationId]);

  const decide = useMutation({
    mutationFn: async (decision: "approve" | "deny") =>
      decision === "approve"
        ? client.aiApps.oauth.approve({
            oauthQuery,
            organizationId: organizationId ?? "",
            scopes: selectedScopes,
            consentVersion: request.data?.consentVersion ?? "",
          })
        : client.aiApps.oauth.deny({ oauthQuery }),
    onSuccess: ({ redirectUrl }) => {
      window.location.assign(redirectUrl);
    },
    onError: (error) => {
      toast.error(error.message || t`The app could not be connected. Try again from the app.`);
    },
  });

  return (
    <main className="mx-auto grid w-full max-w-xl gap-5 px-4 pt-16 pb-16">
      <div className="sheet p-6 sm:p-8">
        <OAuthConsentView
          status={
            oauthQuery.length === 0 || request.isError
              ? "error"
              : request.isPending
                ? "pending"
                : "ready"
          }
          request={request.data ?? null}
          errorMessage={request.error?.message ?? null}
          organizationId={organizationId}
          onOrganizationChange={setOrganizationId}
          selectedScopes={selectedScopes}
          onScopeChange={(scope, selected) =>
            setSelectedScopes((current) =>
              selected ? [...new Set([...current, scope])] : current.filter((s) => s !== scope),
            )
          }
          agreed={agreed}
          onAgreedChange={setAgreed}
          isSubmitting={decide.isPending || decide.isSuccess}
          onApprove={() => decide.mutate("approve")}
          onDeny={() => decide.mutate("deny")}
        />
      </div>
    </main>
  );
}
