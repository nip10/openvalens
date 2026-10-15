import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import OidcSignInButton from "@/components/oidc-sign-in-button";
import { authClient } from "@/lib/auth-client";
import { validateReturnUrl } from "@/utils/return-url";
import { oidcSignInErrorMessage } from "@/utils/sign-in-options";

export type MagicLinkFormProps = {
  linkError?: boolean;
  setupAvailable?: boolean;
  returnUrl?: string | null;
  /** Issue #65 — the configured OIDC provider, or `null` (no button). */
  oidc?: { providerId: string; displayName: string } | null;
  /** Issue #65 — error code from a failed OIDC redirect, or `null`. */
  oidcError?: string | null;
};

/**
 * Passwordless sign-in. The server only supports magic links for existing
 * accounts (email/password and public sign-up are disabled).
 */
export default function MagicLinkForm({
  linkError,
  setupAvailable,
  returnUrl,
  oidc = null,
  oidcError = null,
}: MagicLinkFormProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);

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
        if (error) toast.error("Could not send the sign-in link. Please try again.");
        else setSentTo(email);
      } catch {
        toast.error("Could not send the sign-in link. Please try again.");
      }
    },
    validators: {
      onSubmit: z.object({ email: z.email("Enter a valid email address") }),
    },
  });

  if (sentTo) {
    return (
      <div className="mx-auto mt-10 w-full max-w-md space-y-4 p-6 text-center">
        <h1 className="text-3xl font-bold">Check your email</h1>
        <p className="text-muted-foreground">
          We sent a sign-in link to{" "}
          <span className="font-medium text-foreground wrap-anywhere">{sentTo}</span>. It expires in
          10 minutes.
        </p>
        <Button variant="link" onClick={() => setSentTo(null)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-2 text-center text-3xl font-bold">Sign in</h1>
      <p className="mb-6 text-center text-sm text-muted-foreground">
        We'll email you a link to sign in. No password needed.
      </p>
      {oidcError !== null && (
        <p className="mb-4 text-center text-sm text-destructive">
          {oidcSignInErrorMessage(oidcError || undefined, oidc?.displayName ?? "single sign-on")}
        </p>
      )}
      {linkError && (
        <p className="mb-4 text-center text-sm text-destructive">
          That sign-in link is invalid or has expired. Request a new one.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.Field name="email">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Email</Label>
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
              {isSubmitting ? "Sending…" : "Email me a sign-in link"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      {oidc ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <OidcSignInButton
            providerId={oidc.providerId}
            displayName={oidc.displayName}
            callbackURL={callbackURL}
          />
        </div>
      ) : null}

      <div className="mt-6 space-y-2 border-t pt-6 text-center text-sm text-muted-foreground">
        <p>New accounts require an invitation.</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {setupAvailable ? (
            <a href="/setup" className="text-primary underline underline-offset-4">
              First setup
            </a>
          ) : null}
          <a href="/join" className="text-primary underline underline-offset-4">
            Redeem invitation
          </a>
        </div>
      </div>
    </div>
  );
}
