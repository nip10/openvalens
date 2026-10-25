import type { ComponentProps, ReactNode } from "react";

import { cn } from "@openvalens/ui/lib/utils";

/**
 * One container for every screen: capped, left-aligned inside the shell,
 * gutters that grow with the viewport. `width="narrow"` is for a form or a
 * single column of prose; `wide` (the default) for tables, charts and sheets.
 */
export function Page({
  width = "wide",
  className,
  ...props
}: ComponentProps<"main"> & { width?: "narrow" | "wide" }) {
  return (
    <main
      className={cn(
        "mx-auto grid w-full content-start gap-10 px-4 pt-8 pb-16 md:px-8 lg:px-10 lg:pt-10",
        width === "narrow" ? "max-w-3xl" : "max-w-6xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The head of a screen: its title, one line on what it holds, and the screen's
 * actions on the right, over the firm rule.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b-2 border-rule-2 pb-4",
        className,
      )}
    >
      <div className="grid min-w-0 gap-1.5">
        <h1 className="text-[1.75rem] leading-[1.05] tracking-[-0.025em] text-ink md:text-[2.125rem]">
          {title}
        </h1>
        {description ? <p className="max-w-[60ch] text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A section of a screen: a head (h2) and its content, parted from the next by
 * space, not a box. Use `sheet` to set the content on the printed sheet.
 */
export function Section({
  title,
  description,
  actions,
  sheet = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  sheet?: boolean;
}) {
  return (
    <section className={cn("grid min-w-0 content-start gap-4", className)} {...props}>
      {title || actions ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="grid min-w-0 gap-1">
            {title ? <h2 className="text-xl leading-tight text-ink">{title}</h2> : null}
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
 * A figure and what it counts: a label in the body face, the value in mono,
 * tabular, with an optional unit and a line of context under it.
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
      <dt className="text-sm font-medium text-ink-3">{label}</dt>
      <dd className="m-0 flex items-baseline gap-1.5">
        <span className="num text-2xl font-medium tracking-[-0.03em] text-ink">{value}</span>
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
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid justify-items-start gap-2 border-t border-rule py-6", className)}>
      <p className="font-display font-medium text-ink">{title}</p>
      {description ? <p className="max-w-[60ch] text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
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
      className={cn("grid justify-items-start gap-2 border-t-2 border-destructive py-4", className)}
    >
      <p className="font-display font-medium text-ink">{title}</p>
      {description ? <p className="max-w-[60ch] text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
