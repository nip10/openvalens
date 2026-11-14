import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  FIRST_RUN_STEP_TITLES,
  firstRunPosition,
  type FirstRunStep,
  type SetupItem,
} from "@openvalens/api/presenters/onboarding";
import {
  describeProfileSaveError,
  wellnessProfileQueryKey,
} from "@openvalens/api/presenters/wellness-profile";
import type {
  WellnessProfileSnapshot,
  WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button } from "heroui-native";
import { type ReactNode, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState, Meter, Page, PageHeader, Sheet } from "@/components/bloom";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import type { HealthConsentStatus } from "@/lib/health-consent";
import type { OnboardingRoute } from "@/lib/onboarding/steps";
import { useServer } from "@/lib/server/server-url";
import { client, orpc } from "@/utils/orpc";

/** Opens one first-run screen (each is its own screen in the stack). */
export function openFirstRun(route: OnboardingRoute) {
  router.push({ pathname: "/onboarding/[step]", params: { step: route } });
}

/** Opens one "Finish setting up" item on its own screen. */
export function openSetupItem(item: SetupItem) {
  router.push({ pathname: "/onboarding/setup/[item]", params: { item } });
}

/** Leaves onboarding for Today, popping back to it when it is underneath. */
export function leaveOnboarding() {
  router.dismissTo("/(drawer)/(tabs)");
}

/** Back to wherever a card item was opened from (Today). */
export function closeSetupItem() {
  if (router.canGoBack()) router.back();
  else leaveOnboarding();
}

/**
 * The health-data consent status, under the same key as the consent prompt
 * above the drawer, so accepting it on screen 1 also hides the prompt.
 */
export function useHealthConsentStatus(userId: string) {
  const server = useServer();
  const serverUrl = server.status === "set" ? server.url : null;
  const queryKey = ["healthConsent", "status", serverUrl, userId || null] as const;
  const query = useQuery({
    queryKey,
    queryFn: (): Promise<HealthConsentStatus> => client.healthConsent.status({}),
    enabled: !!serverUrl && !!userId,
    staleTime: 60_000,
  });
  return { ...query, queryKey };
}

/**
 * What every onboarding screen shares: the profile snapshot and saving a
 * partial update with `expectedRevision` (setup marked in progress on the
 * first save).
 */
export function useOnboardingProfile() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const profile = useQuery({
    ...orpc.profile.get.queryOptions({ input: {} }),
    queryKey: [...wellnessProfileQueryKey(userId)],
    enabled: !!userId,
    retry: 1,
  });
  const [error, setError] = useState<MessageDescriptor | null>(null);

  const update = useMutation({
    mutationFn: (input: WellnessProfileUpdateInput) => client.profile.update(input),
    onSuccess: (next) => queryClient.setQueryData(wellnessProfileQueryKey(userId), next),
  });

  /** Saves a patch (without `expectedRevision`); `false` when it failed (the error shows). */
  const save = async (
    patch: Omit<WellnessProfileUpdateInput, "expectedRevision">,
  ): Promise<WellnessProfileSnapshot | false> => {
    const snapshot = queryClient.getQueryData<WellnessProfileSnapshot>(
      wellnessProfileQueryKey(userId),
    );
    if (!snapshot) return false;
    setError(null);
    try {
      return await update.mutateAsync({
        ...patch,
        ...(snapshot.setupStatus === null && patch.setupStatus === undefined
          ? { setupStatus: "in_progress" as const }
          : {}),
        expectedRevision: snapshot.revision,
      });
    } catch (failure) {
      const described = describeProfileSaveError(failure);
      if (described.kind === "conflict") void profile.refetch();
      setError(described.message);
      return false;
    }
  };

  return {
    userId,
    profile,
    snapshot: profile.data,
    save,
    saving: update.isPending,
    error,
    setError,
  };
}

export type OnboardingProfileFlow = ReturnType<typeof useOnboardingProfile>;

/** While an onboarding screen's profile loads. */
export function OnboardingLoading() {
  return (
    <Container>
      <Page className="pt-16">
        <Sheet className="h-24" />
        <Sheet className="h-48" />
      </Page>
    </Container>
  );
}

/** The profile (or the consent status) could not be read: nothing changed, retry. */
export function OnboardingLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Container>
      <Page className="pt-16">
        <ErrorState
          title={<Trans>Could not load your profile. Nothing has changed.</Trans>}
          action={
            <Button variant="outline" size="sm" onPress={onRetry}>
              <Button.Label>
                <Trans>Retry</Trans>
              </Button.Label>
            </Button>
          }
        />
      </Page>
    </Container>
  );
}

/**
 * Where a screen sits and what its buttons do. In the first run `step` is
 * set ("Step N of 3") and Skip moves on; a "Finish setting up" item's screen
 * has no step, saves with "Save" and goes back to Today.
 */
export type StepNav = {
  step: FirstRunStep | "server" | null;
  onDone: () => void;
  onBack?: () => void;
  /** Only in the first run, on screens that can be skipped. */
  onSkip?: () => void;
  /** The main button's label when the screen's own default does not fit. */
  doneLabel?: string;
};

/**
 * One screen: the progress bar and "Step 2 of 3" (first run only), the
 * screen's head and its content scroll; Continue (the one filled button),
 * Skip and Back stay at the bottom, within thumb reach, and above the keyboard.
 */
export function StepFrame({
  step,
  title,
  description,
  info,
  children,
  continueLabel,
  onContinue,
  continueDisabled = false,
  busy = false,
  error,
  onSkip,
  onBack,
}: {
  step: StepNav["step"];
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  children?: ReactNode;
  continueLabel?: string;
  /** Left out when the screen has nothing to save yet (only Skip or Back show). */
  onContinue?: () => void;
  continueDisabled?: boolean;
  busy?: boolean;
  error?: MessageDescriptor | null;
  onSkip?: () => void;
  onBack?: () => void;
}) {
  const { t, i18n } = useLingui();
  const insets = useSafeAreaInsets();
  const position = step && step !== "server" ? firstRunPosition(step) : null;
  const progress =
    position && step && step !== "server"
      ? { ...position, label: i18n._(FIRST_RUN_STEP_TITLES[step]) }
      : null;

  return (
    <Container isScrollable={false}>
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top }}
      >
        <Page>
          {step ? (
            <View className="gap-2">
              <Meter
                value={position ? position.index / position.total : 0}
                tone="signal"
                label={t`Setup progress`}
              />
              <Text className="font-sans text-sm text-ink-3">
                {progress ? (
                  <Trans>
                    Step {progress.index} of {progress.total}: {progress.label}
                  </Trans>
                ) : (
                  <Trans>Before your own setup</Trans>
                )}
              </Text>
            </View>
          ) : null}
          <PageHeader title={title} description={description} info={info} />
          {children}
          {error ? (
            <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
              {i18n._(error)}
            </Text>
          ) : null}
        </Page>
      </ScrollView>
      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <View className="gap-1 border-t border-rule bg-background px-4 pb-2 pt-3">
          {onContinue ? (
            <Button
              onPress={onContinue}
              isDisabled={continueDisabled || busy}
              testID="onboarding-continue"
            >
              <Button.Label>{busy ? t`Saving…` : (continueLabel ?? t`Continue`)}</Button.Label>
            </Button>
          ) : null}
          {onSkip || onBack ? (
            <View className="flex-row flex-wrap items-center justify-center gap-2">
              {onSkip ? (
                <Button variant="ghost" onPress={onSkip} isDisabled={busy} testID="onboarding-skip">
                  <Button.Label>{t`Skip`}</Button.Label>
                </Button>
              ) : null}
              {onBack ? (
                <Button variant="ghost" onPress={onBack} isDisabled={busy} testID="onboarding-back">
                  <Button.Label>{t`Back`}</Button.Label>
                </Button>
              ) : null}
            </View>
          ) : null}
        </View>
      </KeyboardStickyView>
    </Container>
  );
}
