import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@openvalens/ui/lib/utils";

import { InfoTip } from "@/components/page";

/**
 * Settings read like a phone's: a card of rows, each an icon, a label (with an
 * optional short line and an ⓘ) and the current value or control on the right.
 */
export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("sheet grid min-w-0 divide-y divide-rule px-5", className)}>{children}</div>
  );
}

/** A soft neutral circle for a settings row's icon (measure tints stay with their measure). */
export function SettingsIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-2",
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

export function SettingsRow({
  icon,
  label,
  htmlFor,
  labelId,
  description,
  info,
  children,
  className,
}: {
  icon: LucideIcon;
  label: ReactNode;
  /** Makes the label a <label> for this control id. */
  htmlFor?: string;
  labelId?: string;
  description?: ReactNode;
  info?: ReactNode;
  /** The current value or the control, on the right. */
  children?: ReactNode;
  className?: string;
}) {
  const labelClass = "font-medium text-ink";
  return (
    <div className={cn("flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-3", className)}>
      <SettingsIcon icon={icon} />
      <div className="grid min-w-0 flex-1 basis-40 gap-0.5">
        <div className="flex items-center gap-1">
          {htmlFor ? (
            <label htmlFor={htmlFor} id={labelId} className={labelClass}>
              {label}
            </label>
          ) : (
            <span id={labelId} className={labelClass}>
              {label}
            </span>
          )}
          {info ? <InfoTip>{info}</InfoTip> : null}
        </div>
        {description ? <span className="text-sm text-ink-3">{description}</span> : null}
      </div>
      {children ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

/** A native select styled for a settings row. */
export const SETTINGS_SELECT =
  "h-10 w-fit max-w-full rounded-xl border border-input bg-card px-3 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";
