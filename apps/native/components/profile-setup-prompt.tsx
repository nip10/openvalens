import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  describeProfileSaveError,
  nextSetupSection,
  SECTION_TITLES,
  setupProgress,
  shouldOfferSetup,
  wellnessProfileQueryKey,
} from "@openvalens/api/presenters/wellness-profile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "heroui-native";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

/**
 * Issue #98 — optional setup prompt on the cockpit (parity with the web
 * dashboard card). Hidden while loading or on error; "Not now" records a skip.
 */
export function ProfileSetupPrompt() {
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
  const { t, i18n } = useLingui();
  const skip = useMutation({
    mutationFn: (revision: number) =>
      client.profile.update({ expectedRevision: revision, setupStatus: "skipped" }),
    onSuccess: (next) => queryClient.setQueryData(wellnessProfileQueryKey(userId), next),
    onError: (e) => setError(describeProfileSaveError(e).message),
  });

  const snapshot = profile.data;
  if (!snapshot || !shouldOfferSetup(snapshot)) return null;
  const progress = setupProgress(snapshot);
  const next = nextSetupSection(snapshot);
  const started = snapshot.setupStatus === "in_progress";

  return (
    <CardStack
      title={started ? t`Continue setting up (optional)` : t`Set up your profile (optional)`}
    >
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-sm text-foreground">
          <Trans>
            A few optional questions so the app can show what matters to you. Skip any of them —
            everything else works without them.
          </Trans>
          {started ? (
            <>
              {" "}
              <Trans>
                {progress.answered} of {progress.available} sections answered.
              </Trans>
            </>
          ) : null}
        </Text>
        <View className="flex-row flex-wrap gap-3">
          <Button onPress={() => router.push("/profile")}>
            <Button.Label>
              {started && next ? t`Continue: ${i18n._(SECTION_TITLES[next])}` : t`Start`}
            </Button.Label>
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
          <Text className="text-sm text-destructive" accessibilityRole="alert">
            {i18n._(error)}
          </Text>
        ) : null}
      </Card>
    </CardStack>
  );
}
