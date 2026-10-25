import { cn } from "@openvalens/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("bg-paper-3/60 animate-pulse", className)} {...props} />
  );
}

export { Skeleton };
