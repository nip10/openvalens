import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "heroui-native";
import { Alert, Pressable, Switch, Text, View } from "react-native";

import { orpc } from "@/utils/orpc";

/**
 * AI settings: the workspace switch (only the owner can change it; the server
 * enforces this) and this person's own AI consent. AI runs only when both are
 * on.
 */
export function AiSection() {
  const queryClient = useQueryClient();
  const { t } = useLingui();
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
    <Card className="gap-3 p-4">
      <Text className="text-base font-semibold text-foreground">
        <Trans>AI for this workspace</Trans>
      </Text>
      <Text className="text-sm leading-5 text-muted-foreground">
        <Trans comment="safety">
          The workspace owner decides whether AI features can be used in this workspace. When it is
          on, each person still has to give their own consent below before AI processes their data.
        </Trans>
      </Text>
      <View className="min-h-12 flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="text-sm text-foreground">
            {workspace.isPending
              ? t`Loading…`
              : workspaceOn
                ? t({ message: "On for this workspace", comment: "safety" })
                : t({ message: "Off for this workspace", comment: "safety" })}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {canManage
              ? t`As the owner, you can change this.`
              : t`Only the workspace owner can change this.`}
          </Text>
        </View>
        <Switch
          accessibilityLabel={workspaceLabel}
          value={workspaceOn}
          disabled={!canManage || setWorkspace.isPending}
          onValueChange={(enabled) => setWorkspace.mutate({ enabled })}
        />
      </View>

      <Text className="pt-2 text-base font-semibold text-foreground">
        <Trans>AI processing</Trans>
      </Text>
      <Text className="text-sm leading-5 text-muted-foreground">
        <Trans comment="safety">
          AI features are opt-in and revocable. This setting applies only to you and is independent
          of your organization or owner role.
        </Trans>
      </Text>
      <View className="min-h-12 flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-sm text-foreground">
          {personal.isPending
            ? t`Loading…`
            : granted
              ? t({ message: "Granted", comment: "safety" })
              : t({ message: "Not granted", comment: "safety" })}
        </Text>
        <Switch
          accessibilityLabel={personalLabel}
          value={granted}
          disabled={personal.isPending || grant.isPending || revoke.isPending}
          onValueChange={(next) => (next ? grant.mutate({}) : confirmRevoke())}
        />
      </View>

      {failed && (
        <View className="gap-1">
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            <Trans>Could not load or update AI settings.</Trans>
          </Text>
          <Pressable
            onPress={() => {
              void workspace.refetch();
              void personal.refetch();
            }}
            accessibilityRole="button"
            className="min-h-11 justify-center"
          >
            <Text className="text-foreground underline">
              <Trans>Retry</Trans>
            </Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}
