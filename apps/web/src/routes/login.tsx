import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import z from "zod";

import MagicLinkForm from "@/components/magic-link-form";
import { authClient } from "@/lib/auth-client";
import { admissionStatusQueryOptions } from "@/utils/admission";
import {
  isSocialProvider,
  OIDC_ERROR_MARKER,
  signInOptionsQueryOptions,
} from "@/utils/sign-in-options";
import { validateReturnUrl } from "@/utils/return-url";
import { signUpOptionsQueryOptions } from "@/utils/sign-up";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    error: z.string().optional(),
    returnUrl: z.string().optional(),
    via: z.string().optional(),
  }),
  // Signed in already: the sign-in form would sit inside the signed-in app
  // shell. Only with an active workspace — a session whose workspace could not
  // be prepared is sent here by the _auth layout, and must stay to sign in again.
  beforeLoad: async ({ search }) => {
    let signedIn = false;
    try {
      signedIn = Boolean((await authClient.getSession()).data?.session.activeOrganizationId);
    } catch {
      return;
    }
    if (signedIn) throw redirect({ href: validateReturnUrl(search.returnUrl) ?? "/dashboard" });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { error, returnUrl, via } = Route.useSearch();
  const status = useQuery(admissionStatusQueryOptions());
  const signInOptions = useQuery(signInOptionsQueryOptions());
  // Issue #294 — "Create account" only when the server is OpenValens Cloud.
  const signUpOptions = useQuery(signUpOptionsQueryOptions());
  const oidcFlow = via === OIDC_ERROR_MARKER;
  // Issue #296 — a failed Google or Apple redirect comes back with `via`.
  const socialFlow = isSocialProvider(via) ? via : null;
  const safeReturnUrl = validateReturnUrl(returnUrl) ?? null;

  return (
    <MagicLinkForm
      linkError={error !== undefined && !oidcFlow && !socialFlow ? error : null}
      oidc={signInOptions.data?.oidc ?? null}
      oidcError={oidcFlow ? (error ?? "") : null}
      google={signInOptions.data?.google === true}
      apple={signInOptions.data?.apple === true}
      socialError={socialFlow ? { provider: socialFlow, code: error ?? "" } : null}
      setupAvailable={status.data?.setupAvailable}
      signUpAvailable={signUpOptions.data?.signUp === true}
      returnUrl={safeReturnUrl}
    />
  );
}
