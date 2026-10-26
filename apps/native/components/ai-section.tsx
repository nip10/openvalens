import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Building2, Sparkles, UserCheck } from "lucide-react-native";
import { Alert, Switch, View } from "react-native";

import { ErrorState, Section } from "@/components/bloom";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * AI settings: the workspace switch (only the owner can change it; the server
 * enforces this) and this person's own AI consent. AI runs only when both are
 * on.
 */
export function AiSection() {
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const signal = useThemeColor("signal");
  const workspace = useQuery(orpc.ai.workspaceConsent.get.queryOptions({ input: {} }));
  const personal = useQuery(orpc.ai.consent.get.queryOptions({ input: {} }));

  const setWorkspace = useMutation(
    orpc.ai.workspaceConsent.set.mutationOptions({
      onSettled: () =>
        void queryClient.invalidateQueries({ queryKey: orpc.ai.workspaceConsent.key() }),
    }),
  );
  const invalidatePersonal = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.ai.consent.key() });
  const grant = useMutation(
    orpc.ai.consent.grant.mutationOptions({ onSettled: invalidatePersonal }),
  );
  const revoke = useMutation(
    orpc.ai.consent.revoke.mutationOptions({ onSettled: invalidatePersonal }),
  );

  const workspaceOn = workspace.data?.enabled === true;
  const canManage = workspace.data?.canManage === true;
  const granted =
    personal.data != null && personal.data.granted && personal.data.revokedAt === null;
  const failed =
    workspace.isError ||
    personal.isError ||
    setWorkspace.isError ||
    grant.isError ||
    revoke.isError;

  const workspaceLabel = t({ message: "Allow AI in this workspace", comment: "safety" });
  const personalLabel = t({ message: "AI processing consent", comment: "safety" });

  const confirmRevoke = () =>
    Alert.alert(
      t({ message: "Revoke AI consent?", comment: "safety" }),
      t({
        message:
          "AI features will stop processing your data until you turn consent back on. Your existing records are not deleted.",
        comment: "safety",
      }),
      [
        { text: t`Cancel`, style: "cancel" },
        { text: t`Revoke`, style: "destructive", onPress: () => revoke.mutate({}) },
      ],
    );

  return (
    <View className="gap-7">
      <Section
        title={t`AI for this workspace`}
        icon={Sparkles}
        tone="signal"
        description={
          <Trans comment="safety">
            The workspace owner decides whether AI features can be used in this workspace. When it
            is on, each person still has to give their own consent below before AI processes their
            data.
          </Trans>
        }
      >
        <SettingsGroup>
          <SettingsRow
            icon={Building2}
            label={
              workspace.isPending
                ? t`Loading…`
                : workspaceOn
                  ? t({ message: "On for this workspace", comment: "safety" })
                  : t({ message: "Off for this workspace", comment: "safety" })
            }
            description={
              canManage
                ? t`As the owner, you can change this.`
                : t`Only the workspace owner can change this.`
            }
            trailing={
              <Switch
                accessibilityLabel={workspaceLabel}
                value={workspaceOn}
                disabled={!canManage || setWorkspace.isPending}
                onValueChange={(enabled) => setWorkspace.mutate({ enabled })}
                trackColor={{ true: signal }}
              />
            }
          />
        </SettingsGroup>
      </Section>

      <Section
        title={t`AI processing`}
        icon={Sparkles}
        tone="signal"
        description={
          <Trans comment="safety">
            AI features are opt-in and revocable. This setting applies only to you and is
            independent of your organization or owner role.
          </Trans>
        }
      >
        <SettingsGroup>
          <SettingsRow
            icon={UserCheck}
            label={
              personal.isPending
                ? t`Loading…`
                : granted
                  ? t({ message: "Granted", comment: "safety" })
                  : t({ message: "Not granted", comment: "safety" })
            }
            description={
              personal.isPending || granted
                ? undefined
                : t({
                    message: "Turn on to let AI features process your data.",
                    comment: "safety",
                  })
            }
            trailing={
              <Switch
                accessibilityLabel={personalLabel}
                value={granted}
                disabled={personal.isPending || grant.isPending || revoke.isPending}
                onValueChange={(next) => (next ? grant.mutate({}) : confirmRevoke())}
                trackColor={{ true: signal }}
              />
            }
          />
        </SettingsGroup>

        {failed && (
          <ErrorState
            title={t`Could not load or update AI settings.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  void workspace.refetch();
                  void personal.refetch();
                }}
              >
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        )}
      </Section>
    </View>
  );
}
