import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { CircleCheck, Eye, EyeOff, KeyRound, MailCheck, PartyPopper } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { ToneIcon } from "@/components/page";
import type { AdmissionKind } from "@/utils/admission-keys";
import { type AdmissionErrorCode } from "@/utils/admission-error";
import { useAdmissionFlow } from "@/utils/admission-flow";

export type AdmissionFormProps = {
  kind: AdmissionKind;
  title: string;
  description: string;
  tokenLabel: string;
  tokenHelp: string;
  closedCopy?: {
    headline: string;
    body: string;
  };
  setupAvailable?: boolean;
  userId: string | null;
  sessionEmail: string | null;
  onRequestMagicLink: (email: string, purpose: "resume" | "dashboard") => Promise<void>;
};

const ADMISSION_ERROR_MESSAGES: Record<AdmissionErrorCode, MessageDescriptor> = {
  unavailable: msg`Enrollment is not available right now.`,
  closed: msg`Enrollment is closed. Sign in below if you already have an account.`,
  expired: msg`This token or code has expired. Request a new one.`,
  denied: msg`Could not complete enrollment. Check the token and code, then try again.`,
  rate_limited: msg`Too many attempts. Wait a moment, then try again.`,
  delivery_failed: msg`Could not send the email. Try again later.`,
  email_unavailable: msg`This server can't send email yet, so the verification code can't be delivered. The operator needs to add a Resend key (see the self-hosting email guide).`,
  invalid_input: msg`Check the email and token, then try again.`,
  session_mismatch: msg`Sign in with the matching email first, then return and enter the token again.`,
  network: msg`Connection lost. Check your network and try again.`,
  unknown: msg`Something went wrong. Try again.`,
};

export function AdmissionForm({
  kind,
  title,
  description,
  tokenLabel,
  tokenHelp,
  closedCopy,
  setupAvailable,
  userId,
  sessionEmail,
  onRequestMagicLink,
}: AdmissionFormProps) {
  const emailId = useId();
  const credentialId = useId();
  const codeId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const { t, i18n } = useLingui();

  // The verification email is written in the language this page is shown in (#231).
  const flow = useAdmissionFlow({
    kind,
    userId,
    sessionEmail,
    onRequestMagicLink,
    locale: i18n.locale,
  });
  const state = flow.state;

  useEffect(() => {
    if (state.step === "code") {
      codeRef.current?.focus();
    }
  }, [state.step]);

  if (kind === "setup" && setupAvailable === false && closedCopy) {
    return <ClosedCard headline={closedCopy.headline} body={closedCopy.body} />;
  }

  if (state.step === "success") {
    return (
      <SuccessCard
        email={state.email}
        hasMatchingSession={state.hasMatchingSession}
        linkDelivery={state.linkDelivery}
        onSignIn={() => void flow.requestMagicLink("dashboard")}
        onStartOver={flow.reset}
      />
    );
  }

  const isSessionMatch = !!sessionEmail && sessionEmail.toLowerCase() === state.email.toLowerCase();

  return (
    <Card className="mx-auto w-full max-w-md sm:py-7">
      <CardHeader className="gap-2 sm:px-7">
        <ToneIcon icon={state.step === "token" ? KeyRound : MailCheck} tone="signal" size="lg" />
        <CardTitle className="pt-1 text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:px-7">
        {sessionEmail ? (
          <p className="text-sm text-ink-3">
            <Trans>
              Signed in as{" "}
              <span className="font-medium text-ink wrap-anywhere">{sessionEmail}</span>.
            </Trans>
          </p>
        ) : null}

        {isSessionMatch && state.step === "token" ? (
          <p className="text-sm text-ink-3">
            <Trans>
              Enter the token again to continue enrollment as{" "}
              <span className="font-medium text-ink wrap-anywhere">{state.email}</span>.
            </Trans>
          </p>
        ) : null}

        {state.step === "token" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void flow.begin();
            }}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor={emailId}>
                <Trans>Email</Trans>
              </Label>
              <Input
                id={emailId}
                type="email"
                autoComplete="email"
                value={state.email}
                onChange={(e) => flow.setEmail(e.target.value)}
                disabled={state.isBusy}
                placeholder="name@example.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={credentialId}>{tokenLabel}</Label>
              <div className="relative">
                <Input
                  id={credentialId}
                  type={state.credentialVisible ? "text" : "password"}
                  autoComplete="off"
                  spellCheck="false"
                  value={state.credential}
                  onChange={(e) => flow.setCredential(e.target.value)}
                  disabled={state.isBusy}
                  placeholder={tokenHelp}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => flow.toggleCredentialVisible()}
                  className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors duration-[var(--dur-short)] hover:bg-muted hover:text-ink"
                  aria-label={state.credentialVisible ? t`Hide token` : t`Show token`}
                  tabIndex={-1}
                >
                  {state.credentialVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-sm text-ink-3">{tokenHelp}</p>
            </div>

            <ErrorMessage code={state.errorCode} />

            <Button type="submit" disabled={state.isBusy}>
              {state.isBusy ? t`Sending code…` : t`Continue`}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void flow.complete();
            }}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor={codeId}>
                <Trans>Verification code</Trans>
              </Label>
              <Input
                id={codeId}
                ref={codeRef}
                type="text"
                autoComplete="off"
                spellCheck="false"
                value={state.code}
                onChange={(e) => flow.setCode(e.target.value)}
                disabled={state.isBusy}
                placeholder={t`Paste the code from your email`}
              />
              <p className="text-sm text-ink-3">
                <Trans>
                  We emailed a one-time code to{" "}
                  <span className="font-medium text-ink wrap-anywhere">{state.email}</span>. It
                  expires in 10 minutes.
                </Trans>
              </p>
            </div>

            <ErrorMessage code={state.errorCode} />

            {state.errorCode === "session_mismatch" ? (
              <SessionMismatchHelp
                email={state.email}
                onSendLink={() => void flow.requestMagicLink("resume")}
                linkDelivery={state.linkDelivery}
                isSessionMatch={isSessionMatch}
              />
            ) : null}

            <Button type="submit" disabled={state.isBusy}>
              {state.isBusy ? t`Verifying…` : t`Complete enrollment`}
            </Button>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => flow.reset()}
                disabled={state.isBusy}
              >
                <Trans>Start over</Trans>
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void flow.resend()}
                disabled={state.isBusy}
              >
                <Trans>Resend code</Trans>
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorMessage({ code }: { code: AdmissionErrorCode | null }) {
  const { i18n } = useLingui();
  if (!code) return null;
  return (
    <p
      className="text-sm text-destructive"
      role="alert"
      aria-live="polite"
      data-testid="admission-error"
    >
      {i18n._(ADMISSION_ERROR_MESSAGES[code])}
    </p>
  );
}

function SessionMismatchHelp({
  email,
  onSendLink,
  linkDelivery,
  isSessionMatch,
}: {
  email: string;
  onSendLink: () => void;
  linkDelivery: "idle" | "sending" | "sent" | "error";
  isSessionMatch: boolean;
}) {
  const { t } = useLingui();
  if (isSessionMatch) {
    return (
      <p className="text-sm text-success">
        <Trans>Signed in as {email}. Enter the token again to continue enrollment.</Trans>
      </p>
    );
  }

  return (
    <div className="rounded-2xl bg-paper-2 px-4 py-3">
      <p className="text-sm text-ink-3">
        <Trans>
          This email may already belong to an account. Send a sign-in link to{" "}
          <span className="font-medium text-ink wrap-anywhere">{email}</span>, then return to this
          tab and enter the token again.
        </Trans>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={onSendLink}
        disabled={linkDelivery === "sending"}
      >
        {linkDelivery === "sending"
          ? t`Sending…`
          : linkDelivery === "sent"
            ? t`Sign-in link sent`
            : t`Email me a sign-in link`}
      </Button>
      {linkDelivery === "error" ? (
        <p className="mt-2 text-sm text-destructive">
          <Trans>Could not send sign-in link.</Trans>
        </p>
      ) : null}
    </div>
  );
}

function SuccessCard({
  email,
  hasMatchingSession,
  linkDelivery,
  onSignIn,
  onStartOver,
}: {
  email: string;
  hasMatchingSession: boolean;
  linkDelivery: "idle" | "sending" | "sent" | "error";
  onSignIn: () => void;
  onStartOver: () => void;
}) {
  const { t } = useLingui();
  return (
    <Card className="mx-auto w-full max-w-md sm:py-7">
      <CardHeader className="gap-2 sm:px-7">
        <ToneIcon icon={PartyPopper} tone="signal" size="lg" />
        <CardTitle className="pt-1 text-2xl">
          <Trans>Enrollment complete</Trans>
        </CardTitle>
        <CardDescription>
          {hasMatchingSession
            ? t`Your account is ready.`
            : t`Your account is ready. Sign in to continue.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:px-7">
        {hasMatchingSession ? (
          <>
            <p className="text-sm text-ink-3">
              <Trans>
                Continue to OpenValens as{" "}
                <span className="font-medium text-ink wrap-anywhere">{email}</span>.
              </Trans>
            </p>
            <Button asChild>
              <a href="/dashboard">
                <Trans>Go to dashboard</Trans>
              </a>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-3">
              <Trans>
                Sign in with <span className="font-medium text-ink wrap-anywhere">{email}</span> to
                start using OpenValens.
              </Trans>
            </p>
            <Button onClick={() => void onSignIn()} disabled={linkDelivery === "sending"}>
              {linkDelivery === "sending"
                ? t`Sending…`
                : linkDelivery === "sent"
                  ? t`Sign-in link sent`
                  : t`Email me a sign-in link`}
            </Button>
            {linkDelivery === "error" ? (
              <p className="text-sm text-destructive">
                <Trans>Could not send sign-in link.</Trans>
              </p>
            ) : null}
          </>
        )}
        <Button variant="link" size="sm" onClick={() => onStartOver()}>
          <Trans>Start over</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}

function ClosedCard({ headline, body }: { headline: string; body: string }) {
  return (
    <Card className="mx-auto w-full max-w-md sm:py-7">
      <CardHeader className="gap-2 sm:px-7">
        <ToneIcon icon={CircleCheck} tone="signal" size="lg" />
        <CardTitle className="pt-1 text-2xl">{headline}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:px-7">
        <Button asChild>
          <a href="/login">
            <Trans>Sign in</Trans>
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
