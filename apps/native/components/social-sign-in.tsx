import { useLingui } from "@lingui/react/macro";
import * as AppleAuthentication from "expo-apple-authentication";
import { Spinner, useToast } from "heroui-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAppTheme } from "@/contexts/app-theme-context";
import { appleSheetAvailable, signInInBrowser, signInWithAppleSheet } from "@/lib/social-sign-in";
import { appleFlow, type SocialOutcome, type SocialProvider } from "@/lib/social-sign-in-outcome";

/** Google's four-colour "G" (branding guidelines: never recoloured). */
function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessibilityElementsHidden>
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

function AppleMark({ color }: { color: string }) {
  return (
    <Svg width={18} height={22} viewBox="0 0 814 1000" accessibilityElementsHidden>
      <Path
        fill={color}
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
      />
    </Svg>
  );
}

const BUTTON_HEIGHT = 48;
const BUTTON_RADIUS = 24;

/**
 * Issue #296 — "Continue with Google" and "Continue with Apple" on the
 * sign-in screen, only for what the server advertises. Apple on iOS is the
 * system button and sheet (Apple-approved by construction); elsewhere both
 * open the provider in the browser. Sign-in only: a new identity is refused
 * here, and in Cloud the account is created on the sign-up page.
 */
export function SocialSignInButtons({
  google,
  apple,
  appleNative,
  signUpAvailable,
}: {
  google: boolean;
  apple: boolean;
  appleNative: boolean;
  signUpAvailable: boolean;
}) {
  const { t } = useLingui();
  const { toast } = useToast();
  const { isDark } = useAppTheme();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [sheet, setSheet] = useState(false);
  const flow = appleFlow(Platform.OS, appleNative);

  useEffect(() => {
    if (!apple || flow !== "native") return;
    let active = true;
    void appleSheetAvailable().then((available) => {
      if (active) setSheet(available);
    });
    return () => {
      active = false;
    };
  }, [apple, flow]);

  if (!google && !apple) return null;

  const report = (outcome: SocialOutcome, name: string) => {
    switch (outcome.kind) {
      case "ok":
      case "canceled":
        return;
      case "no-account":
        toast.show({
          variant: "danger",
          label: signUpAvailable
            ? t`No account is connected to that ${name} account. Create an account first.`
            : t`No account is connected to that ${name} account. Ask your administrator for an invitation, or sign in with an email link and connect ${name} in Settings.`,
        });
        return;
      case "incomplete":
        toast.show({
          variant: "default",
          label: t`Sign-in with ${name} did not finish. If it isn't connected to your account yet, sign in with an email link and connect it in Settings.`,
        });
        return;
      default:
        toast.show({
          variant: "danger",
          label: t`Could not sign in with ${name}. Please try again.`,
        });
    }
  };

  const run = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider);
    try {
      const outcome =
        provider === "apple" && flow === "native" && sheet
          ? await signInWithAppleSheet()
          : await signInInBrowser(provider);
      report(outcome, provider === "google" ? "Google" : "Apple");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="gap-3">
      {apple && flow === "native" && sheet ? (
        <AppleAuthentication.AppleAuthenticationButton
          testID="sign-in-apple"
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            isDark
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={BUTTON_RADIUS}
          style={{ height: BUTTON_HEIGHT, width: "100%" }}
          onPress={() => void run("apple")}
        />
      ) : apple ? (
        <Pressable
          testID="sign-in-apple"
          accessibilityRole="button"
          accessibilityLabel={t`Continue with Apple`}
          disabled={busy !== null}
          onPress={() => void run("apple")}
          className="flex-row items-center justify-center gap-3 active:opacity-80"
          style={{
            height: BUTTON_HEIGHT,
            borderRadius: BUTTON_RADIUS,
            backgroundColor: isDark ? "#ffffff" : "#000000",
          }}
        >
          {busy === "apple" ? (
            <Spinner size="sm" />
          ) : (
            <AppleMark color={isDark ? "#000000" : "#ffffff"} />
          )}
          <Text
            className="font-sans text-base font-medium"
            style={{ color: isDark ? "#000000" : "#ffffff" }}
          >
            {t`Continue with Apple`}
          </Text>
        </Pressable>
      ) : null}
      {google ? (
        <Pressable
          testID="sign-in-google"
          accessibilityRole="button"
          accessibilityLabel={t`Continue with Google`}
          disabled={busy !== null}
          onPress={() => void run("google")}
          className="flex-row items-center justify-center gap-3 active:opacity-80"
          style={{
            height: BUTTON_HEIGHT,
            borderRadius: BUTTON_RADIUS,
            borderWidth: 1,
            borderColor: isDark ? "#8e918f" : "#747775",
            backgroundColor: isDark ? "#131314" : "#ffffff",
          }}
        >
          {busy === "google" ? <Spinner size="sm" /> : <GoogleMark />}
          <Text
            className="font-sans text-base font-medium"
            style={{ color: isDark ? "#e3e3e3" : "#1f1f1f" }}
          >
            {t`Continue with Google`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
