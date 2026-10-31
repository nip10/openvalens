import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Label, Spinner, TextField, useToast } from "heroui-native";
import { Mail, MailCheck, ShieldCheck, UserPlus } from "lucide-react-native";
import { useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import z from "zod";

import { ErrorState, Icon, Sheet, ToneIcon } from "@/components/bloom";
import { useChangeServer } from "@/components/change-server";
import { useServerProblemCopy } from "@/components/server-choice";
import { SocialSignInButtons } from "@/components/social-sign-in";
import { authClient } from "@/lib/auth-client";
import { cancelPendingMagicLink, requestMagicLink } from "@/lib/magic-link";
import { serverLabel } from "@/lib/server/server-address";
import { probeServer } from "@/lib/server/server-meta";
import { isServerLocked, useServer } from "@/lib/server/server-url";
import { orpc } from "@/utils/orpc";

/**
 * Issue #295 — sign-in for the chosen server, showing only the methods its
 * `/.well-known/openvalens` advertises. A server that cannot be reached or
 * does not match this app says so, with a way to retry or change server.
 */
export function SignIn() {
  const { t } = useLingui();
  const server = useServer();
  const url = server.status === "set" ? server.url : null;
  const problemCopy = useServerProblemCopy();
  const changeServer = useChangeServer();
  const meta = useQuery({
    queryKey: ["serverMeta", url],
    queryFn: () => probeServer(url ?? ""),
    enabled: !!url,
    staleTime: 5 * 60_000,
  });
  if (!url) return null;
  const host = serverLabel(url);

  const footer = (
    <View className="items-center gap-1 pt-1">
      <Text className="text-center font-sans text-sm text-ink-3">
        <Trans>Signing in to {host}</Trans>
      </Text>
      {isServerLocked() ? null : (
        <Button
          variant="ghost"
          size="sm"
          onPress={changeServer}
          className="min-h-11"
          testID="change-server"
        >
          <Button.Label>
            <Trans>Change server</Trans>
          </Button.Label>
        </Button>
      )}
    </View>
  );

  if (meta.isPending) {
    return (
      <Sheet className="items-center gap-3 p-6">
        <Spinner />
        <Text className="font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
          <Trans>Checking {host}…</Trans>
        </Text>
      </Sheet>
    );
  }

  const check = meta.data;
  if (!check?.ok) {
    const copy = problemCopy(check ? check.problem : { kind: "unreachable" }, url);
    return (
      <View className="gap-3">
        <ErrorState
          title={copy.title}
          description={copy.description}
          action={
            <Button variant="outline" size="sm" onPress={() => void meta.refetch()}>
              <Button.Label>{t`Retry`}</Button.Label>
            </Button>
          }
        />
        {footer}
      </View>
    );
  }

  const methods = check.meta.signIn;
  const anyMethod = methods.magicLink || methods.oidc || methods.google || methods.apple;
  return (
    <Sheet className="gap-4 p-6">
      {methods.magicLink ? <MagicLinkSignIn /> : <SignInHeading sent={false} />}
      {methods.google || methods.apple ? (
        <SocialSignIn
          google={methods.google}
          apple={methods.apple}
          signUpAvailable={methods.signUp}
        />
      ) : null}
      {methods.oidc ? <OidcSignIn /> : null}
      {anyMethod ? null : (
        <Text className="text-center font-sans text-base text-ink-3">
          <Trans>This server offers no sign-in method this app supports. Sign in on the web.</Trans>
        </Text>
      )}
      {methods.signUp ? <CreateAccount url={url} /> : null}
      {footer}
    </Sheet>
  );
}

function SignInHeading({ sent }: { sent: boolean }) {
  return (
    <View className="items-center gap-3">
      <ToneIcon icon={sent ? MailCheck : Mail} tone="signal" size="lg" />
      <Text
        className="font-display text-[26px] font-semibold leading-[32px] text-ink"
        accessibilityRole="header"
      >
        <Trans>Sign in</Trans>
      </Text>
    </View>
  );
}

/**
 * Issue #296 — Google and Apple. Whether the iOS sheet may be used comes from
 * `signIn.options` (`appleNative`); until it loads, Apple uses the browser.
 */
function SocialSignIn({
  google,
  apple,
  signUpAvailable,
}: {
  google: boolean;
  apple: boolean;
  signUpAvailable: boolean;
}) {
  const options = useQuery(orpc.signIn.options.queryOptions({ input: {} }));
  return (
    <SocialSignInButtons
      google={google}
      apple={apple}
      appleNative={options.data?.appleNative === true}
      signUpAvailable={signUpAvailable}
    />
  );
}

/** "Continue with <name>" for the server's one OIDC provider (#65). */
function OidcSignIn() {
  const { t } = useLingui();
  const { toast } = useToast();
  const options = useQuery(orpc.signIn.options.queryOptions({ input: {} }));
  const [busy, setBusy] = useState(false);
  const oidc = options.data?.oidc;
  if (!oidc) return null;
  const displayName = oidc.displayName;
  const failed = t`Could not start sign-in with ${displayName}. Please try again.`;

  const start = async () => {
    setBusy(true);
    try {
      // The Expo client opens the provider in the browser and stores the
      // session the server hands back to `openvalens://`.
      const { error } = await authClient.signIn.social({
        provider: oidc.providerId,
        callbackURL: "/",
      });
      if (error) toast.show({ variant: "danger", label: failed });
    } catch {
      toast.show({ variant: "danger", label: failed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onPress={() => void start()} isDisabled={busy}>
      {busy ? <Spinner size="sm" /> : <Icon icon={ShieldCheck} size={18} color="ink-2" />}
      <Button.Label>{t`Continue with ${displayName}`}</Button.Label>
    </Button>
  );
}

/**
 * Public sign-up, shown only where the server takes it (Cloud, #294). For now
 * it opens the server's web sign-up page in the browser.
 */
function CreateAccount({ url }: { url: string }) {
  const { t } = useLingui();
  return (
    <Button
      variant="ghost"
      onPress={() => void Linking.openURL(`${url}/signup`)}
      accessibilityHint={t`Opens the sign-up page in your browser`}
    >
      <Icon icon={UserPlus} size={18} color="ink-2" />
      <Button.Label>
        <Trans>Create an account</Trans>
      </Button.Label>
    </Button>
  );
}

/**
 * Passwordless sign-in for an existing account. On a self-hosted server
 * accounts are invite-only and created on the web (`/setup` for the first
 * administrator, `/join` for an invitation); a magic link never creates one.
 * Open the emailed link on this phone.
 */
function MagicLinkSignIn() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inFlight = useRef(false);
  const { t } = useLingui();
  const invalidEmail = t`Enter a valid email address`;
  const sendFailed = t`Could not send the sign-in link. Please try again.`;

  const submit = async () => {
    if (inFlight.current) return;
    const parsed = z.string().trim().email(invalidEmail).safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? invalidEmail);
      return;
    }
    inFlight.current = true;
    setError(null);
    setSending(true);
    try {
      const result = await requestMagicLink(parsed.data);
      if (result.error) setError(sendFailed);
      else setSentTo(parsed.data);
    } catch {
      setError(sendFailed);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const useDifferentEmail = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await cancelPendingMagicLink();
      setSentTo(null);
      setError(null);
    } catch {
      toast.show({
        variant: "danger",
        label: t`Could not clear the pending sign-in. Please try again.`,
      });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <>
      <SignInHeading sent={!!sentTo} />
      {sentTo ? (
        <View className="gap-4">
          <Text className="text-center font-sans text-base leading-relaxed text-ink-2">
            <Trans>
              We sent a sign-in link to {sentTo}. Open it on this phone within 10 minutes.
            </Trans>
          </Text>
          <Button variant="secondary" onPress={() => void useDifferentEmail()} isDisabled={sending}>
            <Button.Label>
              <Trans>Use a different email</Trans>
            </Button.Label>
          </Button>
        </View>
      ) : (
        <View className="gap-4">
          <Text className="text-center font-sans text-base leading-relaxed text-ink-3">
            <Trans>We'll email you a link. No password needed.</Trans>
          </Text>
          <TextField isInvalid={!!error}>
            {/* heroui's Label takes a plain string; a <Trans> element is not one. */}
            <Label>{t`Email`}</Label>
            <Input
              testID="sign-in-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          </TextField>
          {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
          <Button onPress={() => void submit()} isDisabled={sending}>
            {sending ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label>
                <Trans>Email me a sign-in link</Trans>
              </Button.Label>
            )}
          </Button>
        </View>
      )}
    </>
  );
}
