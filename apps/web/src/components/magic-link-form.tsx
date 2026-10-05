import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

/**
 * Passwordless sign-in. The server only supports magic links (email and
 * password are disabled); the first sign-in creates the account.
 */
export default function MagicLinkForm({ linkError }: { linkError?: boolean }) {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      const origin = window.location.origin;
      try {
        const { error } = await authClient.signIn.magicLink({
          email,
          callbackURL: `${origin}/dashboard`,
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
          We sent a sign-in link to <span className="font-medium text-foreground">{sentTo}</span>.
          It expires in 10 minutes.
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
    </div>
  );
}
