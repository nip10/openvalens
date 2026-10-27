import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Meter, Page, PageHeader } from "@/components/bloom";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { useLocalOnboardingProgress } from "@/lib/onboarding/local-progress";
import {
  canSkip,
  nextStep,
  ONBOARDING_STEPS,
  previousStep,
  SERVER_STEP,
  STEP_TITLES,
  stepIndex,
  type OnboardingRoute,
  type OnboardingStep,
} from "@/lib/onboarding/steps";
import { client, orpc } from "@/utils/orpc";

/** Opens one onboarding step (each step is its own screen in the stack). */
export function openStep(step: OnboardingRoute) {
  router.push({ pathname: "/onboarding/[step]", params: { step } });
}

/** Leaves onboarding for the Cockpit, popping back to it when it is underneath. */
export function leaveOnboarding() {
  router.dismissTo("/(drawer)/(tabs)");
}

/**
 * What every step screen shares: the profile snapshot, saving a partial
 * update with `expectedRevision` (setup marked in progress on the first
 * save), and moving forward or back.
 */
export function useOnboardingFlow(step: OnboardingRoute) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const profile = useQuery({
    ...orpc.profile.get.queryOptions({ input: {} }),
    queryKey: [...wellnessProfileQueryKey(userId)],
    enabled: !!userId,
    retry: 1,
  });
  const local = useLocalOnboardingProgress(userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);

  const update = useMutation({
    mutationFn: (input: WellnessProfileUpdateInput) => client.profile.update(input),
    onSuccess: (next) => queryClient.setQueryData(wellnessProfileQueryKey(userId), next),
  });

  /** Saves a patch (without `expectedRevision`); `false` when it failed (the error shows). */
  const save = async (
    patch: Omit<WellnessProfileUpdateInput, "expectedRevision">,
  ): Promise<WellnessProfileSnapshot | false> => {
    const snapshot = profile.data;
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

  const goNext = () => {
    void local.markVisited(step);
    const next = nextStep(step);
    if (next) openStep(next);
  };

  const goBack = () => {
    const previous = previousStep(step);
    if (previous) router.dismissTo({ pathname: "/onboarding/[step]", params: { step: previous } });
    else leaveOnboarding();
  };

  return {
    userId,
    profile,
    snapshot: profile.data,
    local,
    save,
    saving: update.isPending,
    error,
    setError,
    goNext,
    goBack,
  };
}

/**
 * One step on its own screen: the progress bar and "Step 3 of 8", the step's
 * head, its content, then Continue (the one filled button), Skip and Back.
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
  extraActions,
}: {
  step: OnboardingRoute;
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  children?: ReactNode;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  busy?: boolean;
  error?: MessageDescriptor | null;
  onSkip?: () => void;
  onBack?: () => void;
  extraActions?: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const insets = useSafeAreaInsets();
  const index = step === SERVER_STEP ? -1 : stepIndex(step as OnboardingStep);
  const total = ONBOARDING_STEPS.length;
  const stepTitle = step === SERVER_STEP ? null : i18n._(STEP_TITLES[step as OnboardingStep]);
  const position = index + 1;

  return (
    <Container scrollViewProps={{ contentInsetAdjustmentBehavior: "never" }}>
      <View style={{ paddingTop: insets.top }}>
        <Page>
          <View className="gap-2">
            <Meter
              value={step === SERVER_STEP ? 0 : index / (total - 1)}
              tone="signal"
              label={t`Setup progress`}
            />
            <Text className="font-sans text-sm text-ink-3">
              {stepTitle ? (
                <Trans>
                  Step {position} of {total}: {stepTitle}
                </Trans>
              ) : (
                <Trans>Before your own setup</Trans>
              )}
            </Text>
          </View>
          <PageHeader title={title} description={description} info={info} />
          {children}
          {error ? (
            <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
              {i18n._(error)}
            </Text>
          ) : null}
          <View className="flex-row flex-wrap items-center gap-2">
            <Button
              onPress={onContinue}
              isDisabled={continueDisabled || busy}
              testID="onboarding-continue"
            >
              <Button.Label>{busy ? t`Saving…` : (continueLabel ?? t`Continue`)}</Button.Label>
            </Button>
            {onSkip && canSkip(step) ? (
              <Button variant="ghost" onPress={onSkip} isDisabled={busy} testID="onboarding-skip">
                <Button.Label>{t`Skip`}</Button.Label>
              </Button>
            ) : null}
            {onBack ? (
              <Button variant="ghost" onPress={onBack} isDisabled={busy} testID="onboarding-back">
                <Button.Label>{t`Back`}</Button.Label>
              </Button>
            ) : null}
            {extraActions}
          </View>
        </Page>
      </View>
    </Container>
  );
}
