import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import z from "zod";

import SignUpForm from "@/components/sign-up-form";
import { orpc } from "@/utils/orpc";
import { SIGN_UP_LINK_ERRORS, signUpOptionsQueryOptions } from "@/utils/sign-up";

/**
 * Issue #294 — public sign-up, OpenValens Cloud only. The server says whether
 * sign-up exists (`signUp.options`); on a self-hosted instance this route is a
 * not-found page, like any other unknown path.
 */
export const Route = createFileRoute("/signup")({
  validateSearch: z.object({
    error: z.enum(SIGN_UP_LINK_ERRORS).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    const options = await context.queryClient.ensureQueryData(signUpOptionsQueryOptions());
    if (!options.signUp || !options.terms || !options.privacy) throw notFound();
  },
  component: SignUpPage,
});

function SignUpPage() {
  const { error } = Route.useSearch();
  const { i18n } = useLingui();
  const options = useQuery(signUpOptionsQueryOptions());
  const terms = options.data?.terms;
  const privacy = options.data?.privacy;
  if (!terms || !privacy) return null;

  return (
    <SignUpForm
      terms={terms}
      privacy={privacy}
      linkError={error ?? null}
      onSubmit={async (email) => {
        // The emails are written in the language this page is shown in, which
        // also becomes the new account's language.
        const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
        await orpc.signUp.request.call({ email, acceptedLegal: true, locale });
      }}
    />
  );
}
