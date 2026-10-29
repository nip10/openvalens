import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Info } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/bloom";
import { useCloudAccess, writesPaused } from "@/lib/cloud-access";

/**
 * Issue #298 — a neutral notice when the OpenValens Cloud workspace in use is
 * read-only. Deliberately informational only: no amount, no call to action
 * to pay and no link out of the app (App Store Review Guideline 3.1.3(f));
 * a guard test in `scripts/` checks that. The only link is to the
 * in-app export screen. Renders nothing on self-host or with full access.
 */
export function CloudAccessNotice() {
  const { t } = useLingui();
  const access = useCloudAccess();
  if (!writesPaused(access.data)) return null;
  const member = access.data?.viewer === "member";
  return (
    <View
      className="flex-row items-start gap-2.5 rounded-2xl bg-paper-2 px-4 py-3"
      testID="cloud-access-notice"
      accessibilityRole="summary"
    >
      <Icon icon={Info} size={16} />
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-sm text-ink-2">
          {member
            ? t`This workspace's OpenValens Cloud access has ended. Its records are still here, and you can export them.`
            : t`Your OpenValens Cloud access has ended. Your records are still here, and you can export them.`}
        </Text>
        <Text className="font-sans text-sm text-ink-3">
          {t`Health sync is paused until access is back.`}
        </Text>
        <Pressable onPress={() => router.push("/exports")} accessibilityRole="link" hitSlop={8}>
          <Text className="font-sans text-sm font-semibold text-signal">{t`Export records`}</Text>
        </Pressable>
      </View>
    </View>
  );
}
