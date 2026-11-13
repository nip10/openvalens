import { Trans } from "@lingui/react/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ENV } from "@/env";
import { authClient } from "@/lib/auth-client";
import { authorizeParamsFrom, authorizeUrl, saveResume, takeResume } from "@/utils/oauth-flow";

/**
 * Issue #439 (M1b) — Better Auth's OAuth login page. An AI app's authorization
 * arrives here when the member is signed out: the request waits in local
 * storage, the member signs in (`/login`, any method), and lands back here,
 * which hands the request back to the server's authorize endpoint. The server
 * then shows the consent screen; nothing is approved on this page.
 */
export const Route = createFileRoute("/oauth/login")({
  beforeLoad: async () => {
    const fromQuery = authorizeParamsFrom(window.location.search);
    let signedIn = false;
    try {
      signedIn = Boolean((await authClient.getSession()).data?.session.activeOrganizationId);
    } catch {
      signedIn = false;
    }
    if (!signedIn) {
      if (fromQuery) saveResume(fromQuery);
      throw redirect({ to: "/login", search: { returnUrl: "/oauth/login" } });
    }
    const resume = fromQuery ?? takeResume();
    if (resume) {
      window.location.replace(authorizeUrl(ENV.VITE_SERVER_URL, resume));
      return;
    }
  },
  component: OAuthLoginPage,
});

function OAuthLoginPage() {
  return (
    <main className="mx-auto grid w-full max-w-md gap-3 px-4 pt-16 pb-16 text-center">
      <h1 className="text-2xl">
        <Trans>Connecting an AI app</Trans>
      </h1>
      <p className="text-ink-2">
        <Trans>
          If nothing happens, this sign-in request has expired. Start connecting again from the app.
        </Trans>
      </p>
    </main>
  );
}
