import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import { History, LayoutDashboard, Scale, Settings } from "lucide-react-native";

import { BODY_FONT_MEDIUM, DISPLAY_FONT } from "@/components/fonts";
import { useThemeColor } from "@/utils/theme";

export default function TabLayout() {
  const { t } = useLingui();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const themeColorPrimary = useThemeColor("primary");
  const themeColorInk3 = useThemeColor("ink-3");
  const themeColorSheet = useThemeColor("sheet");
  const themeColorRule = useThemeColor("rule");

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
          fontFamily: DISPLAY_FONT,
          fontWeight: "600",
        },
        tabBarStyle: {
          backgroundColor: themeColorSheet,
          borderTopColor: themeColorRule,
        },
        tabBarLabelStyle: { fontFamily: BODY_FONT_MEDIUM, fontWeight: "500", fontSize: 11 },
        tabBarActiveTintColor: themeColorPrimary,
        tabBarInactiveTintColor: themeColorInk3,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t`Cockpit`,
          tabBarIcon: ({ color, size }) => <LayoutDashboard size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: t`Timeline`,
          tabBarIcon: ({ color, size }) => <History size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="body"
        options={{
          title: t`Body`,
          tabBarIcon: ({ color, size }) => <Scale size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t`Settings`,
          tabBarIcon: ({ color, size }) => <Settings size={size - 2} color={color} />,
        }}
      />
    </Tabs>
  );
}
