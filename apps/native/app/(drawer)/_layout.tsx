import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { cn } from "heroui-native";
import React, { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";
import { useThemeColor } from "@/utils/theme";

const DRAWER_ITEMS = [
  { label: "Cockpit", href: "/" as const, icon: "home-outline" as const },
  { label: "Scores", href: "/scores" as const, icon: "speedometer-outline" as const },
  {
    label: "Preventive care",
    href: "/preventive-care" as const,
    icon: "shield-checkmark-outline" as const,
  },
  { label: "Supplements", href: "/supplements" as const, icon: "medkit-outline" as const },
  { label: "Meal diary", href: "/nutrition" as const, icon: "restaurant-outline" as const },
  { label: "Timeline", href: "/timeline" as const, icon: "time-outline" as const },
  { label: "Sleep", href: "/records/sleep" as const, icon: "moon-outline" as const },
  { label: "Activity", href: "/records/activity" as const, icon: "walk-outline" as const },
  { label: "Vitals", href: "/records/vitals" as const, icon: "pulse-outline" as const },
  {
    label: "Private measurements",
    href: "/private-measurements" as const,
    icon: "lock-closed-outline" as const,
  },
  { label: "Labs", href: "/records/labs" as const, icon: "flask-outline" as const },
  { label: "Workouts", href: "/workouts" as const, icon: "barbell-outline" as const },
  { label: "Clinical export", href: "/exports" as const, icon: "download-outline" as const },
  { label: "Coach", href: "/coach" as const, icon: "chatbubbles-outline" as const },
  { label: "Sharing", href: "/sharing" as const, icon: "people-outline" as const },
  { label: "Invitations", href: "/invitations" as const, icon: "mail-outline" as const },
  { label: "Profile", href: "/profile" as const, icon: "person-outline" as const },
  { label: "Settings", href: "/settings" as const, icon: "settings-outline" as const },
];

function DrawerContent() {
  const pathname = usePathname();
  const foreground = useThemeColor("foreground");
  const primary = useThemeColor("primary");
  const background = useThemeColor("background");

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, backgroundColor: background }}
      accessibilityRole="menu"
    >
      <View className="px-4 pb-4 pt-2">
        <Text className="text-2xl font-semibold text-foreground">OpenValens</Text>
      </View>

      <View className="mt-2">
        {DRAWER_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} asChild>
              <Pressable
                className={cn(
                  "flex-row items-center gap-3 px-4 py-3 active:opacity-70",
                  active && "bg-accent",
                )}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
              >
                <Ionicons name={item.icon} size={20} color={active ? primary : foreground} />
                <Text
                  className={cn(
                    "text-base",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </ScrollView>
  );
}

function DrawerLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const pathname = usePathname();

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  const headerTitle =
    pathname === "/timeline"
      ? "Timeline"
      : pathname === "/records/sleep"
        ? "Sleep"
        : pathname === "/records/activity"
          ? "Activity"
          : pathname === "/records/vitals"
            ? "Vitals"
            : pathname === "/private-measurements"
              ? "Private measurements"
              : pathname === "/records/labs"
                ? "Labs"
                : pathname === "/supplements"
                ? "Supplements"
                : pathname === "/nutrition"
                  ? "Meal diary"
                    : pathname === "/nutrition-targets"
                      ? "Nutrition targets"
                      : pathname === "/foods"
                        ? "My foods"
                        : pathname === "/workouts"
                          ? "Workouts"
                          : pathname === "/exports"
                            ? "Clinical export"
                            : pathname === "/settings"
                              ? "Settings"
                              : pathname === "/scores"
                                ? "Scores"
                                : pathname === "/invitations"
                                  ? "Invitations"
                                  : pathname === "/preventive-care"
                                    ? "Preventive care"
                                    : "Cockpit";

  return (
    <Drawer
      initialRouteName="(tabs)"
      drawerContent={() => <DrawerContent />}
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: {
          fontWeight: "600",
          color: themeColorForeground,
        },
        headerRight: renderThemeToggle,
        drawerStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          headerTitle,
          drawerLabel: () => null,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="records/sleep"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="records/activity"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="records/vitals"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="records/labs"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="private-measurements"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="supplements"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="nutrition"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="nutrition-targets"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="foods"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="exports"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="workouts"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="coach"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="sharing"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="invitations"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="scores"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="preventive-care"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="insight-settings"
        options={{
          headerTitle: "Insight notifications",
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="profile"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="settings/telegram"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="admin/settings"
        options={{
          headerTitle: "Instance configuration",
          drawerItemStyle: { display: "none" },
        }}
      />
    </Drawer>
  );
}

export default DrawerLayout;
