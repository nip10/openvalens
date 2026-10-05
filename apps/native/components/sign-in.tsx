import { Button, Input, Label, Spinner, Surface, TextField, useToast } from "heroui-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import z from "zod";

import { cancelPendingMagicLink, requestMagicLink } from "@/lib/magic-link";

const emailSchema = z.string().trim().email("Enter a valid email address");

/**
 * Passwordless sign-in. The server only supports magic links; the first
 * sign-in creates the account. Open the emailed link on this phone.
 */
export function SignIn() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    inFlight.current = true;
    setError(null);
    setSending(true);
    try {
      const result = await requestMagicLink(parsed.data);
      if (result.error) setError("Could not send the sign-in link. Please try again.");
      else setSentTo(parsed.data);
    } catch {
      setError("Could not send the sign-in link. Please try again.");
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
        label: "Could not clear the pending sign-in. Please try again.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Surface variant="secondary" className="rounded-lg p-4">
      <Text className="mb-1 font-medium text-foreground">Sign in</Text>
      {sentTo ? (
        <View className="gap-3">
          <Text className="text-sm text-muted">
            We sent a sign-in link to {sentTo}. Open it on this phone within 10 minutes.
          </Text>
          <Button variant="secondary" onPress={() => void useDifferentEmail()} isDisabled={sending}>
            <Button.Label>Use a different email</Button.Label>
          </Button>
        </View>
      ) : (
        <View className="gap-3">
          <Text className="text-sm text-muted">We'll email you a link. No password needed.</Text>
          <TextField isInvalid={!!error}>
            <Label>Email</Label>
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
          {error && <Text className="text-sm text-danger">{error}</Text>}
          <Button onPress={() => void submit()} isDisabled={sending}>
            {sending ? <Spinner size="sm" /> : <Button.Label>Email me a sign-in link</Button.Label>}
          </Button>
        </View>
      )}
    </Surface>
  );
}
