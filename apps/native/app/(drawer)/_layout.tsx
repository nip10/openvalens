import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link, usePathname } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { cn } from "heroui-native";
import {
  CalendarHeart,
  ChefHat,
  Dumbbell,
  FileDown,
  FlaskConical,
  Footprints,
  Gauge,
  HeartPulse,
  History,
  LayoutDashboard,
  Leaf,
  Library,
  Lock,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquareText,
  Moon,
  PersonStanding,
  Pill,
  Scale,
  Settings,
  ShieldCheck,
  User,
  Users,
  UtensilsCrossed,
} from "lucide-react-native";
import React, { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BloomMark } from "@/components/bloom";
import { DISPLAY_FONT } from "@/components/fonts";
import { ThemeToggle } from "@/components/theme-toggle";
import { isRouteVisible } from "@/lib/modules/routes";
import { useModules } from "@/lib/modules/use-modules";
import { useThemeColor } from "@/utils/theme";

type DrawerItem = {
  label: MessageDescriptor;
  href:
    | "/(drawer)/(tabs)"
    | "/(drawer)/(tabs)/nutrition"
    | "/scores"
    | "/preventive-care"
    | "/supplements"
    | "/micronutrients"
    | "/recipe-drafts"
    | "/food-draft"
    | "/timeline"
    | "/records/sleep"
    | "/records/activity"
    | "/records/vitals"
    | "/private-measurements"
    | "/cycle"
    | "/body-map"
    | "/body"
    | "/records/labs"
    | "/workouts"
    | "/exercise-library"
    | "/exports"
    | "/coach"
    | "/sharing"
    | "/invitations"
    | "/profile"
    | "/settings";
  icon: LucideIcon;
};

/**
 * The drawer, grouped like the web sidebar by what someone came to do:
 * Today, My body, Habits, More. Every destination keeps its place.
 */
const DRAWER_GROUPS: readonly { label: MessageDescriptor; items: readonly DrawerItem[] }[] = [
  {
    label: msg`Today`,
    items: [
      { label: msg`Cockpit`, href: "/(drawer)/(tabs)", icon: LayoutDashboard },
      { label: msg`Coach`, href: "/coach", icon: MessageCircle },
      { label: msg`Scores`, href: "/scores", icon: Gauge },
      { label: msg`Preventive care`, href: "/preventive-care", icon: ShieldCheck },
    ],
  },
  {
    label: msg`My body`,
    items: [
      { label: msg`Sleep`, href: "/records/sleep", icon: Moon },
      { label: msg`Activity`, href: "/records/activity", icon: Footprints },
      { label: msg`Vitals`, href: "/records/vitals", icon: HeartPulse },
      { label: msg`Body`, href: "/body", icon: Scale },
      { label: msg`Labs`, href: "/records/labs", icon: FlaskConical },
      { label: msg`Cycle`, href: "/cycle", icon: CalendarHeart },
      { label: msg`Body map`, href: "/body-map", icon: PersonStanding },
      { label: msg`Private measurements`, href: "/private-measurements", icon: Lock },
      { label: msg`Timeline`, href: "/timeline", icon: History },
    ],
  },
  {
    label: msg`Habits`,
    items: [
      { label: msg`Meal diary`, href: "/(drawer)/(tabs)/nutrition", icon: UtensilsCrossed },
      { label: msg`Describe a meal`, href: "/food-draft", icon: MessageSquareText },
      { label: msg`Recipe draft`, href: "/recipe-drafts", icon: ChefHat },
      { label: msg`Micronutrients`, href: "/micronutrients", icon: Leaf },
      { label: msg`Workouts`, href: "/workouts", icon: Dumbbell },
      { label: msg`Exercise library`, href: "/exercise-library", icon: Library },
      { label: msg`Supplements`, href: "/supplements", icon: Pill },
    ],
  },
  {
    label: msg`More`,
    items: [
      { label: msg`Clinical export`, href: "/exports", icon: FileDown },
      { label: msg`Sharing`, href: "/sharing", icon: Users },
      { label: msg`Invitations`, href: "/invitations", icon: Mail },
      { label: msg`Profile`, href: "/profile", icon: User },
      { label: msg`Settings`, href: "/settings", icon: Settings },
    ],
  },
];

/** Header title per route; anything else is the Cockpit. */
const HEADER_TITLES: Readonly<Record<string, MessageDescriptor>> = {
  "/timeline": msg`Timeline`,
  "/body": msg`Body`,
  "/coach": msg`Coach`,
  "/sharing": msg`Sharing`,
  "/profile": msg`Profile`,
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
  "/settings/devices": msg`Devices`,
  "/settings/modules": msg`Modules`,
  "/scores": msg`Scores`,
  "/invitations": msg`Invitations`,
  "/preventive-care": msg`Preventive care`,
};

function DrawerContent() {
  const pathname = usePathname();
  const { _ } = useLingui();
  const insets = useSafeAreaInsets();
  const ink3 = useThemeColor("ink-3");
  const signal = useThemeColor("signal");
  const sidebar = useThemeColor("sidebar");
  // Onboarding stage 1: a hidden module leaves the drawer (its screens still
  // open from a link). Everything shows while the profile loads.
  const { enabled } = useModules();

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: sidebar,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 16,
      }}
      accessibilityRole="menu"
    >
      <View className="flex-row items-center gap-2.5 px-5 pb-5">
        <BloomMark size={30} />
        <Text className="font-display text-2xl font-semibold text-ink">OpenValens</Text>
      </View>

      <View className="gap-5 px-3">
        {DRAWER_GROUPS.map((group) => ({
          ...group,
          items: group.items.filter((item) => isRouteVisible(item.href, enabled)),
        }))
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <View key={group.label.id} className="gap-0.5">
              <Text
                className="px-3 pb-1 font-sans text-[13px] font-semibold text-ink-3"
                accessibilityRole="header"
              >
                {_(group.label)}
              </Text>
              {group.items.map((item) => {
                // The Cockpit tab lives at "/" too; its href names the tabs group so it is
                // not confused with the sign-in screen at (drawer)/index.
                const active =
                  pathname === item.href || (item.href === "/(drawer)/(tabs)" && pathname === "/");
                const ItemIcon = item.icon;
                return (
                  <Link key={item.href} href={item.href} asChild>
                    <Pressable
                      className={cn(
                        "min-h-11 flex-row items-center gap-3 rounded-2xl px-3 py-2.5 active:bg-paper-2",
                        active && "bg-sidebar-accent",
                      )}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={_(item.label)}
                    >
                      <ItemIcon size={19} color={active ? signal : ink3} strokeWidth={2} />
                      <Text
                        className={cn(
                          "font-sans text-[15px]",
                          active
                            ? "font-semibold text-sidebar-accent-foreground"
                            : "font-medium text-ink-2",
                        )}
                      >
                        {_(item.label)}
                      </Text>
                    </Pressable>
                  </Link>
                );
              })}
            </View>
          ))}
      </View>
    </ScrollView>
  );
}

function DrawerLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const themeColorSidebar = useThemeColor("sidebar");
  const pathname = usePathname();

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  const { _ } = useLingui();
  // A conversation lives at /coach/<id>; its bar reads "Coach" too.
  const titleKey = pathname.startsWith("/coach/") ? "/coach" : pathname;
  const headerTitle = _(HEADER_TITLES[titleKey] ?? msg`Cockpit`);

  return (
    <Drawer
      initialRouteName="(tabs)"
      drawerContent={() => <DrawerContent />}
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: {
          fontFamily: DISPLAY_FONT,
          fontWeight: "600",
          fontSize: 19,
          color: themeColorForeground,
        },
        headerShadowVisible: false,
        headerRight: renderThemeToggle,
        drawerStyle: { backgroundColor: themeColorSidebar },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          // The welcome screen carries its own wordmark; no bar title.
          headerTitle: "",
          drawerItemStyle: { display: "none" },
        }}
      />
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
        name="coach/index"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="coach/[conversationId]"
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
        name="settings/devices"
        options={{
          headerTitle,
          drawerItemStyle: { display: "none" },
        }}
      />
      <Drawer.Screen
        name="settings/modules"
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
