import { useLingui } from "@lingui/react";
import {
  MODULE_HIDDEN_LINK,
  MODULE_HIDDEN_NOTE,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import { router } from "expo-router";
import { EyeOff } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/bloom";
import { useModuleEnabled } from "@/lib/modules/use-modules";

/**
 * Onboarding stage 1 — a small note at the top of a hidden module's screen.
 * The screen still works from a direct link; nothing is deleted. Renders
 * nothing while the module is on (or the profile is still loading).
 */
export function ModuleHiddenNote({ module }: { module: PersonModule }) {
  const enabled = useModuleEnabled(module);
  const { _ } = useLingui();
  if (enabled) return null;
  return (
    <View
      className="flex-row items-start gap-2.5 rounded-2xl bg-paper-2 px-4 py-3"
      testID={`module-hidden-note-${module}`}
    >
      <Icon icon={EyeOff} size={16} />
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-sm text-ink-2">{_(MODULE_HIDDEN_NOTE)}</Text>
        <Pressable
          onPress={() => router.push("/settings/modules")}
          accessibilityRole="link"
          hitSlop={8}
        >
          <Text className="font-sans text-sm font-semibold text-signal">
            {_(MODULE_HIDDEN_LINK)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
