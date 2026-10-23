import { useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { OIDC_ERROR_MARKER } from "@/utils/sign-in-options";

export type OidcSignInButtonProps = {
  providerId: string;
  displayName: string;
  /** Absolute URL to land on after a successful sign-in. */
  callbackURL: string;
};

/**
 * Issue #65 — "Continue with <name>" for the one configured OIDC provider.
 * Sign-in only: an identity with no linked account is refused by the server
 * and lands back on `/login` with a neutral message.
 */
export default function OidcSignInButton({
  providerId,
  displayName,
  callbackURL,
}: OidcSignInButtonProps) {
  const [busy, setBusy] = useState(false);
  const { t } = useLingui();

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { error } = await authClient.signIn.social({
            provider: providerId,
            callbackURL,
            errorCallbackURL: `${window.location.origin}/login?via=${OIDC_ERROR_MARKER}`,
          });
          if (error) {
            toast.error(t`Could not start sign-in with ${displayName}. Please try again.`);
            setBusy(false);
          }
        } catch {
          toast.error(t`Could not start sign-in with ${displayName}. Please try again.`);
          setBusy(false);
        }
      }}
    >
      {busy ? t`Redirecting…` : t`Continue with ${displayName}`}
    </Button>
  );
}
