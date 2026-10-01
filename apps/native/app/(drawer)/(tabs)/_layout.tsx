import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useThemeColor } from "@/utils/theme";

export default function TabLayout() {
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
          title: "Cockpit",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: "Timeline",
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="body"
        options={{
          title: "Body",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="body-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
