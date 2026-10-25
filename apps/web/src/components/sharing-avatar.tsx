import { cn } from "@openvalens/ui/lib/utils";

import type { Tone } from "./page";

const TINT: Record<Tone, string> = {
  sleep: "bg-sleep-soft text-sleep",
  steps: "bg-steps-soft text-steps",
  heart: "bg-heart-soft text-heart",
  weight: "bg-weight-soft text-weight",
  water: "bg-water-soft text-water",
  food: "bg-food-soft text-food",
  signal: "bg-sidebar-accent text-signal",
};

const ROTATION: Tone[] = ["sleep", "steps", "heart", "weight", "water", "food"];

/** A person's (or a workspace's) first letter on a soft round tint; the tint follows the name. */
export function SharingAvatar({ name, className }: { name: string; className?: string }) {
  const letter = name.trim().charAt(0).toLocaleUpperCase() || "?";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const tone = ROTATION[hash % ROTATION.length] ?? "signal";
  return (
    <span
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full font-display text-lg font-medium",
        TINT[tone],
        className,
      )}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
