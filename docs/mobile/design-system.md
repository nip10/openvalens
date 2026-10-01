# Mobile Design System

## Purpose

This document adapts the web design system in `@openhealth/ui` to a React Native / Expo mobile surface. It is the single source of truth for tokens, primitives, theming, and cross-platform typography. It is intentionally implementation-agnostic enough to be reviewed before code, but concrete enough that the first components can be built directly from it.

It is paired with:

- [`design-direction.md`](./design-direction.md) — visual language, mood, and principles.
- [`tone-of-voice.md`](./tone-of-voice.md) — copy principles for all user-facing strings.
- [`foundations.md`](./foundations.md) — navigation, gestures, accessibility, motion, and offline behavior.

## Source of truth

The web system lives in `/Users/dc/orca/workspaces/health/openhealth/packages/ui/`:

- `src/styles/globals.css` — Tailwind v4 tokens (`@theme inline`), OKLCH colors, font stack, radius scale.
- `src/components/*.tsx` — 21 primitives built on top of Radix UI primitives.
- `src/hooks/use-mobile.ts` — 768 px breakpoint.
- `src/lib/utils.ts` — `cn` helper (`clsx` + `tailwind-merge`).

The mobile app lives in `/Users/dc/orca/workspaces/health/openhealth/apps/native/`:

- `global.css` — Tailwind v4 entry that imports `tailwindcss`, `uniwind`, and `heroui-native/styles`.
- `app/(drawer)/_layout.tsx` — `Drawer` from `expo-router/drawer`.
- `app/(drawer)/(tabs)/_layout.tsx` — `Tabs` from `expo-router`.
- `contexts/app-theme-context.tsx` — `AppThemeProvider` + `useAppTheme()`.
- `components/sign-in.tsx` — working example of `@tanstack/react-form` + `zod` + `heroui-native` `TextField`, `Label`, `Input`, `FieldError`, `Button`, `Spinner`, `useToast`.

The shared source of truth for color, font, and radius tokens is `packages/ui/src/styles/globals.css`. The mobile surface consumes those tokens through Tailwind v4 CSS variables, enabled by uniwind.

## Palette bridge (openhealth → mobile)

The web palette is declared in `packages/ui/src/styles/globals.css`:

1. `@theme inline { --color-background: var(--background); ... }` maps semantic names to CSS variables.
2. `:root { --background: oklch(1 0 0); ... }` and `.dark { --background: oklch(0.145 0 0); ... }` define the actual OKLCH values.

To make the mobile app use the same palette, `apps/native/global.css` should import the web global CSS:

```css
@import "tailwindcss";
@import "uniwind";
@import "heroui-native/styles";
@import "@openhealth/ui/globals.css";
```

After the import, uniwind exposes the same variables to React Native. Tailwind classes like `bg-background`, `text-foreground`, and `text-muted` resolve to the openhealth OKLCH values. heroui-native components read the same variables through `useThemeColor('foreground')`.

Verify the bridge in `apps/native/app/(drawer)/index.tsx`, which already uses `text-foreground`, `text-muted`, `bg-danger`, and `bg-success`. Once `@openhealth/ui/globals.css` is imported, those classes will resolve to the openhealth tokens rather than heroui-native’s default palette.

### Token name alignment

| openhealth token | heroui-native token | Status |
|---|---|---|
| `background`, `foreground`, `muted`, `primary`, `secondary` | same names | Bridge automatically via CSS variables. |
| `destructive` | `danger` | **Needs alias.** Either add `--color-danger: var(--destructive)` to mobile CSS, or wrap heroui-native components to map `danger` → `destructive`. |
| `success` | `success` | Bridge automatically if both define `--color-success`. Verify values match. |
| `warning`, `info` | `warning`, `info` | Verify values; heroui-native defaults may differ from the openhealth semantic palette. |
| `chart-1` … `chart-5` | — | **Not bridged.** Add explicit `--color-chart-1` … `--color-chart-5` to mobile globals, or use inline `oklch()` values in chart configs. |
| `sidebar-*` | — | **Not bridged.** Sidebar-specific tokens are only needed in the drawer; import or duplicate them in mobile globals. |
| `ring`, `border`, `input`, `accent` | same names | Bridge automatically. |

Until the bridge import is added, the app uses heroui-native’s default palette. That is the current state and the first parity task.

## Constraints carried into mobile

1. **Tokens flow through Tailwind v4 CSS variables via uniwind.** The shared source of truth is `packages/ui/src/styles/globals.css`.
2. **Self-hosted fonts.** No runtime network font loading without explicit consent.
3. **PHI-aware.** No analytics SDKs or third-party fonts that ship PII.
4. **WCAG 2.2 AA.** Touch targets ≥ 44 pt, focus/activation visible, color-independent state.
5. **Performance.** Avoid heavy runtime theme recomputation; prefer Tailwind class-driven styling.
6. **iOS + Android.** Respect platform conventions (sheets with grabbers, back gestures, safe areas, platform menus).

---

## Token spec

### Color tokens

The web system uses OKLCH values for every semantic color. On mobile those values are not compiled to hex objects; they remain CSS variables read by uniwind and heroui-native. The table below lists the web CSS variable, its source OKLCH value, how to consume it on mobile, and what it is used for.

| Web CSS variable | Source OKLCH (light / dark) | Mobile consumption | Usage |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` / `oklch(0.145 0 0)` | `bg-background` or `useThemeColor('background')` | App canvas |
| `--foreground` | `oklch(0.145 0 0)` / `oklch(0.985 0 0)` | `text-foreground` or `useThemeColor('foreground')` | Primary text |
| `--card` | `oklch(1 0 0)` / `oklch(0.205 0 0)` | `bg-card` | Card surface |
| `--card-foreground` | `oklch(0.145 0 0)` / `oklch(0.985 0 0)` | `text-card-foreground` | Text on cards |
| `--popover` | `oklch(1 0 0)` / `oklch(0.205 0 0)` | `bg-popover` | Menu / popover surface |
| `--popover-foreground` | `oklch(0.145 0 0)` / `oklch(0.985 0 0)` | `text-popover-foreground` | Text on popovers |
| `--primary` | `oklch(0.205 0 0)` / `oklch(0.922 0 0)` | `bg-primary` / `text-primary` | Primary actions / emphasis |
| `--primary-foreground` | `oklch(0.985 0 0)` / `oklch(0.205 0 0)` | `text-primary-foreground` | Text on primary |
| `--secondary` | `oklch(0.97 0 0)` / `oklch(0.269 0 0)` | `bg-secondary` | Secondary surfaces |
| `--secondary-foreground` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` | `text-secondary-foreground` | Text on secondary |
| `--muted` | `oklch(0.97 0 0)` / `oklch(0.269 0 0)` | `bg-muted` / `text-muted` | Muted backgrounds, secondary text |
| `--muted-foreground` | `oklch(0.556 0 0)` / `oklch(0.708 0 0)` | `text-muted-foreground` | Placeholder text |
| `--accent` | `oklch(0.97 0 0)` / `oklch(0.269 0 0)` | `bg-accent` | Hover / selected tint |
| `--accent-foreground` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` | `text-accent-foreground` | Text on accent |
| `--destructive` | `oklch(0.577 0.245 27.325)` / `oklch(0.704 0.191 22.216)` | `bg-destructive` / `text-destructive` (or heroui `danger`) | Errors / destructive actions |
| `--border` | `oklch(0.922 0 0)` / `oklch(1 0 0 / 10%)` | `border-border` | Dividers and outlines |
| `--input` | `oklch(0.922 0 0)` / `oklch(1 0 0 / 15%)` | `border-input` | Input borders / fill |
| `--ring` | `oklch(0.708 0 0)` / `oklch(0.556 0 0)` | `ring-ring` | Focus rings |
| `--chart-1` | `oklch(0.646 0.222 41.116)` / `oklch(0.488 0.243 264.376)` | Inline `oklch()` or `--color-chart-1` | Chart series 1 |
| `--chart-2` | `oklch(0.6 0.118 184.704)` / `oklch(0.696 0.17 162.48)` | Inline `oklch()` or `--color-chart-2` | Chart series 2 |
| `--chart-3` | `oklch(0.398 0.07 227.392)` / `oklch(0.769 0.188 70.08)` | Inline `oklch()` or `--color-chart-3` | Chart series 3 |
| `--chart-4` | `oklch(0.828 0.189 84.429)` / `oklch(0.627 0.265 303.9)` | Inline `oklch()` or `--color-chart-4` | Chart series 4 |
| `--chart-5` | `oklch(0.769 0.188 70.08)` / `oklch(0.645 0.246 16.439)` | Inline `oklch()` or `--color-chart-5` | Chart series 5 |
| `--sidebar` | `oklch(0.985 0 0)` / `oklch(0.205 0 0)` | `bg-sidebar` | Drawer surface |
| `--sidebar-foreground` | `oklch(0.145 0 0)` / `oklch(0.985 0 0)` | `text-sidebar-foreground` | Drawer text |
| `--sidebar-primary` | `oklch(0.205 0 0)` / `oklch(0.488 0.243 264.376)` | `bg-sidebar-primary` | Active nav item |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` / `oklch(0.985 0 0)` | `text-sidebar-primary-foreground` | Text on active nav item |
| `--sidebar-accent` | `oklch(0.97 0 0)` / `oklch(0.269 0 0)` | `bg-sidebar-accent` | Drawer hover tint |
| `--sidebar-accent-foreground` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` | `text-sidebar-accent-foreground` | Text on drawer hover tint |
| `--sidebar-border` | `oklch(0.922 0 0)` / `oklch(1 0 0 / 10%)` | `border-sidebar-border` | Drawer dividers |
| `--sidebar-ring` | `oklch(0.708 0 0)` / `oklch(0.556 0 0)` | `ring-sidebar-ring` | Drawer focus rings |

Translucent dark-mode tokens (`border`, `input`, `sidebar-border`) are expressed as `oklch(1 0 0 / 10%)` in the web CSS and are read by uniwind as translucent colors. When you need a raw RGBA value, use `useThemeColor` or parse the CSS variable.

A derived palette for semantic health states is used because the web system does not define `success` / `warning` / `info` tokens. These must be added to mobile globals or aligned with heroui-native defaults:

| Token | Light source | Dark source | Usage |
|---|---|---|---|
| `success` | `oklch(0.627 0.194 144.637)` | `oklch(0.723 0.219 142.495)` | In-range labs, completed goals |
| `success-foreground` | `oklch(0.985 0 0)` | `oklch(0.145 0 0)` | Text on success surfaces |
| `warning` | `oklch(0.66 0.138 95.27)` | `oklch(0.852 0.199 91.936)` | Near-limit / attention values |
| `warning-foreground` | `oklch(0.985 0 0)` | `oklch(0.145 0 0)` | Text on warning surfaces |
| `info` | `oklch(0.585 0.233 261.069)` | `oklch(0.72 0.176 254.13)` | Informational highlights |
| `info-foreground` | `oklch(0.985 0 0)` | `oklch(0.145 0 0)` | Text on info surfaces |

### Consuming tokens in code

```tsx
// 1. Tailwind className (preferred)
import { View, Text } from "react-native";

<View className="bg-background p-4 rounded-xl border border-border">
  <Text className="text-foreground font-sans">Hello</Text>
</View>;

// 2. Raw color value when a component prop requires it
import { useThemeColor } from "heroui-native";
const foreground = useThemeColor("foreground");

// 3. From the app theme context (light / dark boolean)
import { useAppTheme } from "@/contexts/app-theme-context";
const { isDark } = useAppTheme();
```

### Font tokens

| Web variable | Web value | Mobile Tailwind class | iOS fallback | Android fallback |
|---|---|---|---|---|
| `--font-sans` | `Geist Variable` | `font-sans` | `-apple-system` / `San Francisco` | `Roboto` |
| `--font-mono` | `Geist Mono Variable` | `font-mono` | `Menlo` | `Roboto Mono` |
| `--font-display` | `Cormorant Garamond` | `font-display` | `New York` / `Georgia` | `Noto Serif` / `Georgia` |

```ts
// Loaded with expo-font
export const fonts = {
  sans: "GeistVariable",
  mono: "GeistMonoVariable",
  display: "CormorantGaramond",
} as const;
```

Font files are vendored into `apps/native/assets/fonts/` and loaded with `expo-font` before the root render. See the typography section below for loading details and platform caveats.

### Type scale

The web uses a small, dense type system (`text-xs` through `text-lg` with `font-medium` and `font-semibold`). The mobile scale maps those sizes to points (pt) at 1 rem = 16 pt.

| Web size | Mobile token | Size (pt) | Line (pt) | Letter | Weight | Usage |
|---|---|---|---|---|---|---|
| `text-xs` | `text-xs` | 12 | 16 | 0 | 400 / 500 | Captions, badges, chart labels |
| `text-sm` | `text-sm` | 14 | 20 | 0 | 400 / 500 | Body small, buttons, inputs |
| `text-base` | `text-base` | 16 | 24 | 0 | 400 | Default body |
| `text-lg` | `text-lg` | 18 | 28 | -0.01 em | 500 / 600 | Dialog titles, section headers |
| `text-xl` | `text-xl` | 20 | 30 | -0.02 em | 600 | Card titles |
| `text-2xl` | `text-2xl` | 24 | 32 | -0.02 em | 600 | Display headings (sans) |
| `text-3xl` | `text-3xl` | 30 | 36 | -0.03 em | 700 | Display headings (serif) |
| `text-4xl` | `text-4xl` | 36 | 40 | -0.03 em | 700 | Large serif moments |

Cormorant Garamond is only used at `text-3xl` and above for high-level section or report headings. Geist Mono is used for all numeric data, dates, IDs, and code-like values.

On mobile these sizes are applied through Tailwind classes: `text-sm`, `text-base`, `text-lg`, etc. heroui-native text components inherit the theme font and scale automatically; use `className="text-foreground text-sm"` on plain `Text` components.

### Radius scale

Web base radius is `0.625 rem` = 10 pt. The mobile scale preserves the exact pixel values.

| Web variable | Calculation | Mobile token | Value (pt / dp) |
|---|---|---|---|
| `--radius-sm` | `base - 4` | `radii.sm` | 6 |
| `--radius-md` | `base - 2` | `radii.md` | 8 |
| `--radius-lg` | `base` | `radii.lg` | 10 |
| `--radius-xl` | `base + 4` | `radii.xl` | 14 |
| `--radius-2xl` | `base + 8` | `radii.2xl` | 18 |
| `--radius-3xl` | `base + 12` | `radii.3xl` | 22 |
| `--radius-4xl` | `base + 16` | `radii.4xl` | 26 |

```ts
export const radii = {
  none: 0,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  "2xl": 18,
  "3xl": 22,
  "4xl": 26,
  full: 9999,
} as const;
```

Use Tailwind classes directly: `rounded-md`, `rounded-xl`, `rounded-full`. heroui-native `Card` and `Button` accept `className` and therefore these radius utilities.

### Spacing scale

The web is built on Tailwind’s 4 pt grid. On mobile the same utilities work through uniwind: `p-4`, `gap-2`, `mx-6`, etc. For component defaults, use the named aliases below.

| Named alias | Tailwind class | Value (pt / dp) | Typical use |
|---|---|---|---|
| `space-xs` | `space-1` / `p-1` | 4 | Tight icon/text pairs, inline badges |
| `space-sm` | `space-2` / `p-2` | 8 | Gap inside buttons, small list item padding |
| `space-md` | `space-4` / `p-4` | 16 | Card padding, screen gutters, form group gaps |
| `space-lg` | `space-6` / `p-6` | 24 | Section gaps, dialog content padding |
| `space-xl` | `space-8` / `p-8` | 32 | Large section breaks, empty-state vertical spacing |
| `space-2xl` | `space-12` / `p-12` | 48 | Hero empty states, onboarding step spacing |
| `space-3xl` | `space-16` / `p-16` | 64 | Full-screen centered illustrations |
| `space-4xl` | `space-24` / `p-24` | 96 | Rare; large splash screens only |

Use Tailwind’s numeric scale (`space-1` through `space-96`) for precise layouts and the named aliases for component defaults. The underlying values are identical to the web system.

### Motion tokens

| Web timing | Mobile token | Value | Use case |
|---|---|---|---|
| `duration-0` | `duration.instant` | 0 ms | State snap |
| `duration-150` | `duration.fast` | 150 ms | Micro-interactions, opacity, scale |
| `duration-200` | `duration.normal` | 200 ms | Standard transitions |
| `duration-300` | `duration.medium` | 300 ms | Sheet / dialog entrances |
| `duration-500` | `duration.slow` | 500 ms | Layout shifts, page transitions |

| Web easing | Mobile token | Value | Use case |
|---|---|---|---|
| `ease-in-out` | `easing.standard` | `[0.4, 0, 0.2, 1]` | Most transitions |
| `ease-out` | `easing.decelerate` | `[0, 0, 0.2, 1]` | Entrances |
| `ease-in` | `easing.accelerate` | `[0.4, 0, 1, 1]` | Exits |
| `linear` | `easing.linear` | `[0, 0, 1, 1]` | Progress, spin |
| Spring native | `easing.spring` | platform spring | Sheet dismiss / overscroll |

```ts
export const duration = {
  instant: 0,
  fast: 150,
  normal: 200,
  medium: 300,
  slow: 500,
} as const;

export const easing = {
  standard: [0.4, 0, 0.2, 1] as const,
  decelerate: [0, 0, 0.2, 1] as const,
  accelerate: [0.4, 0, 1, 1] as const,
  linear: [0, 0, 1, 1] as const,
} as const;
```

All animations respect `AccessibilityInfo.isReduceMotionEnabled()` (or `useReducedMotion`). When reduced motion is on, every animated value snaps to its final state unless the motion is essential for orientation (e.g., a sheet sliding in can still move, but without bounce and in `duration.fast`).

Use `react-native-reanimated` for these values:

```ts
import Animated, { withTiming, Easing } from "react-native-reanimated";

const style = useAnimatedStyle(() => ({
  opacity: withTiming(targetOpacity, { duration: 200, easing: Easing.inOut(Easing.ease) }),
}));
```

heroui-native components already use reanimated internally; prefer their built-in animations when available.

---

## Primitive catalog

The web exports 21 primitive families. On mobile the better-t-stack scaffold already wires most of them through `heroui-native`, `expo-router`, and `@gorhom/bottom-sheet`. The table below maps each web primitive to the actual mobile implementation, notes platform-specific behavior, and calls out where mobile diverges from web.

| # | Web primitive | Mobile implementation | Source / notes |
|---|---|---|---|
| 1 | `Avatar` | Thin wrapper around `expo-image` `Image` | Build in `apps/native/components/avatar.tsx`. Sizes sm (24), default (32), lg (40). Ring and badge via `className`. |
| 2 | `Badge` | `Chip` from `heroui-native` | Use `variant` and `color` props. Minimum height 20 pt. |
| 3 | `Button` | `Button` from `heroui-native` | Variants `default`, `secondary`, `destructive`/`danger`, `outline`, `ghost`. Icon-only sizes must still hit 44 pt. |
| 4 | `Card` | `Card` / `Surface` from `heroui-native` | `Card`, `Card.Title`, `Card.Description`. Use `variant="secondary"` or `variant="tertiary"` for muted surfaces. |
| 5 | `Chart` | `victory-native` or `react-native-gifted-charts` | **Not in scaffold yet; must be added.** Wrap in `ChartContainer`. Map web `chart-1`…`chart-5` via inline OKLCH or CSS variables. |
| 6 | `Dialog` | `Dialog` from `heroui-native`, or platform `Alert` | Centered modal. Destructive primary action requires explicit confirmation. |
| 7 | `DropdownMenu` | `Menu` from `heroui-native` if exported, else `@gorhom/bottom-sheet` | On phones prefer a bottom-sheet action list. Destructive items tinted `destructive` / `danger`. |
| 8 | `Input` | `TextField` + `Input` from `heroui-native` | Pair with `Label` and `FieldError`. See `apps/native/components/sign-in.tsx` for the working pattern. |
| 9 | `Label` | `Label` from `heroui-native` | Associated with inputs via `accessibilityLabelledBy` or by nesting inside `TextField`. |
| 10 | `Progress` | `Progress` from `heroui-native` if exported, else `@react-native-community/slider` style bar | Track `bg-muted`, indicator maps to web thresholds (`success`/`warning`/`destructive`). |
| 11 | `ScrollArea` | `ScrollView` / `FlatList` from React Native | No custom scrollbar. Horizontal overflow via `horizontal` prop. |
| 12 | `Select` | `Select` from `heroui-native` if exported, else `@gorhom/bottom-sheet` radio list | Long lists: searchable bottom sheet. Short lists: native picker on Android, action sheet on iOS. |
| 13 | `Separator` | `View` with `bg-border` or heroui `Divider` if exported | 1 pt / `hairlineWidth`. |
| 14 | `Sheet` | `@gorhom/bottom-sheet` | Slides from bottom. Radius `rounded-3xl` (22 pt). Grabber on iOS; back gesture on Android. |
| 15 | `Sidebar` | `Drawer` from `expo-router/drawer` | Already wired in `apps/native/app/(drawer)/_layout.tsx`. Bottom tabs expose top-level sections. |
| 16 | `Skeleton` | `Skeleton` from `heroui-native` if exported, else custom pulse | `bg-muted` / `bg-accent` pulse. Respect reduce motion. |
| 17 | `Sonner` | `useToast` from `heroui-native` | `toast.show({ variant: 'success' | 'danger' | ... })`. Position top on iOS, bottom on Android. |
| 18 | `Table` | `Table` family from `heroui-native` if exported, else `FlatList` rows | Native list-first. Horizontal scroll when needed. Mono numeric columns. |
| 19 | `Tabs` | `Tabs` from `heroui-native` if exported; layout tabs via `expo-router` `Tabs` | Screen-level tabs use `expo-router`. In-screen segmented controls use heroui `Tabs`. |
| 20 | `Textarea` | Multiline `Input` / `TextField` from `heroui-native` | Min height 64 pt, auto-grow up to 200 pt. `returnKeyType="done"`. |
| 21 | `Tooltip` | Avoid | Use `accessibilityHint` or inline helper text. Only for icon-only toolbar items, revealed on long-press. |

### Mobile-specific primitive variants

- **Sheet / BottomSheet** — `@gorhom/bottom-sheet` always slides from the bottom on phones. Corner radius matches `rounded-3xl` (22 pt). A grabber is rendered on iOS; Android omits it but adds a back gesture handler. Two snap points: 25 % and 75 % of screen height; expandable to full screen on drag.
- **DropdownMenu** — On iOS use an action sheet (via heroui `Menu` or `@gorhom/bottom-sheet`). On Android use an overflow menu or bottom sheet. Destructive items are tinted `destructive`/`danger` and separated from neutral items by a separator.
- **Sidebar** — Implemented as an `expo-router/drawer` behind a hamburger in the header. The top 3–5 destinations also appear in the bottom tab bar. The drawer shows the full web sidebar hierarchy, including nested groups.
- **Select** — Long lists use a searchable bottom sheet. Short lists use a platform-native picker on Android and an action sheet on iOS.
- **Tooltip** — Replaced by inline helper text or `accessibilityHint`. Only used sparingly for purely icon-driven toolbar items.

---

## Stack: uniwind + heroui-native

The better-t-stack scaffold already chose and wired this stack. Do not introduce a second theming or primitive layer.

- **uniwind 1.12.0** — Tailwind v4 on React Native. It reads the same CSS variables as the web app, so `bg-background`, `text-foreground`, `rounded-xl`, `p-4`, etc. work out of the box once `@openhealth/ui/globals.css` is imported.
- **heroui-native 1.0.9** — Pre-styled Tailwind component primitives. Use `Button`, `Card`, `Chip`, `Input`, `TextField`, `Label`, `FieldError`, `Surface`, `Spinner`, `useToast`, `useThemeColor`, and `cn` directly. These components accept `className`, so web parity is achieved by applying the same Tailwind tokens.
- **tailwind-merge + tailwind-variants** — Keeps Tailwind class composition predictable and mirrors the web's `class-variance-authority` pattern.
- **react-native-reanimated 4.5.1** — Animation engine, used by heroui-native internally and available for custom animations.
- **react-native-gesture-handler** — Already wired at the root for bottom-sheet and gesture-driven UI.
- **@gorhom/bottom-sheet** — Already in dependencies for sheets, action menus, and long select lists.
- **@expo/vector-icons** — Ionicons / MaterialIcons are already used; use them for all icons instead of `lucide-react-native`.

Use plain `StyleSheet` only for absolute positioning, platform-specific shadows, or complex gesture-driven layouts that cannot be expressed with Tailwind classes.

---

## Cross-platform typography

### Font loading strategy

All fonts are self-hosted inside the mobile app. Do not load fonts from Google Fonts, Adobe Fonts, or any CDN at runtime.

1. Place font files in `apps/native/assets/fonts/`:
   - `GeistVariable.ttf` (or `GeistVariableVF.woff2` converted to `.ttf`/`.otf` for RN).
   - `GeistMonoVariable.ttf`.
   - `CormorantGaramond-Regular.ttf`, `-Medium.ttf`, `-SemiBold.ttf`, `-Bold.ttf`.
2. Load them with `expo-font` in the root layout before rendering the app:

```tsx
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    GeistVariable: require("../assets/fonts/GeistVariable.ttf"),
    GeistMonoVariable: require("../assets/fonts/GeistMonoVariable.ttf"),
    CormorantGaramond: require("../assets/fonts/CormorantGaramond-Regular.ttf"),
    CormorantGaramondMedium: require("../assets/fonts/CormorantGaramond-Medium.ttf"),
    CormorantGaramondSemiBold: require("../assets/fonts/CormorantGaramond-SemiBold.ttf"),
    CormorantGaramondBold: require("../assets/fonts/CormorantGaramond-Bold.ttf"),
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;
  return <App />;
}
```

After loading, Tailwind classes `font-sans`, `font-mono`, and `font-display` map to the loaded families through the same CSS variables as the web app.

### Platform fallbacks

If fonts fail to load or the user has a custom font configured through accessibility settings, fall back to platform system fonts:

| Token | iOS fallback | Android fallback |
|---|---|---|
| `font-sans` | `"-apple-system", "BlinkMacSystemFont", "San Francisco"` | `"Roboto", "sans-serif"` |
| `font-mono` | `"Menlo", "Courier"` | `"RobotoMono", "monospace"` |
| `font-display` | `"New York", "Georgia", "Times New Roman"` | `"NotoSerif", "Georgia", "serif"` |

In React Native, font family references must match the actual PostScript or file name. Always test on device; iOS and Android may require different `fontFamily` declarations for the same file. Use a small font-loading helper that normalizes names:

```ts
export function fontFamily(token: "sans" | "mono" | "display", weight?: "400" | "500" | "600" | "700") {
  if (token === "display") {
    if (Platform.OS === "ios") return "Cormorant Garamond";
    return `CormorantGaramond_${weight ?? "Regular"}`;
  }
  // ...
}
```

### Variable fonts

Geist Variable is a variable font. React Native does not fully support variable font axes at the style layer, so register the same file under one family name and control weight through `fontWeight`. If a single variable font file causes issues on Android, split it into static weights and load each file separately.

---

## Theme switching

The mobile app already has a working light/dark toggle via `AppThemeContext` in `apps/native/contexts/app-theme-context.tsx`.

```tsx
import { useAppTheme } from "@/contexts/app-theme-context";

function ThemeToggle() {
  const { currentTheme, isDark, toggleTheme } = useAppTheme();

  return (
    <Pressable onPress={toggleTheme} accessibilityLabel={isDark ? "Switch to light" : "Switch to dark"}>
      <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={24} />
    </Pressable>
  );
}
```

- `useUniwind()` returns the active theme name.
- `Uniwind.setTheme('light' | 'dark')` switches the global CSS `class` applied at the root.
- heroui-native components and Tailwind classes react automatically because they read the same CSS variables.
- `expo-haptics` is used in the existing theme toggle for tactile feedback.

The toggle is **not** system-following by default in the scaffold; it is explicit. If a system-following mode is added later, store the preference (`"light" | "dark" | "system"`) in `AsyncStorage` and call `Uniwind.setTheme()` when the system scheme or user override changes.

To keep performance high:

- Do not interpolate colors at runtime.
- Do not subscribe to `Appearance` changes in every component; subscribe once at the provider.
- Do not animate between light and dark; switch instantly.

---

## Where mobile intentionally diverges from web

| Area | Web behavior | Mobile behavior | Rationale |
|---|---|---|---|
| Hover states | `hover:` Tailwind classes | Active / pressed states only | Touch has no hover. |
| Focus rings | `ring-2 ring-ring` | Native focus highlight + `ring-ring` | Screen readers and switch users need visible focus. |
| Touch targets | Minimum interactive size not enforced by design system | All tappable elements ≥ 44 × 44 pt | WCAG 2.2 AA and platform HIG. |
| Sheets | Radix side sheets from right/left/top/bottom | `@gorhom/bottom-sheet` from bottom on phones; side drawers on tablets | Phones have limited width; bottom sheets match platform patterns. |
| Scrollbars | Custom `ScrollArea` scrollbar | Native scroll indicators | iOS/Android styling APIs are limited and custom scrollbars add complexity. |
| Tooltips | Hover-triggered | Long-press or inline helper text | Hover does not exist on touch. |
| Backdrop / dim | `bg-black/50` | `bg-black/50` via uniwind + platform backdrop blur if available | Same Tailwind class works because the same CSS variables are loaded. |
| Shadow | Tailwind `shadow-sm` / `shadow-lg` | Tailwind shadow utilities via uniwind | heroui-native surfaces handle elevation; manual shadows use `shadow-*` classes. |
| Tables | `<table>` markup | `FlatList` rows + horizontal `ScrollView` for overflow | Native lists are more performant and accessible. |
| Charts | Recharts SVG | Native charting library (victory-native / react-native-gifted-charts) | Recharts is DOM-dependent and not available in RN. |

These divergences keep the app recognizable — the same colors, radii, type, and component vocabulary — while honoring the constraints of touch, smaller viewports, and the React Native renderer.
