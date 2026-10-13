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
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef } from "react";

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

const ADMISSION_ERROR_MESSAGES: Record<AdmissionErrorCode, string> = {
  unavailable: "Enrollment is not available right now.",
  closed: "Enrollment is closed. Sign in below if you already have an account.",
  expired: "This token or code has expired. Request a new one.",
  denied: "Could not complete enrollment. Check the token and code, then try again.",
  rate_limited: "Too many attempts. Wait a moment, then try again.",
  delivery_failed: "Could not send the email. Try again later.",
  invalid_input: "Check the email and token, then try again.",
  session_mismatch: "Sign in with the matching email first, then return and enter the token again.",
  network: "Connection lost. Check your network and try again.",
  unknown: "Something went wrong. Try again.",
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

  const flow = useAdmissionFlow({ kind, userId, sessionEmail, onRequestMagicLink });
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
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {sessionEmail ? (
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{sessionEmail}</span>.
          </p>
        ) : null}

        {isSessionMatch && state.step === "token" ? (
          <p className="text-sm text-muted-foreground">
            Enter the token again to continue enrollment as{" "}
            <span className="font-medium text-foreground">{state.email}</span>.
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
              <Label htmlFor={emailId}>Email</Label>
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={state.credentialVisible ? "Hide token" : "Show token"}
                  tabIndex={-1}
                >
                  {state.credentialVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{tokenHelp}</p>
            </div>

            <ErrorMessage code={state.errorCode} />

            <Button type="submit" disabled={state.isBusy}>
              {state.isBusy ? "Sending code…" : "Continue"}
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
              <Label htmlFor={codeId}>Verification code</Label>
              <Input
                id={codeId}
                ref={codeRef}
                type="text"
                autoComplete="off"
                spellCheck="false"
                value={state.code}
                onChange={(e) => flow.setCode(e.target.value)}
                disabled={state.isBusy}
                placeholder="Paste the code from your email"
              />
              <p className="text-xs text-muted-foreground">
                We emailed a one-time code to{" "}
                <span className="font-medium text-foreground">{state.email}</span>. It expires in 10
                minutes.
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
              {state.isBusy ? "Verifying…" : "Complete enrollment"}
            </Button>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => flow.reset()}
                disabled={state.isBusy}
              >
                Start over
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void flow.resend()}
                disabled={state.isBusy}
              >
                Resend code
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorMessage({ code }: { code: AdmissionErrorCode | null }) {
  if (!code) return null;
  return (
    <p
      className="text-sm text-destructive"
      role="alert"
      aria-live="polite"
      data-testid="admission-error"
    >
      {ADMISSION_ERROR_MESSAGES[code]}
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
  if (isSessionMatch) {
    return (
      <p className="text-sm text-success">
        Signed in as {email}. Enter the token again to continue enrollment.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">
        This email may already belong to an account. Send a sign-in link to{" "}
        <span className="font-medium text-foreground">{email}</span>, then return to this tab and
        enter the token again.
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
          ? "Sending…"
          : linkDelivery === "sent"
            ? "Sign-in link sent"
            : "Email me a sign-in link"}
      </Button>
      {linkDelivery === "error" ? (
        <p className="mt-2 text-sm text-destructive">Could not send sign-in link.</p>
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
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Enrollment complete</CardTitle>
        <CardDescription>
          {hasMatchingSession
            ? "Your account is ready."
            : "Your account is ready. Sign in to continue."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {hasMatchingSession ? (
          <>
            <p className="text-sm text-muted-foreground">
              Continue to OpenValens as <span className="font-medium text-foreground">{email}</span>
              .
            </p>
            <Button asChild>
              <a href="/dashboard">Go to dashboard</a>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in with <span className="font-medium text-foreground">{email}</span> to start
              using OpenValens.
            </p>
            <Button onClick={() => void onSignIn()} disabled={linkDelivery === "sending"}>
              {linkDelivery === "sending"
                ? "Sending…"
                : linkDelivery === "sent"
                  ? "Sign-in link sent"
                  : "Email me a sign-in link"}
            </Button>
            {linkDelivery === "error" ? (
              <p className="text-sm text-destructive">Could not send sign-in link.</p>
            ) : null}
          </>
        )}
        <Button variant="link" size="sm" onClick={() => onStartOver()}>
          Start over
        </Button>
      </CardContent>
    </Card>
  );
}

function ClosedCard({ headline, body }: { headline: string; body: string }) {
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{headline}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button asChild>
          <a href="/login">Sign in</a>
        </Button>
      </CardContent>
    </Card>
  );
}
