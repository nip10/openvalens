import { Ionicons } from "@expo/vector-icons";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link, usePathname } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { cn } from "heroui-native";
import React, { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";
import { useThemeColor } from "@/utils/theme";

const DRAWER_ITEMS = [
  { label: msg`Cockpit`, href: "/" as const, icon: "home-outline" as const },
  { label: msg`Scores`, href: "/scores" as const, icon: "speedometer-outline" as const },
  {
    label: msg`Preventive care`,
    href: "/preventive-care" as const,
    icon: "shield-checkmark-outline" as const,
  },
  { label: msg`Supplements`, href: "/supplements" as const, icon: "medkit-outline" as const },
  { label: msg`Meal diary`, href: "/nutrition" as const, icon: "restaurant-outline" as const },
  {
    label: msg`Micronutrients`,
    href: "/micronutrients" as const,
    icon: "nutrition-outline" as const,
  },
  {
    label: msg`Recipe draft`,
    href: "/recipe-drafts" as const,
    icon: "document-text-outline" as const,
  },
  { label: msg`Describe a meal`, href: "/food-draft" as const, icon: "mic-outline" as const },
  { label: msg`Timeline`, href: "/timeline" as const, icon: "time-outline" as const },
  { label: msg`Sleep`, href: "/records/sleep" as const, icon: "moon-outline" as const },
  { label: msg`Activity`, href: "/records/activity" as const, icon: "walk-outline" as const },
  { label: msg`Vitals`, href: "/records/vitals" as const, icon: "pulse-outline" as const },
  {
    label: msg`Private measurements`,
    href: "/private-measurements" as const,
    icon: "lock-closed-outline" as const,
  },
  { label: msg`Cycle`, href: "/cycle" as const, icon: "calendar-outline" as const },
  { label: msg`Body map`, href: "/body-map" as const, icon: "body-outline" as const },
  { label: msg`Labs`, href: "/records/labs" as const, icon: "flask-outline" as const },
  { label: msg`Workouts`, href: "/workouts" as const, icon: "barbell-outline" as const },
  {
    label: msg`Exercise library`,
    href: "/exercise-library" as const,
    icon: "fitness-outline" as const,
  },
  { label: msg`Clinical export`, href: "/exports" as const, icon: "download-outline" as const },
  { label: msg`Coach`, href: "/coach" as const, icon: "chatbubbles-outline" as const },
  { label: msg`Sharing`, href: "/sharing" as const, icon: "people-outline" as const },
  { label: msg`Invitations`, href: "/invitations" as const, icon: "mail-outline" as const },
  { label: msg`Profile`, href: "/profile" as const, icon: "person-outline" as const },
  { label: msg`Settings`, href: "/settings" as const, icon: "settings-outline" as const },
];

/** Header title per route; anything else is the Cockpit. */
const HEADER_TITLES: Readonly<Record<string, MessageDescriptor>> = {
  "/timeline": msg`Timeline`,
  "/records/sleep": msg`Sleep`,
  "/records/activity": msg`Activity`,
  "/records/vitals": msg`Vitals`,
  "/private-measurements": msg`Private measurements`,
  "/cycle": msg`Cycle`,
  "/body-map": msg`Body map`,
  "/records/labs": msg`Labs`,
  "/supplements": msg`Supplements`,
  "/nutrition": msg`Meal diary`,
  "/micronutrients": msg`Micronutrients`,
  "/nutrition-targets": msg`Nutrition targets`,
  "/recipe-drafts": msg`Recipe draft`,
  "/food-draft": msg`Describe a meal`,
  "/foods": msg`My foods`,
  "/workouts": msg`Workouts`,
  "/exercise-library": msg`Exercise library`,
  "/exports": msg`Clinical export`,
  "/settings": msg`Settings`,
  "/scores": msg`Scores`,
  "/invitations": msg`Invitations`,
  "/preventive-care": msg`Preventive care`,
};

function DrawerContent() {
  const pathname = usePathname();
  const { _ } = useLingui();
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
                accessibilityLabel={_(item.label)}
              >
                <Ionicons name={item.icon} size={20} color={active ? primary : foreground} />
                <Text
                  className={cn(
                    "text-base",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {_(item.label)}
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

  const { _ } = useLingui();
  const headerTitle = _(HEADER_TITLES[pathname] ?? msg`Cockpit`);

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
        name="cycle"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="body-map"
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
        name="micronutrients"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="recipe-drafts"
        options={{ headerTitle, drawerItemStyle: { display: "none" } }}
      />
      <Drawer.Screen
        name="food-draft"
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
        name="exercise-library"
        options={{ headerTitle, drawerItemStyle: { display: "none" } }}
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
