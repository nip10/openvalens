import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

import { AdmissionForm, type AdmissionFormProps } from "./admission-form";

export type ConnectedAdmissionFormProps = Omit<
  AdmissionFormProps,
  "userId" | "sessionEmail" | "onRequestMagicLink"
>;

/**
 * Connected admission form that wires the app auth client and session hook.
 * Refetches the session when the window regains focus so a sign-in link opened
 * in another tab is reflected without storing secrets.
 */
export default function ConnectedAdmissionForm(props: ConnectedAdmissionFormProps) {
  const session = authClient.useSession();

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        void session.refetch();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [session]);

  async function onRequestMagicLink(email: string, purpose: "resume" | "dashboard") {
    const origin = window.location.origin;
    const callbackURL =
      purpose === "resume" ? `${origin}${window.location.pathname}` : `${origin}/dashboard`;
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL,
    });
    if (error) throw error;
  }

  return (
    <AdmissionForm
      {...props}
      userId={session.data?.user?.id ?? null}
      sessionEmail={session.data?.user?.email?.toLowerCase() ?? null}
      onRequestMagicLink={onRequestMagicLink}
    />
  );
}
