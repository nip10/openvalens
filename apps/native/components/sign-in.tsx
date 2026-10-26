import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, Label, Spinner, TextField, useToast } from "heroui-native";
import { Mail, MailCheck } from "lucide-react-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import z from "zod";

import { Sheet, ToneIcon } from "@/components/bloom";
import { cancelPendingMagicLink, requestMagicLink } from "@/lib/magic-link";

/**
 * Passwordless sign-in for an existing account. Accounts are invite-only and
 * created on the web (`/setup` for the first administrator, `/join` for an
 * invitation); a magic link never creates one. Open the emailed link on this
 * phone.
 */
export function SignIn() {
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
    <Sheet className="gap-4 p-6">
      <View className="items-center gap-3">
        <ToneIcon icon={sentTo ? MailCheck : Mail} tone="signal" size="lg" />
        <Text
          className="font-display text-[26px] font-semibold leading-[32px] text-ink"
          accessibilityRole="header"
        >
          <Trans>Sign in</Trans>
        </Text>
      </View>
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
    </Sheet>
  );
}
