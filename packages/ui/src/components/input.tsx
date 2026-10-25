import * as React from "react";

import { cn } from "@openvalens/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-ink-3 border-input h-9 w-full min-w-0 rounded-md border bg-card px-3 py-1 text-base text-ink transition-[background-color,border-color] duration-[var(--dur-short)] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55 md:text-sm",
        "outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
