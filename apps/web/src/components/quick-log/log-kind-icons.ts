import type { LogKindIconKey } from "@openvalens/api/presenters/log-kinds";
import {
  Droplet,
  Dumbbell,
  Flame,
  FlaskConical,
  Footprints,
  Gauge,
  Heart,
  HeartPulse,
  type LucideIcon,
  Moon,
  Pill,
  Route,
  Ruler,
  Scale,
  Target,
  UtensilsCrossed,
} from "lucide-react";

import type { Tone } from "@/components/page";
import { TRACKER_ICON_COMPONENTS } from "@/components/tracker-icons";

/** The one web-side map from a log kind's platform-neutral icon key to lucide (#440); tracker icons (#441) come first so built-in keys win. */
export const LOG_KIND_ICONS: Readonly<Record<LogKindIconKey, LucideIcon>> = Object.freeze({
  ...TRACKER_ICON_COMPONENTS,
  scale: Scale,
  gauge: Gauge,
  "heart-pulse": HeartPulse,
  heart: Heart,
  footprints: Footprints,
  flame: Flame,
  route: Route,
  moon: Moon,
  flask: FlaskConical,
  ruler: Ruler,
  utensils: UtensilsCrossed,
  droplet: Droplet,
  dumbbell: Dumbbell,
  pill: Pill,
  target: Target,
});

/** Custom trackers (#441) share the "signal" tone their own screens use. */
const TRACKER_ICON_TONES = Object.fromEntries(
  Object.keys(TRACKER_ICON_COMPONENTS).map((key) => [key, "signal"]),
) as Record<keyof typeof TRACKER_ICON_COMPONENTS, Tone>;

/** Each icon's measure tone (DESIGN.md "Which tone"). */
export const LOG_KIND_TONES: Readonly<Record<LogKindIconKey, Tone>> = Object.freeze({
  ...TRACKER_ICON_TONES,
  scale: "weight",
  gauge: "heart",
  "heart-pulse": "heart",
  heart: "heart",
  footprints: "steps",
  flame: "steps",
  route: "steps",
  moon: "sleep",
  flask: "water",
  ruler: "weight",
  utensils: "food",
  droplet: "water",
  dumbbell: "steps",
  pill: "food",
  target: "weight",
});
