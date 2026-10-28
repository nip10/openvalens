import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { Mail, MailCheck } from "lucide-react";

import OidcSignInButton from "@/components/oidc-sign-in-button";
import { ErrorState, ToneIcon } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { validateReturnUrl } from "@/utils/return-url";
import { oidcSignInErrorMessage } from "@/utils/sign-in-options";

export type MagicLinkFormProps = {
  linkError?: boolean;
  setupAvailable?: boolean;
  /** Issue #294 — OpenValens Cloud: anyone may create an account at `/signup`. */
  signUpAvailable?: boolean;
  returnUrl?: string | null;
  /** Issue #65 — the configured OIDC provider, or `null` (no button). */
  oidc?: { providerId: string; displayName: string } | null;
  /** Issue #65 — error code from a failed OIDC redirect, or `null`. */
  oidcError?: string | null;
};

/**
 * Passwordless sign-in. Magic links only sign in existing accounts. New
 * accounts come from an invitation, the first setup, or — on OpenValens Cloud
 * only — the public `/signup` page (Issue #294).
 */
export default function MagicLinkForm({
  linkError,
  setupAvailable,
  signUpAvailable = false,
  returnUrl,
  oidc = null,
  oidcError = null,
}: MagicLinkFormProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { t, i18n } = useLingui();

  const callbackURL = (() => {
    const origin = window.location.origin;
    const safe = validateReturnUrl(returnUrl);
    return safe ? `${origin}${safe}` : `${origin}/dashboard`;
  })();

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      const origin = window.location.origin;
      try {
        const { error } = await authClient.signIn.magicLink({
          email,
          callbackURL,
          errorCallbackURL: `${origin}/login?error=link`,
        });
        if (error) toast.error(t`Could not send the sign-in link. Please try again.`);
        else setSentTo(email);
      } catch {
        toast.error(t`Could not send the sign-in link. Please try again.`);
      }
    },
    validators: {
      onSubmit: z.object({ email: z.email(t`Enter a valid email address`) }),
    },
  });

  if (sentTo) {
    return (
      <div className="mx-auto grid w-full max-w-md px-4 pt-16 pb-16">
        <div className="sheet grid justify-items-center gap-4 p-6 text-center sm:p-8">
          <ToneIcon icon={MailCheck} tone="signal" size="lg" />
          <h1 className="text-3xl">
            <Trans>Check your email</Trans>
          </h1>
          <p className="text-ink-2">
            <Trans>
              We sent a sign-in link to{" "}
              <span className="font-medium text-ink wrap-anywhere">{sentTo}</span>. It expires in 10
              minutes.
            </Trans>
          </p>
          <Button variant="link" onClick={() => setSentTo(null)}>
            <Trans>Use a different email</Trans>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-4 pt-16 pb-16">
      <div className="sheet grid gap-6 p-6 sm:p-8">
        <div className="grid justify-items-center gap-3 text-center">
          <ToneIcon icon={Mail} tone="signal" size="lg" />
          <h1 className="text-3xl">
            <Trans>Sign in</Trans>
          </h1>
          <p className="text-ink-3">
            <Trans>We'll email you a link to sign in. No password needed.</Trans>
          </p>
        </div>
        {oidcError !== null && (
          <ErrorState
            title={i18n._(
              oidcSignInErrorMessage(
                oidcError || undefined,
                oidc?.displayName ?? t`single sign-on`,
              ),
            )}
          />
        )}
        {linkError && (
          <ErrorState
            title={<Trans>That sign-in link is invalid or has expired. Request a new one.</Trans>}
          />
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="grid gap-5"
        >
          <form.Field name="email">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>
                  <Trans>Email</Trans>
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-sm text-destructive">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Subscribe
            selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? t`Sending…` : t`Email me a sign-in link`}
              </Button>
            )}
          </form.Subscribe>
        </form>

        {oidc ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 text-sm text-ink-3">
              <span className="h-px flex-1 bg-rule" />
              <Trans>or</Trans>
              <span className="h-px flex-1 bg-rule" />
            </div>
            <OidcSignInButton
              providerId={oidc.providerId}
              displayName={oidc.displayName}
              callbackURL={callbackURL}
            />
          </div>
        ) : null}
      </div>

      <div className="grid justify-items-center gap-2 text-center text-sm text-ink-3">
        {signUpAvailable ? (
          <p>
            <Trans>
              New to OpenValens?{" "}
              <a
                href="/signup"
                className="rounded font-display font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Create account
              </a>
            </Trans>
          </p>
        ) : (
          <p>
            <Trans>New accounts require an invitation.</Trans>
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-4">
          {setupAvailable ? (
            <a
              href="/setup"
              className="rounded font-display font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Trans>First setup</Trans>
            </a>
          ) : null}
          <a
            href="/join"
            className="rounded font-display font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Trans>Redeem invitation</Trans>
          </a>
        </div>
      </div>
    </div>
  );
}
