import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import z from "zod";

import SignUpForm from "@/components/sign-up-form";
import { orpc } from "@/utils/orpc";
import { isSocialProvider, signInOptionsQueryOptions } from "@/utils/sign-in-options";
import { SIGN_UP_LINK_ERRORS, signUpOptionsQueryOptions } from "@/utils/sign-up";

/**
 * Issue #294 — public sign-up, OpenValens Cloud only. The server says whether
 * sign-up exists (`signUp.options`); on a self-hosted instance this route is a
 * not-found page, like any other unknown path.
 */
export const Route = createFileRoute("/signup")({
  validateSearch: z.object({
    // A sign-up link reason, or (with `via`) a Google / Apple error code.
    error: z.string().max(64).optional().catch(undefined),
    via: z.string().max(16).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    const options = await context.queryClient.ensureQueryData(signUpOptionsQueryOptions());
    if (!options.signUp || !options.terms || !options.privacy) throw notFound();
  },
  component: SignUpPage,
});

function SignUpPage() {
  const { error, via } = Route.useSearch();
  const { i18n } = useLingui();
  const options = useQuery(signUpOptionsQueryOptions());
  // Issue #296 — "Continue with Google / Apple" when the server has them.
  const signInOptions = useQuery(signInOptionsQueryOptions());
  const terms = options.data?.terms;
  const privacy = options.data?.privacy;
  if (!terms || !privacy) return null;
  const socialFlow = isSocialProvider(via) ? via : null;
  const linkError = !socialFlow
    ? (SIGN_UP_LINK_ERRORS.find((reason) => reason === error) ?? null)
    : null;
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";

  return (
    <SignUpForm
      terms={terms}
      privacy={privacy}
      linkError={linkError}
      google={signInOptions.data?.google === true}
      apple={signInOptions.data?.apple === true}
      socialError={socialFlow ? { provider: socialFlow, code: error ?? "" } : null}
      locale={locale}
      onSubmit={async (email) => {
        // The emails are written in the language this page is shown in, which
        // also becomes the new account's language.
        await orpc.signUp.request.call({ email, acceptedLegal: true, locale });
      }}
    />
  );
}
