import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Button, useToast } from "heroui-native";
import { useEffect } from "react";
import { Linking, Text, View } from "react-native";

import { authClient } from "@/lib/auth-client";
import { useCloudAccess } from "@/lib/cloud-access";
import { requireServerUrl } from "@/lib/server/server-url";
import { queryClient } from "@/utils/orpc";

export function DemoBanner() {
  const { t } = useLingui();
  const { toast } = useToast();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        if ((event.mutation.state.error as { code?: string } | null)?.code === "DEMO_READ_ONLY")
          toast.show({
            variant: "warning",
            label: t`This is a read-only demo. Create an account to log your own data.`,
          });
      }),
    [toast, t],
  );
  const { data: session } = authClient.useSession();
  const access = useCloudAccess(!!session?.user);
  if (!access.data?.demo) return null;
  async function leave(create: boolean) {
    const result = await authClient.signOut();
    if (result.error) return;
    queryClient.clear();
    router.replace("/");
    if (create) await Linking.openURL(`${await requireServerUrl()}/signup`);
  }
  return (
    <View className="gap-1 bg-paper-2 px-4 py-2" accessibilityRole="summary">
      <Text className="font-sans text-sm text-ink-2">
        <Trans>You're exploring a read-only demo with synthetic data.</Trans>
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button variant="ghost" size="sm" onPress={() => void leave(true)}>
          <Button.Label>
            <Trans>Create your own account</Trans>
          </Button.Label>
        </Button>
        <Button variant="ghost" size="sm" onPress={() => void leave(false)}>
          <Button.Label>
            <Trans>Leave demo</Trans>
          </Button.Label>
        </Button>
      </View>
    </View>
  );
}
