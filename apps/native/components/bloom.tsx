/**
 * Bloom on native: the mobile twins of the web primitives in
 * `apps/web/src/components/page.tsx` (see DESIGN.md). Screens lead with a
 * headline (PageHeader + StatTiles or one hero Sheet), then one chart, then
 * the working parts. Explanations live behind an InfoTip, long history in
 * Details, and lists are cards with a ToneIcon, a chip and a StatusPill.
 *
 * Icons are lucide (the same set as web) via lucide-react-native.
 */
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { type Href, Link } from "expo-router";
import { BottomSheet, cn } from "heroui-native";
import { ChevronDown, ChevronRight, Info, type LucideIcon } from "lucide-react-native";
import { Children, isValidElement, type ReactNode, useState } from "react";
import { Pressable, Text, View, type ViewProps } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useThemeColor } from "@/utils/theme";

export type { LucideIcon };

/** One soft colour per measure; the same tone marks its icon, its bar and its chart. */
export type Tone = "sleep" | "steps" | "heart" | "weight" | "water" | "food" | "signal" | "neutral";

const TONE_ICON_BG: Record<Tone, string> = {
  sleep: "bg-sleep-soft",
  steps: "bg-steps-soft",
  heart: "bg-heart-soft",
  weight: "bg-weight-soft",
  water: "bg-water-soft",
  food: "bg-food-soft",
  signal: "bg-sidebar-accent",
  neutral: "bg-paper-2",
};
const TONE_FILL: Record<Tone, string> = {
  sleep: "bg-sleep",
  steps: "bg-steps",
  heart: "bg-heart",
  weight: "bg-weight",
  water: "bg-water",
  food: "bg-food",
  signal: "bg-signal",
  neutral: "bg-ink-3",
};
const TONE_TEXT: Record<Tone, string> = {
  sleep: "text-sleep",
  steps: "text-steps",
  heart: "text-heart",
  weight: "text-weight",
  water: "text-water",
  food: "text-food",
  signal: "text-signal",
  neutral: "text-ink-2",
};
const TONE_COLOR_TOKEN: Record<Tone, string> = {
  sleep: "sleep",
  steps: "steps",
  heart: "heart",
  weight: "weight",
  water: "water",
  food: "food",
  signal: "signal",
  neutral: "ink-3",
};
const TONE_SOFT_TOKEN: Record<Tone, string> = {
  sleep: "sleep-soft",
  steps: "steps-soft",
  heart: "heart-soft",
  weight: "weight-soft",
  water: "water-soft",
  food: "food-soft",
  signal: "paper-2",
  neutral: "paper-2",
};

/** A tone as colour values, for icons, SVG and charts (which take props, not classes). */
export function useToneColor(tone: Tone): { color: string; soft: string } {
  return {
    color: useThemeColor(TONE_COLOR_TOKEN[tone]),
    soft: useThemeColor(TONE_SOFT_TOKEN[tone]),
  };
}

/** The tone's text class, for a figure or a word set in the measure's colour. */
export function toneText(tone: Tone): string {
  return TONE_TEXT[tone];
}

/** A lucide icon in a token colour (`ink-3` by default). */
export function Icon({
  icon: IconComponent,
  size = 18,
  color = "ink-3",
}: {
  icon: LucideIcon;
  size?: number;
  color?: string;
}) {
  const value = useThemeColor(color);
  return <IconComponent size={size} color={value} strokeWidth={2} aria-hidden />;
}

/** A measure's icon in its soft round tint. */
export function ToneIcon({
  icon: IconComponent,
  tone,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { color } = useToneColor(tone);
  const box = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const glyph = size === "sm" ? 16 : size === "lg" ? 24 : 20;
  return (
    <View
      className={cn(
        "shrink-0 items-center justify-center rounded-full",
        box,
        TONE_ICON_BG[tone],
        className,
      )}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <IconComponent size={glyph} color={color} strokeWidth={2} />
    </View>
  );
}

/**
 * The card: soft white, 24px corners, a hairline edge and a faint warm
 * shadow. `well` is a quieter paper step for grouping inside a card.
 */
export function Sheet({ className, style, ...props }: ViewProps & { className?: string }) {
  const signal = useThemeColor("signal");
  return (
    <View
      className={cn("sheet p-5", className)}
      style={[{ boxShadow: `0px 8px 24px ${withAlpha(signal, 0.08)}` }, style]}
      {...props}
    />
  );
}

/** `#rrggbb` plus an alpha, for shadows and soft fills built from a token. */
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** Progress toward a reference as a soft bar; `value` is 0 to 1 (clamped). */
export function Meter({
  value,
  tone,
  label,
  className,
}: {
  value: number;
  tone: Tone;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <View
      className={cn("h-2.5 w-full overflow-hidden rounded-full", TONE_ICON_BG[tone], className)}
      accessible={!!label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
    >
      <View className={cn("h-full rounded-full", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
    </View>
  );
}

/** A ring for a score out of 100 or a share of a goal; `value` is 0 to 1. */
export function Ring({
  value,
  tone,
  size = 64,
  children,
}: {
  value: number;
  tone: Tone;
  size?: number;
  children?: ReactNode;
}) {
  const { color } = useToneColor(tone);
  const track = useThemeColor("paper-2");
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View className="items-center justify-center" style={{ width: size, height: size }}>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
      >
        <Circle cx="32" cy="32" r={r} fill="none" stroke={track} strokeWidth={7} />
        <Circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - v)}
        />
      </Svg>
      {children ? (
        <Text className="font-display text-base font-semibold text-ink">{children}</Text>
      ) : null}
    </View>
  );
}

const STATUS_BG = {
  good: "bg-success/15",
  warn: "bg-warning/15",
  bad: "bg-destructive/15",
  neutral: "bg-muted",
} as const;
const STATUS_TEXT = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  neutral: "text-ink-2",
} as const;

export type StatusTone = keyof typeof STATUS_BG;

/** A state as a word on a tint: never colour alone. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("self-start rounded-full px-2.5 py-0.5", STATUS_BG[tone], className)}>
      <Text
        className={cn("font-sans text-[13px] font-medium leading-snug", STATUS_TEXT[tone])}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

/** A key figure on a soft tint, top right of a list card ("2000 IU", "5 g"). */
export function ToneChip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("self-start rounded-full px-2.5 py-1", TONE_ICON_BG[tone], className)}>
      <Text className="font-sans text-[13px] font-semibold text-ink" numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Lingui's <Trans> renders a bare string, which React Native only accepts
 * inside <Text>. Wraps strings, numbers and <Trans> elements (they carry a
 * message `id`) in body text and leaves views as they are.
 */
function textChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    const isTrans =
      isValidElement(child) &&
      typeof child.type !== "string" &&
      typeof (child.props as { id?: unknown }).id === "string";
    if (typeof child === "string" || typeof child === "number" || isTrans) {
      return <Prose>{child}</Prose>;
    }
    return child;
  });
}

/**
 * A small ⓘ that opens the explanation in a bottom sheet: method notes,
 * sources and caveats live here so the screen itself stays short.
 */
export function InfoTip({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label?: string;
  title?: ReactNode;
}) {
  const { _ } = useLingui();
  const [open, setOpen] = useState(false);
  const ink3 = useThemeColor("ink-3");
  const a11yLabel = label ?? _(msg`More information`);
  return (
    <BottomSheet isOpen={open} onOpenChange={setOpen}>
      <BottomSheet.Trigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          hitSlop={10}
          className="h-7 w-7 items-center justify-center rounded-full active:bg-paper-3"
        >
          <Info size={16} color={ink3} />
        </Pressable>
      </BottomSheet.Trigger>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content backgroundClassName="bg-sheet rounded-t-[28px]">
          <View className="gap-3 px-1 pb-6">
            <BottomSheet.Title className="font-display text-xl text-ink">
              {title ?? a11yLabel}
            </BottomSheet.Title>
            <View className="gap-2">{textChildren(children)}</View>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

/** Body text for an InfoTip or a note: Figtree, ink-2, comfortable leading. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text className={cn("font-sans text-base leading-relaxed text-ink-2", className)}>
      {children}
    </Text>
  );
}

/**
 * Detail on request: full tables, history, method notes. Closed by default
 * so the screen leads with its summary; one tap shows everything.
 */
export function Details({
  summary,
  children,
  defaultOpen = false,
  className,
  testID,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ink2 = useThemeColor("ink-2");
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View className={cn("gap-3", className)}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={testID}
        className="min-h-11 flex-row items-center gap-1.5 self-start rounded-md px-1 active:opacity-70"
      >
        <Chevron size={16} color={ink2} />
        <Text className="font-display text-base font-medium text-ink-2">{summary}</Text>
      </Pressable>
      {open ? <View className="gap-2">{textChildren(children)}</View> : null}
    </View>
  );
}

/** The head of a screen: its title in Fraunces, at most one short line, an ⓘ. */
export function PageHeader({
  title,
  description,
  info,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="gap-1">
        {eyebrow ? <Text className="font-sans text-sm text-ink-3">{eyebrow}</Text> : null}
        <View className="flex-row items-center gap-2">
          <Text
            className="shrink font-display text-[30px] font-semibold leading-[36px] text-ink"
            accessibilityRole="header"
          >
            {title}
          </Text>
          {info ? <InfoTip>{info}</InfoTip> : null}
        </View>
        {description ? <Text className="font-sans text-base text-ink-3">{description}</Text> : null}
      </View>
      {actions ? <View className="flex-row flex-wrap items-center gap-2">{actions}</View> : null}
    </View>
  );
}

/** A section: a head with an optional tone icon and ⓘ, then its content (on a Sheet with `sheet`). */
export function Section({
  title,
  icon,
  tone,
  description,
  info,
  actions,
  sheet = false,
  className,
  children,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  description?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  sheet?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <View className={cn("gap-3", className)}>
      {title || actions ? (
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 shrink flex-row items-center gap-2">
              {icon && tone ? <ToneIcon icon={icon} tone={tone} size="sm" /> : null}
              {icon && !tone ? <Icon icon={icon} /> : null}
              {title ? (
                <Text
                  className="shrink font-display text-xl font-semibold text-ink"
                  accessibilityRole="header"
                >
                  {title}
                </Text>
              ) : null}
              {info ? <InfoTip>{info}</InfoTip> : null}
            </View>
            {actions ? <View className="flex-row items-center gap-2">{actions}</View> : null}
          </View>
          {description ? <Text className="font-sans text-sm text-ink-3">{description}</Text> : null}
        </View>
      ) : null}
      {sheet ? <Sheet className="gap-3">{children}</Sheet> : children}
    </View>
  );
}

/**
 * The headline of a measure: its name, its icon in its colour, the figure
 * set large in Fraunces, an optional bar toward a reference, and one short
 * line. The whole card opens the measure's screen when `href` is given.
 */
export function StatTile({
  icon,
  tone = "signal",
  label,
  value,
  unit,
  note,
  status,
  meter,
  href,
  className,
  accessibilityLabel,
  testID,
}: {
  icon: LucideIcon;
  tone?: Tone;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  status?: { label: ReactNode; tone: StatusTone };
  meter?: { value: number; label?: string };
  href?: Href;
  className?: string;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const body = (
    <Sheet className={cn("min-w-0 gap-3", className)} testID={href ? undefined : testID}>
      <View className="flex-row items-center justify-between gap-2">
        <Text
          className="shrink font-sans text-[15px] font-semibold leading-5 text-ink-2"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {label}
        </Text>
        <ToneIcon icon={icon} tone={tone} size="sm" />
      </View>
      <View className="flex-row flex-wrap items-baseline gap-1.5">
        <Text
          className="font-display text-[34px] font-medium leading-[40px] text-ink"
          style={{ fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {value}
        </Text>
        {unit ? <Text className="font-sans text-sm text-ink-3">{unit}</Text> : null}
      </View>
      {meter ? <Meter value={meter.value} tone={tone} label={meter.label} /> : null}
      {status ? (
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          {note ? <Text className="shrink font-sans text-sm text-ink-3">{note}</Text> : null}
        </View>
      ) : note ? (
        // Outside a wrapping row: Android measured the note as one line there
        // and clipped its second line ("Average," with the date cut off).
        <Text className="font-sans text-sm text-ink-3">{note}</Text>
      ) : null}
    </Sheet>
  );
  if (!href) return body;
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        className="active:opacity-80"
      >
        {body}
      </Pressable>
    </Link>
  );
}

/** A figure inside a card: a label, the value, an optional unit and a line under it. */
export function Figure({
  label,
  value,
  unit,
  note,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("min-w-0 gap-1", className)}>
      <Text className="font-sans text-sm text-ink-3">{label}</Text>
      <View className="flex-row items-baseline gap-1">
        <Text
          className="font-sans text-xl font-semibold text-ink"
          style={{ fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {value}
        </Text>
        {unit ? <Text className="font-sans text-sm text-ink-3">{unit}</Text> : null}
      </View>
      {note ? <Text className="font-sans text-sm text-ink-3">{note}</Text> : null}
    </View>
  );
}

/**
 * One thing in a list, as a card: its ToneIcon, a title, one line under it, a
 * chip for its key figure and an optional StatusPill. Pressable with `onPress`.
 */
export function ListCard({
  icon,
  tone = "neutral",
  title,
  subtitle,
  chip,
  status,
  trailing,
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  chip?: ReactNode;
  status?: { label: ReactNode; tone: StatusTone };
  trailing?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  className?: string;
}) {
  const content = (
    <Sheet className={cn("gap-3 p-4", className)} testID={onPress ? undefined : testID}>
      <View className="flex-row items-start gap-3">
        <ToneIcon icon={icon} tone={tone} />
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-start justify-between gap-2">
            <Text className="shrink font-sans text-base font-semibold text-ink">{title}</Text>
            {chip ? <ToneChip tone={tone}>{chip}</ToneChip> : null}
          </View>
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
          {subtitle ? <Text className="font-sans text-sm text-ink-3">{subtitle}</Text> : null}
        </View>
        {trailing ? <View className="self-center">{trailing}</View> : null}
      </View>
      {children}
    </Sheet>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      className="active:opacity-80"
    >
      {content}
    </Pressable>
  );
}

/** What is empty, why it matters, and the one action that fills it. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  tone = "neutral",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "items-start gap-2 rounded-3xl border border-dashed border-rule-2 px-5 py-6",
        className,
      )}
    >
      {icon ? <ToneIcon icon={icon} tone={tone} size="sm" /> : null}
      <Text className="font-display text-lg font-medium text-ink">{title}</Text>
      {description ? (
        <Text className="font-sans text-sm leading-relaxed text-ink-3">{description}</Text>
      ) : null}
      {action ? <View className="pt-1">{action}</View> : null}
    </View>
  );
}

/** A region that failed to load: what happened and the way to retry. */
export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      className={cn(
        "items-start gap-2 rounded-3xl border border-destructive/40 bg-destructive/5 px-5 py-4",
        className,
      )}
    >
      <Text className="font-display text-base font-medium text-ink">{title}</Text>
      {description ? <Text className="font-sans text-sm text-ink-3">{description}</Text> : null}
      {action ? <View className="pt-1">{action}</View> : null}
    </View>
  );
}

/** The column every screen sits in: gutters and the gap between regions. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={cn("gap-7 px-4 pb-12 pt-4", className)}>{children}</View>;
}

/** Tiles side by side, sharing the row equally. */
export function TileRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View className={cn("flex-row gap-3", className)}>
      {Children.toArray(children).map((child, index) => (
        <View key={index} className="min-w-0 flex-1">
          {child}
        </View>
      ))}
    </View>
  );
}

/** A chevron for a pressable row. */
export function RowChevron() {
  return <Icon icon={ChevronRight} size={18} />;
}

/**
 * The OpenValens mark: five soft petals round a warm centre, lit from the
 * upper left (steps-soft into the terracotta signal). The same drawing as
 * the app icon (assets/source/mark.svg).
 */
export function BloomMark({ size = 28 }: { size?: number }) {
  const soft = useThemeColor("steps-soft");
  const signal = useThemeColor("signal");
  const steps = useThemeColor("steps");
  const sheet = useThemeColor("signal-ink");
  return (
    <Svg width={size} height={size} viewBox="144 144 736 736" accessibilityElementsHidden>
      <Defs>
        <RadialGradient id="bloom-petals" gradientUnits="userSpaceOnUse" cx="420" cy="400" r="560">
          <Stop offset="0" stopColor={soft} />
          <Stop offset="0.38" stopColor={steps} />
          <Stop offset="0.85" stopColor={signal} />
        </RadialGradient>
      </Defs>
      <Circle cx="512" cy="322" r="178" fill="url(#bloom-petals)" />
      <Circle cx="693" cy="453" r="178" fill="url(#bloom-petals)" />
      <Circle cx="624" cy="666" r="178" fill="url(#bloom-petals)" />
      <Circle cx="400" cy="666" r="178" fill="url(#bloom-petals)" />
      <Circle cx="331" cy="453" r="178" fill="url(#bloom-petals)" />
      <Circle cx="512" cy="512" r="118" fill={sheet} opacity={0.92} />
    </Svg>
  );
}
