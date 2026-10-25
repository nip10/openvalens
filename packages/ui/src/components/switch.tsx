import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@openvalens/ui/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=unchecked]:bg-paper-3 inline-flex h-5 w-9 shrink-0 items-center rounded-sm border border-input p-px transition-colors duration-[var(--dur-short)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-sheet data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-[1px] transition-transform duration-[var(--dur-short)] ease-[var(--ease-out)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
