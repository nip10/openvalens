import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@openvalens/ui/lib/utils";

function progressColor(value: number) {
  if (value < 25) return "bg-destructive";
  if (value < 75) return "bg-warning";
  return "bg-success";
}

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const pct = value || 0;
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("bg-paper-3 relative h-1.5 w-full overflow-hidden", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full flex-1 transition-transform duration-[var(--dur-long)] ease-[var(--ease-out)]",
          progressColor(pct),
        )}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
