import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openvalens/ui/components/dialog";
import { cn } from "@openvalens/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * A page's own log or create form, opened from the "+" (`useLogDialog`) or a
 * header button (DESIGN.md "Forms and logging"): a centred card on wider
 * screens, a bottom sheet on phones. The form inside stays the page's own.
 */
export function LogDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sheet grid max-h-[90dvh] gap-5 overflow-y-auto border-rule p-6 sm:max-w-lg",
          // A bottom sheet on phones: full width, flush with the bottom edge, clear of the safe area.
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          className,
        )}
      >
        <div className="grid gap-1 pr-8">
          <DialogTitle className="font-display text-2xl font-medium text-ink">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm text-ink-3">{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
