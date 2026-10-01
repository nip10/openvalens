import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@openhealth/ui/lib/utils";

function progressColor(value: number) {
  if (value < 25) return "bg-red-500";
  if (value < 50) return "bg-orange-500";
  if (value < 75) return "bg-yellow-500";
  return "bg-green-500";
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
      className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("h-full w-full flex-1 transition-all", progressColor(pct))}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
