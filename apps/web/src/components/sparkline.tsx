import { cn } from "@openvalens/ui/lib/utils";

type Tone = "sleep" | "steps" | "heart" | "weight" | "water" | "food";

/**
 * A small trend line for a list row or card head: the values oldest first,
 * in the measure's tone, with the latest one as a dot. Decorative unless a
 * `label` is given; the figures it draws should be on the page as text too.
 * Draws nothing for fewer than two finite values.
 */
export function Sparkline({
  values,
  tone,
  label,
  width = 96,
  height = 28,
  className,
}: {
  values: readonly (number | null)[];
  tone: Tone;
  /** What the line shows, for screen readers. Without it the line is hidden from them. */
  label?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (finite.length < 2) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const pad = 3;
  const x = (index: number) => pad + (index / (finite.length - 1)) * (width - pad * 2);
  // A flat series sits in the middle rather than on an edge.
  const y = (value: number) =>
    max === min ? height / 2 : pad + (1 - (value - min) / (max - min)) * (height - pad * 2);
  const points = finite.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const last = finite.length - 1;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={`var(--tone-${tone})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(last)} cy={y(finite[last]!)} r={3} fill={`var(--tone-${tone})`} />
    </svg>
  );
}
