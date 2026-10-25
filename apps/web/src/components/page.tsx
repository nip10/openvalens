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
          <h1 className="text-[1.75rem] leading-[1.1] tracking-[-0.025em] text-ink md:text-[2rem]">
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
              {Icon ? (
                <Icon className="size-[18px] shrink-0 text-ink-3" aria-hidden="true" />
              ) : null}
              {title ? <h2 className="text-lg leading-tight text-ink">{title}</h2> : null}
              {info ? <InfoTip>{info}</InfoTip> : null}
            </div>
            {description ? <p className="max-w-[65ch] text-sm text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {sheet ? <div className="sheet min-w-0 px-5 py-4">{children}</div> : children}
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
 * The headline of a measure: an icon, its name, the figure set large, and one
 * short line (a date, a status). Links to its screen when `to` is given.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  unit,
  note,
  status,
  to,
  className,
}: {
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  status?: { label: ReactNode; tone: StatusTone };
  to?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <Icon className="size-4 shrink-0 text-signal" aria-hidden="true" />
          {label}
        </span>
        {to ? (
          <ChevronRight
            className="size-4 text-ink-3 transition-transform duration-[var(--dur-short)] group-hover:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[1.875rem] leading-none font-semibold tracking-[-0.03em] whitespace-nowrap text-ink">
          {value}
        </span>
        {unit ? <span className="text-sm text-ink-3">{unit}</span> : null}
      </div>
      {status || note ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
          {note ? <span className="text-ink-3">{note}</span> : null}
        </div>
      ) : null}
    </>
  );
  const classes = cn("sheet group grid min-w-0 content-start gap-3 px-5 py-4", className);
  return to ? (
    <Link
      to={to}
      className={cn(
        classes,
        "no-underline transition-colors duration-[var(--dur-short)] hover:border-rule-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-muted",
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
