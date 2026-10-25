import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Info, type LucideIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";

import { cn } from "@openvalens/ui/lib/utils";

/**
 * One container for every screen: capped, left-aligned inside the shell,
 * gutters that grow with the viewport. `width="narrow"` is for a form or a
 * single column of prose; `wide` (the default) for tables, charts and cards.
 */
export function Page({
  width = "wide",
  className,
  ...props
}: ComponentProps<"main"> & { width?: "narrow" | "wide" }) {
  return (
    <main
      className={cn(
        "mx-auto grid w-full content-start gap-8 px-4 pt-6 pb-16 md:px-8 lg:px-10 lg:pt-10",
        width === "narrow" ? "max-w-3xl" : "max-w-6xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The head of a screen: its title, at most one short line under it, and the
 * screen's actions on the right. Longer explanations belong in `info`, behind
 * an ⓘ, not on the page.
 */
export function PageHeader({
  title,
  description,
  info,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="grid min-w-0 gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-[1.875rem] leading-[1.1] tracking-[-0.02em] text-ink md:text-[2.25rem]">
            {title}
          </h1>
          {info ? <InfoTip>{info}</InfoTip> : null}
        </div>
        {description ? <p className="max-w-[60ch] text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A section of a screen: a head (h2) with an optional icon and ⓘ, and its
 * content. Use `sheet` to set the content on a card.
 */
export function Section({
  title,
  icon: Icon,
  tone,
  description,
  info,
  actions,
  sheet = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  description?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  sheet?: boolean;
}) {
  return (
    <section className={cn("grid min-w-0 content-start gap-3", className)} {...props}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="grid min-w-0 gap-0.5">
            <div className="flex items-center gap-2">
              {Icon && tone ? <ToneIcon icon={Icon} tone={tone} size="sm" /> : null}
              {Icon && !tone ? (
                <Icon className="size-[18px] shrink-0 text-ink-3" aria-hidden="true" />
              ) : null}
              {title ? <h2 className="text-xl leading-tight text-ink">{title}</h2> : null}
              {info ? <InfoTip>{info}</InfoTip> : null}
            </div>
            {description ? <p className="max-w-[65ch] text-sm text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {sheet ? <div className="sheet min-w-0 p-5">{children}</div> : children}
    </section>
  );
}

/**
 * A small ⓘ that opens the explanation on click or tap: method notes, sources
 * and caveats live here so the screen itself stays short. Built on <details>
 * so the text stays in the document (search, print, screen readers, tests);
 * Escape or a click outside closes it.
 */
export function InfoTip({
  children,
  label,
  align = "start",
  className,
}: {
  children: ReactNode;
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const { _ } = useLingui();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        el.open = false;
        el.querySelector("summary")?.focus();
        return;
      }
      if (!el.contains(event.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className={cn("group/info relative inline-block shrink-0", className)}>
      <summary
        aria-label={label ?? _(msg`More information`)}
        className="relative inline-flex size-7 cursor-pointer list-none items-center justify-center rounded-full text-ink-3 transition-colors duration-[var(--dur-short)] before:absolute before:-inset-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-paper-3 group-open/info:bg-muted group-open/info:text-ink [&::-webkit-details-marker]:hidden"
      >
        <Info className="size-4" aria-hidden="true" />
      </summary>
      <div
        className={cn(
          "absolute top-full z-[var(--z-modal)] mt-1.5 grid w-[min(24rem,calc(100vw-2rem))] gap-2 rounded-xl border border-border bg-popover px-4 py-3 text-left text-sm leading-relaxed font-normal tracking-normal text-ink-2 shadow-[0_8px_24px_oklch(20%_0.02_245/0.12)]",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * Detail on request: full tables, history, method notes. Closed by default so
 * the screen leads with its summary; one click shows everything.
 */
export function Details({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={cn("group min-w-0", className)} open={defaultOpen}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 font-display text-sm font-medium text-ink-2 transition-colors duration-[var(--dur-short)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform duration-[var(--dur-short)] group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/** One soft colour per measure; the same tone marks its icon, its bar and its chart. */
export type Tone = "sleep" | "steps" | "heart" | "weight" | "water" | "food" | "signal";

const TONE_ICON: Record<Tone, string> = {
  sleep: "bg-sleep-soft text-sleep",
  steps: "bg-steps-soft text-steps",
  heart: "bg-heart-soft text-heart",
  weight: "bg-weight-soft text-weight",
  water: "bg-water-soft text-water",
  food: "bg-food-soft text-food",
  signal: "bg-sidebar-accent text-signal",
};
const TONE_FILL: Record<Tone, string> = {
  sleep: "bg-sleep",
  steps: "bg-steps",
  heart: "bg-heart",
  weight: "bg-weight",
  water: "bg-water",
  food: "bg-food",
  signal: "bg-signal",
};
const TONE_TRACK: Record<Tone, string> = {
  sleep: "bg-sleep-soft",
  steps: "bg-steps-soft",
  heart: "bg-heart-soft",
  weight: "bg-weight-soft",
  water: "bg-water-soft",
  food: "bg-food-soft",
  signal: "bg-paper-2",
};
const TONE_TEXT: Record<Tone, string> = {
  sleep: "text-sleep",
  steps: "text-steps",
  heart: "text-heart",
  weight: "text-weight",
  water: "text-water",
  food: "text-food",
  signal: "text-signal",
};

/** A measure's icon in its soft round tint. */
export function ToneIcon({
  icon: Icon,
  tone,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        size === "sm"
          ? "size-8 [&>svg]:size-4"
          : size === "lg"
            ? "size-12 [&>svg]:size-6"
            : "size-10 [&>svg]:size-5",
        TONE_ICON[tone],
        className,
      )}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
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
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cn("h-2.5 w-full overflow-hidden rounded-full", TONE_TRACK[tone], className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className={cn("h-full rounded-full", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A ring for a score out of 100 or a share of a goal; `value` is 0 to 1. */
export function Ring({
  value,
  tone,
  size = 64,
  children,
  className,
}: {
  value: number;
  tone: Tone;
  size?: number;
  children?: ReactNode;
  className?: string;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center", TONE_TEXT[tone], className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
        />
      </svg>
      {children ? (
        <span className="relative text-sm font-semibold text-ink">{children}</span>
      ) : null}
    </span>
  );
}

const TONES = {
  good: "bg-success/12 text-success",
  warn: "bg-warning/14 text-warning",
  bad: "bg-destructive/12 text-destructive",
  neutral: "bg-muted text-ink-2",
} as const;

export type StatusTone = keyof typeof TONES;

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
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.8125rem] leading-snug font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The headline of a measure: its name, its icon in its colour, the figure set
 * large, an optional bar toward a reference, and one short line. The whole card
 * links to the measure's screen when `to` is given.
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
  to,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  status?: { label: ReactNode; tone: StatusTone };
  meter?: { value: number; label?: string };
  to?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink-2">{label}</span>
        <ToneIcon icon={icon} tone={tone} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="num font-display text-[2.125rem] leading-none font-medium tracking-[-0.02em] whitespace-nowrap text-ink">
          {value}
        </span>
        {unit ? <span className="text-sm text-ink-3">{unit}</span> : null}
      </div>
      {meter ? <Meter value={meter.value} tone={tone} label={meter.label} /> : null}
      {status || note ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
          {note ? <span className="text-ink-3">{note}</span> : null}
        </div>
      ) : null}
    </>
  );
  const classes = cn("sheet group grid min-w-0 content-start gap-3 p-5", className);
  return to ? (
    <Link
      to={to}
      className={cn(
        classes,
        "no-underline transition-transform duration-[var(--dur-short)] ease-[var(--ease-out)] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 motion-reduce:transition-none",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/**
 * A figure and what it counts: a label, the value, an optional unit and a line
 * of context under it. For figures inside a card; use StatTile for headlines.
 */
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
    <div className={cn("grid min-w-0 content-start gap-1", className)}>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="m-0 flex items-baseline gap-1.5">
        <span className="num text-xl font-semibold tracking-[-0.02em] whitespace-nowrap text-ink sm:text-2xl">
          {value}
        </span>
        {unit ? <span className="text-sm text-ink-3">{unit}</span> : null}
      </dd>
      {note ? <dd className="m-0 text-sm text-ink-3">{note}</dd> : null}
    </div>
  );
}

/**
 * What is empty, why it matters, and the one action that fills it. A region
 * that loads data also owes a skeleton while pending and an ErrorState.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-start gap-2 rounded-xl border border-dashed border-rule-2 px-5 py-6",
        className,
      )}
    >
      {Icon ? <Icon className="size-5 text-ink-3" aria-hidden="true" /> : null}
      <p className="font-display font-medium text-ink">{title}</p>
      {description ? <p className="max-w-[60ch] text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

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
    <div
      role="alert"
      className={cn(
        "grid justify-items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/6 px-5 py-4",
        className,
      )}
    >
      <p className="font-display font-medium text-ink">{title}</p>
      {description ? <p className="max-w-[60ch] text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
