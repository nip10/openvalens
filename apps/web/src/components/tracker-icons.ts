import type { TrackerIcon } from "@openvalens/trackers/model";
import {
  Activity,
  BookOpen,
  Check,
  Coffee,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  Hand,
  Heart,
  Leaf,
  Moon,
  Smile,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Target,
  Timer,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Each custom tracker icon key (#441) and its lucide icon. */
export const TRACKER_ICON_COMPONENTS: Record<TrackerIcon, LucideIcon> = {
  smile: Smile,
  zap: Zap,
  activity: Activity,
  leaf: Leaf,
  flame: Flame,
  snowflake: Snowflake,
  hand: Hand,
  sparkles: Sparkles,
  heart: Heart,
  target: Target,
  timer: Timer,
  check: Check,
  book: BookOpen,
  droplet: Droplet,
  star: Star,
  sun: Sun,
  moon: Moon,
  coffee: Coffee,
  dumbbell: Dumbbell,
  footprints: Footprints,
};

export function trackerIcon(key: string): LucideIcon {
  return TRACKER_ICON_COMPONENTS[key as TrackerIcon] ?? Target;
}
