import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { MailCheck, UserPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import z from "zod";

import { ErrorState, ToneIcon } from "@/components/page";
import SocialSignInButtons from "@/components/social-sign-in-buttons";
import {
  socialProviderName,
  socialSignUpErrorMessage,
  type SocialProvider,
} from "@/utils/sign-in-options";
import {
  signUpLinkErrorMessage,
  signUpRequestErrorMessage,
  type SignUpLinkError,
} from "@/utils/sign-up";

type LegalDocument = { url: string; version: string };

export type SignUpFormProps = {
  terms: LegalDocument;
  privacy: LegalDocument;
  healthDataConsent: LegalDocument;
  /** Why the emailed link sent the person back here, if it did. */
  linkError?: SignUpLinkError | null;
  /** Requests the sign-up link; resolves the same whether or not the email has an account. */
  onSubmit: (email: string) => Promise<void>;
  /** Issue #296 — sign up with Google / Apple instead of an email link. */
  google?: boolean;
  apple?: boolean;
  /** Issue #296 — a failed Google or Apple sign-up redirect, or `null`. */
  socialError?: { provider: SocialProvider; code: string } | null;
  /** The language the account is created in. */
  locale?: string;
};

const linkClass =
  "rounded font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Issue #294 — OpenValens Cloud sign-up: email plus acceptance of the terms
 * and privacy policy, then "check your email". The account is created only
 * when the emailed link is used. The confirmation is worded the same whether
 * or not the email already has an account (that case gets a sign-in email).
 */
export default function SignUpForm({
  terms,
  privacy,
  healthDataConsent,
  linkError = null,
  onSubmit,
  google = false,
  apple = false,
  socialError = null,
  locale,
}: SignUpFormProps) {
  const { t, i18n } = useLingui();
  const emailId = useId();
  const legalId = useId();
  const healthConsentId = useId();
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [acceptedHealthData, setAcceptedHealthData] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    setAcceptedHealthData(false);
    setFieldError(null);
  }, [healthDataConsent.version]);

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
              We sent a link to <span className="font-medium text-ink wrap-anywhere">{sentTo}</span>
              . Open it within 1 hour to finish creating your account.
            </Trans>
          </p>
          <p className="text-sm text-ink-3">
            <Trans>If this email already has an account, we sent a sign-in link instead.</Trans>
          </p>
          <Button variant="link" onClick={() => setSentTo(null)}>
            <Trans>Use a different email</Trans>
          </Button>
        </div>
      </div>
    );
  }

  async function submit() {
    const trimmed = email.trim();
    if (!z.email().safeParse(trimmed).success) {
      setFieldError(t`Enter a valid email address`);
      return;
    }
    if (!accepted) {
      setFieldError(t`Accept the terms of service and privacy policy to continue.`);
      return;
    }
    if (!acceptedHealthData) {
      setFieldError(t`Consent to health data processing to continue.`);
      return;
    }
    setFieldError(null);
    setRequestError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setSentTo(trimmed);
    } catch (error) {
      setRequestError(error ?? new Error("sign-up failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-4 pt-16 pb-16">
      <div className="sheet grid gap-6 p-6 sm:p-8">
        <div className="grid justify-items-center gap-3 text-center">
          <ToneIcon icon={UserPlus} tone="signal" size="lg" />
          <h1 className="text-3xl">
            <Trans>Create your account</Trans>
          </h1>
          <p className="text-ink-3">
            <Trans>We'll email you a link to finish. No password needed.</Trans>
          </p>
        </div>

        {linkError ? (
          <ErrorState
            title={i18n._(signUpLinkErrorMessage(linkError))}
            action={
              linkError === "used" ? (
                <a href="/login" className={linkClass}>
                  <Trans>Sign in</Trans>
                </a>
              ) : undefined
            }
          />
        ) : null}
        {socialError ? (
          <ErrorState
            title={i18n._(
              socialSignUpErrorMessage(
                socialError.code || undefined,
                socialProviderName(socialError.provider),
              ),
            )}
            action={
              socialError.code === "account_not_linked" ? (
                <a href="/login" className={linkClass}>
                  <Trans>Sign in</Trans>
                </a>
              ) : undefined
            }
          />
        ) : null}
        {requestError ? (
          <ErrorState title={i18n._(signUpRequestErrorMessage(requestError))} />
        ) : null}

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }}
          className="grid gap-5"
        >
          <div className="grid gap-2">
            <Label htmlFor={emailId}>
              <Trans>Email</Trans>
            </Label>
            <Input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <label htmlFor={legalId} className="flex items-start gap-2 text-sm text-ink-2">
            <input
              id={legalId}
              name="acceptedLegal"
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              <Trans>
                I agree to the{" "}
                <a href={terms.url} target="_blank" rel="noreferrer" className={linkClass}>
                  terms of service
                </a>{" "}
                and the{" "}
                <a href={privacy.url} target="_blank" rel="noreferrer" className={linkClass}>
                  privacy policy
                </a>
                .
              </Trans>
            </span>
          </label>
          <label htmlFor={healthConsentId} className="flex items-start gap-2 text-sm text-ink-2">
            <input
              id={healthConsentId}
              name="acceptedHealthDataConsent"
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={acceptedHealthData}
              onChange={(e) => setAcceptedHealthData(e.target.checked)}
            />
            <span>
              <Trans>
                I consent to OpenValens processing my health data to provide the service. Read our{" "}
                <a href={healthDataConsent.url} target="_blank" rel="noreferrer" className={linkClass}>
                  privacy policy
                </a>
                .
              </Trans>
            </span>
          </label>
          <p className="-mt-3 pl-6 text-xs text-ink-3">
            <Trans>Consent version: {healthDataConsent.version}</Trans>
          </p>

          {fieldError ? (
            <p role="alert" className="text-sm text-destructive">
              {fieldError}
            </p>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || !accepted || !acceptedHealthData}
          >
            {submitting ? t`Sending…` : t`Email me a sign-up link`}
          </Button>
        </form>

        {google || apple ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 text-sm text-ink-3">
              <span className="h-px flex-1 bg-rule" />
              <Trans>or</Trans>
              <span className="h-px flex-1 bg-rule" />
            </div>
            <SocialSignInButtons
              google={google}
              apple={apple}
              disabled={!accepted || !acceptedHealthData}
              callbackURL={`${window.location.origin}/welcome`}
              errorCallbackURL={(provider) => `${window.location.origin}/signup?via=${provider}`}
              signUp={() => {
                // The terms are accepted before the provider flow starts; the
                // server records the versions it serves and the time.
                if (!accepted || !acceptedHealthData) {
                  setFieldError(
                    !accepted
                      ? t`Accept the terms of service and privacy policy to continue.`
                      : t`Consent to health data processing to continue.`,
                  );
                  return null;
                }
                setFieldError(null);
                return {
                  acceptLegal: true,
                  acceptedHealthDataConsent: true,
                  healthDataConsentVersion: healthDataConsent.version,
                  ...(locale ? { locale } : {}),
                };
              }}
            />
          </div>
        ) : null}
      </div>

      <p className="text-center text-sm text-ink-3">
        <Trans>
          Already have an account?{" "}
          <a href="/login" className={linkClass}>
            Sign in
          </a>
        </Trans>
      </p>
    </div>
  );
}
