import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_LABELS,
  MODULE_TONES,
  MODULES_KEEP_DATA_NOTE,
  PERSON_MODULES,
  toggleModule,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import {
  describeProfileSaveError,
  wellnessProfileQueryKey,
} from "@openvalens/api/presenters/wellness-profile";
import type { WellnessProfileSnapshot } from "@openvalens/api/wellness-profile-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { ErrorState, Page, PageHeader, Prose, Sheet, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";
import { rememberSyncModules } from "@/lib/health-sync";
import { MODULE_ICON_COMPONENTS } from "@/lib/modules/icons";
import { useModules } from "@/lib/modules/use-modules";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Onboarding stage 1 — Settings › Modules. One card per module with a switch.
 * Hiding a module removes it from the drawer, tabs, Cockpit, insights and
 * reminders, and stops phone sync of its data types; stored data is kept.
 * Saves the whole choice on the wellness profile (`enabledModules`).
 */
export default function ModulesScreen() {
  const { t } = useLingui();
  const { profile } = useModules();

  return (
    <Container>
      <Page>
        <PageHeader
          title={t`Modules`}
          description={t`Choose the parts of the app you want to see.`}
        />
        {profile.isPending ? (
          <>
            <Sheet className="h-20" />
            <Sheet className="h-20" />
            <Sheet className="h-20" />
          </>
        ) : profile.isError || !profile.data ? (
          <ErrorState
            title={<Trans>Could not load your modules. Nothing has changed.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void profile.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        ) : (
          <ModuleList snapshot={profile.data} reload={() => void profile.refetch()} />
        )}
      </Page>
    </Container>
  );
}

function ModuleList({
  snapshot,
  reload,
}: {
  snapshot: WellnessProfileSnapshot;
  reload: () => void;
}) {
  const { i18n } = useLingui();
  const { userId } = useModules();
  const queryClient = useQueryClient();
  const signal = useThemeColor("signal");
  const [error, setError] = useState<MessageDescriptor | null>(null);

  const update = useMutation({
    mutationFn: (enabledModules: PersonModule[]) =>
      client.profile.update({ expectedRevision: snapshot.revision, enabledModules }),
    onSuccess: (next) => {
      queryClient.setQueryData(wellnessProfileQueryKey(userId), next);
      void rememberSyncModules(next.enabledModules);
    },
  });

  const toggle = async (module: PersonModule, on: boolean) => {
    setError(null);
    try {
      await update.mutateAsync(toggleModule(snapshot, module, on));
    } catch (failure) {
      const described = describeProfileSaveError(failure);
      if (described.kind === "conflict") reload();
      setError(described.message);
    }
  };

  return (
    <View className="gap-3">
      <Prose>{i18n._(MODULES_KEEP_DATA_NOTE)}</Prose>
      {error ? (
        <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
          {i18n._(error)}
        </Text>
      ) : null}
      {PERSON_MODULES.map((module) => {
        const label = i18n._(MODULE_LABELS[module]);
        const on = snapshot.enabledModules === null || snapshot.enabledModules.includes(module);
        return (
          <Sheet key={module} className="flex-row items-center gap-3">
            <ToneIcon
              icon={MODULE_ICON_COMPONENTS[MODULE_ICONS[module]]}
              tone={MODULE_TONES[module]}
            />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="font-sans text-base font-semibold text-ink">{label}</Text>
              <Text className="font-sans text-sm text-ink-3">
                {i18n._(MODULE_DESCRIPTIONS[module])}
              </Text>
            </View>
            <Switch
              testID={`module-switch-${module}`}
              value={on}
              disabled={update.isPending}
              onValueChange={(next) => void toggle(module, next)}
              accessibilityLabel={label}
              accessibilityState={{ checked: on, disabled: update.isPending }}
              trackColor={{ true: signal }}
            />
          </Sheet>
        );
      })}
    </View>
  );
}
