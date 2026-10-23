import { Ionicons } from "@expo/vector-icons";
import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import { useThemeColor } from "@/utils/theme";

export default function TabLayout() {
  const { t } = useLingui();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const themeColorPrimary = useThemeColor("primary");
  const themeColorMutedForeground = useThemeColor("muted-foreground");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        headerStyle: {
          backgroundColor: themeColorBackground,
        },
        headerTintColor: themeColorForeground,
        headerTitleStyle: {
          color: themeColorForeground,
          fontWeight: "600",
        },
        tabBarStyle: {
          backgroundColor: themeColorBackground,
        },
        tabBarActiveTintColor: themeColorPrimary,
        tabBarInactiveTintColor: themeColorMutedForeground,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t`Cockpit`,
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: t`Timeline`,
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="body"
        options={{
          title: t`Body`,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="body-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t`Settings`,
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
