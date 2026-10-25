import * as React from "react";

import { cn } from "@openvalens/ui/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-ink-3 aria-invalid:border-destructive flex field-sizing-content min-h-24 w-full resize-y rounded-md border bg-card px-3 py-2 text-base text-ink transition-[background-color,border-color] duration-[var(--dur-short)] outline-2 -outline-offset-2 outline-transparent hover:bg-muted focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
