import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  canRestoreSetupCard,
  isSetupItemDone,
  SETUP_ITEM_COPY,
  SETUP_ITEMS,
  setupProgress,
  shouldShowSetupCard,
} from "@openvalens/api/presenters/onboarding";
import {
  describeProfileSaveError,
  wellnessProfileQueryKey,
} from "@openvalens/api/presenters/wellness-profile";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, cn, useToast } from "heroui-native";
import { Check, ChevronRight, Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon, Meter, Section, Sheet } from "@/components/bloom";
import { useOnboardingFacts } from "@/components/onboarding/facts";
import { openFirstRun, openSetupItem, useHealthConsentStatus } from "@/components/onboarding/flow";
import { useIsInstanceAdmin } from "@/components/onboarding/steps";
import { authClient } from "@/lib/auth-client";
import { needsHealthConsent } from "@/lib/health-consent";
import { storeSavedProfile } from "@/lib/onboarding/profile-writes";
import { firstRunEntry, shouldOpenFirstRun } from "@/lib/onboarding/steps";
import { client, orpc } from "@/utils/orpc";

const COPY = {
  dismissed: msg`Hidden. Bring it back any time in Settings › Profile.`,
};

/** The wellness profile and a way to set `setupStatus`, for the card and its Settings row. */
function useSetupStatus() {
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
    mutationFn: (input: { revision: number; setupStatus: "completed" | "skipped" }) =>
      client.profile.update({ expectedRevision: input.revision, setupStatus: input.setupStatus }),
    onMutate: () => setError(null),
    onSuccess: (next) => storeSavedProfile(queryClient, userId, next),
    onError: (failure) => {
      const described = describeProfileSaveError(failure);
      if (described.kind === "conflict") void profile.refetch();
      setError(described.message);
    },
  });
  return { userId, profile, snapshot: profile.data, update, error };
}

/**
 * Onboarding (#444) — "Finish setting up, N of 6" on Today, on the shared
 * rules: everything the first run left out (the first log and connect if
 * skipped, modules, basics, one goal, privacy), each opening its own screen.
 * Shows until every item has an answer or it is dismissed (`skipped`);
 * Settings › Profile brings it back. A new account is sent through the first
 * run from here, once; deep links to other screens are never redirected.
 */
export function FinishSetupCard() {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const { userId, snapshot, update, error } = useSetupStatus();
  const consent = useHealthConsentStatus(userId);
  const admin = useIsInstanceAdmin(userId);
  const maybe = !!snapshot && snapshot.setupStatus !== "skipped";
  const facts = useOnboardingFacts(userId, maybe);

  const opened = useRef(false);
  useEffect(() => {
    if (!snapshot || !admin.loaded || consent.isLoading) return;
    const known = { consentNeeded: consent.data ? needsHealthConsent(consent.data) : null };
    if (!shouldOpenFirstRun(snapshot, known, opened.current)) return;
    opened.current = true;
    openFirstRun(firstRunEntry(snapshot, known, { isInstanceAdmin: admin.isAdmin }));
  }, [snapshot, admin.loaded, admin.isAdmin, consent.isLoading, consent.data]);

  if (!snapshot || !maybe || !shouldShowSetupCard(snapshot, facts)) return null;
  const { done, total } = setupProgress(snapshot, facts);

  return (
    <Section
      icon={Sparkles}
      tone="signal"
      title={t`Finish setting up, ${done} of ${total}`}
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          isDisabled={update.isPending}
          onPress={() =>
            update.mutate(
              { revision: snapshot.revision, setupStatus: "skipped" },
              {
                onSuccess: () => toast.show({ variant: "default", label: i18n._(COPY.dismissed) }),
              },
            )
          }
          testID="finish-setup-dismiss"
        >
          <Button.Label>{t`Dismiss`}</Button.Label>
        </Button>
      }
    >
      <Sheet className="gap-1 p-2" testID="finish-setup">
        <View className="gap-2 px-2 pt-2">
          <Meter
            value={done / total}
            tone="signal"
            label={t`${done} of ${total} setup steps done`}
          />
          <Text className="font-sans text-sm text-ink-2">
            <Trans>Each one takes a minute. Skip anything you like.</Trans>
          </Text>
        </View>
        {SETUP_ITEMS.map((item) => {
          const itemDone = isSetupItemDone(item, snapshot, facts);
          const title = i18n._(SETUP_ITEM_COPY[item].title);
          const description = i18n._(SETUP_ITEM_COPY[item].description);
          return (
            <Pressable
              key={item}
              onPress={() => openSetupItem(item)}
              accessibilityRole="button"
              accessibilityState={{ checked: itemDone }}
              accessibilityLabel={`${title}. ${description}`}
              className="min-h-14 flex-row items-center gap-3 rounded-2xl px-2 py-2 active:opacity-70"
              testID={`finish-setup-${item}`}
            >
              <View
                className={cn(
                  "h-6 w-6 items-center justify-center rounded-full border",
                  itemDone ? "border-primary bg-primary" : "border-rule-2 bg-paper",
                )}
              >
                {itemDone ? <Icon icon={Check} size={14} color="primary-foreground" /> : null}
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <Text
                  className={cn(
                    "font-sans text-base font-semibold",
                    itemDone ? "text-ink-3" : "text-ink",
                  )}
                >
                  {title}
                </Text>
                <Text className="font-sans text-sm text-ink-3">{description}</Text>
              </View>
              <Icon icon={ChevronRight} size={18} color="ink-3" />
            </Pressable>
          );
        })}
        {error ? (
          <Text className="px-2 pb-2 font-sans text-sm text-destructive" accessibilityRole="alert">
            {i18n._(error)}
          </Text>
        ) : null}
      </Sheet>
    </Section>
  );
}

/** Whether Today's "Finish setting up" card shows, for cards that wait behind it. */
export function useSetupCardShown(snapshot: WellnessProfileSnapshot | null | undefined): boolean {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? "";
  const maybe = !!snapshot && snapshot.setupStatus !== "skipped";
  const facts = useOnboardingFacts(userId, maybe);
  return maybe && shouldShowSetupCard(snapshot, facts);
}

/** Settings › Profile: bring back a dismissed "Finish setting up" card (#444). */
export function SetupCardSetting() {
  const { t, i18n } = useLingui();
  const { snapshot, update, error } = useSetupStatus();
  if (!snapshot || !canRestoreSetupCard(snapshot)) return null;
  return (
    <Sheet className="gap-3">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-sans text-base font-semibold text-ink">
            <Trans>Finish setting up</Trans>
          </Text>
          <Text className="font-sans text-sm text-ink-3">
            <Trans>The card on Today with the setup steps you skipped.</Trans>
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          isDisabled={update.isPending}
          onPress={() => update.mutate({ revision: snapshot.revision, setupStatus: "completed" })}
          testID="finish-setup-restore"
        >
          <Button.Label>{t`Show on Today`}</Button.Label>
        </Button>
      </View>
      {error ? (
        <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
          {i18n._(error)}
        </Text>
      ) : null}
    </Sheet>
  );
}
