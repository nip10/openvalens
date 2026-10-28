import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";

import MagicLinkForm from "@/components/magic-link-form";
import { admissionStatusQueryOptions } from "@/utils/admission";
import { OIDC_ERROR_MARKER, signInOptionsQueryOptions } from "@/utils/sign-in-options";
import { validateReturnUrl } from "@/utils/return-url";
import { signUpOptionsQueryOptions } from "@/utils/sign-up";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    error: z.string().optional(),
    returnUrl: z.string().optional(),
    via: z.string().optional(),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { error, returnUrl, via } = Route.useSearch();
  const status = useQuery(admissionStatusQueryOptions());
  const signInOptions = useQuery(signInOptionsQueryOptions());
  // Issue #294 — "Create account" only when the server is OpenValens Cloud.
  const signUpOptions = useQuery(signUpOptionsQueryOptions());
  const oidcFlow = via === OIDC_ERROR_MARKER;
  const safeReturnUrl = validateReturnUrl(returnUrl) ?? null;

  return (
    <MagicLinkForm
      linkError={error !== undefined && !oidcFlow}
      oidc={signInOptions.data?.oidc ?? null}
      oidcError={oidcFlow ? (error ?? "") : null}
      setupAvailable={status.data?.setupAvailable}
      signUpAvailable={signUpOptions.data?.signUp === true}
      returnUrl={safeReturnUrl}
    />
  );
}
