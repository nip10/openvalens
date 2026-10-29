import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import type { SocialProvider } from "@/utils/sign-in-options";

export type SocialSignInButtonsProps = {
  google: boolean;
  apple: boolean;
  /** Absolute URL to land on after a successful sign-in. */
  callbackURL: string;
  /** Absolute URL the server sends a failed attempt back to (`&error=<code>` is added). */
  errorCallbackURL: (provider: SocialProvider) => string;
  /**
   * Cloud sign-up: runs before the redirect; return `null` to stop (e.g. the
   * terms are not ticked) or the data asking the server to create the account.
   */
  signUp?: () => Record<string, unknown> | null;
  /** Disable signup providers until all explicit signup consents are checked. */
  disabled?: boolean;
};

/** Google's four-colour "G" (branding guidelines: never recoloured). */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5 shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Apple logo glyph (Human Interface Guidelines: same colour as the label). */
function AppleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 814 1000"
      className="size-[1.1rem] shrink-0"
      fill="currentColor"
    >
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

const BASE =
  "inline-flex h-11 w-full items-center justify-center gap-3 rounded-full px-5 text-[15px] font-medium transition-colors duration-[var(--dur-short)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Issue #296 — "Continue with Google" and "Continue with Apple", shown only
 * for the providers the server has configured. Each follows its provider's
 * button rules: Google's white button with the unaltered "G" (dark theme
 * variant in dark mode), Apple's black button with the logo in the label
 * colour (white variant in dark mode), same height and corner radius.
 */
export default function SocialSignInButtons({
  google,
  apple,
  callbackURL,
  errorCallbackURL,
  signUp,
  disabled = false,
}: SocialSignInButtonsProps) {
  const { t } = useLingui();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  if (!google && !apple) return null;

  const start = async (provider: SocialProvider, name: string) => {
    const additionalData = signUp ? signUp() : undefined;
    if (additionalData === null) return;
    setBusy(provider);
    const failed = t`Could not start sign-in with ${name}. Please try again.`;
    try {
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL: errorCallbackURL(provider),
        ...(additionalData ? { additionalData } : {}),
      });
      if (error) {
        toast.error(failed);
        setBusy(null);
      }
    } catch {
      toast.error(failed);
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3">
      {google ? (
        <button
          type="button"
          className={`${BASE} border border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f2f2f2] dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1f1f20]`}
          disabled={disabled || busy !== null}
          onClick={() => void start("google", "Google")}
        >
          <GoogleMark />
          {busy === "google" ? t`Redirecting…` : t`Continue with Google`}
        </button>
      ) : null}
      {apple ? (
        <button
          type="button"
          className={`${BASE} bg-black text-white hover:bg-[#1d1d1f] dark:bg-white dark:text-black dark:hover:bg-[#f2f2f2]`}
          disabled={disabled || busy !== null}
          onClick={() => void start("apple", "Apple")}
        >
          <AppleMark />
          {busy === "apple" ? t`Redirecting…` : t`Continue with Apple`}
        </button>
      ) : null}
    </div>
  );
}
