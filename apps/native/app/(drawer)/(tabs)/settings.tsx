import { Ionicons } from "@expo/vector-icons";
import { Card, Chip } from "heroui-native";
import { useThemeColor } from "@/utils/theme";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { useAppTheme } from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

export default function SettingsScreen() {
  const { isDark, toggleTheme } = useAppTheme();
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const { data: session } = authClient.useSession();

  const foreground = useThemeColor("foreground");

  const handleSignOut = () => {
    void authClient.signOut();
    void queryClient.invalidateQueries();
  };

  return (
    <Container className="p-4">
      <View className="gap-6">
        {session?.user && (
          <CardStack title="Account">
            <Card variant="secondary" className="p-4">
              <Text className="text-base text-foreground">
                {session.user.name ?? session.user.email}
              </Text>
              {session.user.email && (
                <Text className="font-mono text-sm text-muted-foreground">{session.user.email}</Text>
              )}
            </Card>
          </CardStack>
        )}

        <CardStack title="Preferences">
          <Card variant="secondary" className="overflow-hidden p-0">
            <ListRow
              icon={<Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={foreground} />}
              title="Dark mode"
              subtitle={isDark ? "On" : "Off"}
              onPress={toggleTheme}
              trailing={
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{isDark ? "On" : "Off"}</Chip.Label>
                </Chip>
              }
            />
            <ListRow
              icon={<Ionicons name="list-outline" size={20} color={foreground} />}
              title="Compact density"
              subtitle={density === "compact" ? "On" : "Off"}
              onPress={() => setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"))}
              trailing={
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{density}</Chip.Label>
                </Chip>
              }
            />
          </Card>
        </CardStack>

        <Pressable
          onPress={handleSignOut}
          className="min-h-14 items-center justify-center rounded-lg bg-destructive active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text className="font-medium text-destructive-foreground">Sign out</Text>
        </Pressable>
      </View>
    </Container>
  );
}
