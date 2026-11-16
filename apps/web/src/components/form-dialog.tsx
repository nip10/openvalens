import { useLingui } from "@lingui/react/macro";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openvalens/ui/components/dialog";
import { cn } from "@openvalens/ui/lib/utils";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The dialog that creates a thing or logs a record (DESIGN.md "Forms and
 * logging"): centred on wider screens, a bottom sheet on phones. The body
 * scrolls inside it, so long forms stay reachable on a small screen.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** One short line under the title, or nothing. */
  description?: ReactNode;
  /** `lg` for editors with nested rows (a workout session, a routine). */
  size?: "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "sheet grid max-h-[90dvh] grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-x-hidden overflow-y-auto border-rule p-5 [overflow-wrap:anywhere] sm:p-6 [&>*]:min-w-0",
          size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg",
          // A bottom sheet on phones, clear of the home indicator.
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <DialogTitle className="font-display text-2xl font-medium text-ink">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="text-sm text-ink-3">{description}</DialogDescription>
            ) : null}
          </div>
          <DialogClose
            className="-mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={t`Close`}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
