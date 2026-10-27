import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  describeProfileSaveError,
  wellnessProfileQueryKey,
} from "@openvalens/api/presenters/wellness-profile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Meter, Section, Sheet } from "@/components/bloom";
import { openStep } from "@/components/onboarding/flow";
import { useIsInstanceAdmin } from "@/components/onboarding/steps";
import { authClient } from "@/lib/auth-client";
import { useLocalOnboardingProgress } from "@/lib/onboarding/local-progress";
import {
  onboardingProgress,
  resumeStep,
  shouldAutoOpenOnboarding,
  shouldShowSetupCard,
} from "@/lib/onboarding/steps";
import { client, orpc } from "@/utils/orpc";

/**
 * Onboarding stage 3 — "Finish setting up, N of 8" on the Cockpit (it
 * replaces the earlier profile setup prompt), until setup is completed or
 * dismissed. "Not now" records a skip. After the first sign-in, while modules
 * were never chosen, the Cockpit opens the flow by itself once; deep links to
 * other screens are never redirected.
 */
export function FinishSetupCard() {
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
  const admin = useIsInstanceAdmin(userId);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const { t, i18n } = useLingui();
  const skip = useMutation({
    mutationFn: (revision: number) =>
      client.profile.update({ expectedRevision: revision, setupStatus: "skipped" }),
    onSuccess: (next) => queryClient.setQueryData(wellnessProfileQueryKey(userId), next),
    onError: (e) => setError(describeProfileSaveError(e).message),
  });

  const snapshot = profile.data;
  const resume = snapshot
    ? resumeStep(snapshot, local.visited, { isInstanceAdmin: admin.isAdmin })
    : "welcome";

  const opening = useRef(false);
  useEffect(() => {
    if (opening.current || !local.loaded || !admin.loaded) return;
    if (!shouldAutoOpenOnboarding(snapshot, local.autoOpened)) return;
    opening.current = true;
    void local.markAutoOpened().then(() => openStep(resume));
  }, [snapshot, local.loaded, local.autoOpened, admin.loaded, resume, local]);

  if (!snapshot || !shouldShowSetupCard(snapshot)) return null;
  const progress = onboardingProgress(snapshot, local.visited);

  return (
    <Section
      icon={Sparkles}
      tone="signal"
      title={t`Finish setting up, ${progress.done} of ${progress.total}`}
    >
      <Sheet className="gap-4">
        <Text className="font-sans text-base leading-relaxed text-ink-2">
          <Trans>
            A few quick questions so the app shows what matters to you. Skip any of them; everything
            else works without them.
          </Trans>
        </Text>
        <Meter value={progress.done / progress.total} tone="signal" label={t`Setup progress`} />
        <View className="flex-row flex-wrap gap-3">
          <Button onPress={() => openStep(resume)} testID="finish-setup-continue">
            <Button.Label>{progress.done > 0 ? t`Continue` : t`Start`}</Button.Label>
          </Button>
          <Button
            variant="secondary"
            isDisabled={skip.isPending}
            onPress={() => {
              setError(null);
              skip.mutate(snapshot.revision);
            }}
          >
            <Button.Label>
              <Trans>Not now</Trans>
            </Button.Label>
          </Button>
        </View>
        {error ? (
          <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
            {i18n._(error)}
          </Text>
        ) : null}
      </Sheet>
    </Section>
  );
}
