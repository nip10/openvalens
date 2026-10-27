import type { ModuleIconKey } from "@openvalens/api/presenters/modules";
import {
  CalendarHeart,
  FlaskConical,
  Footprints,
  HeartPulse,
  type LucideIcon,
  MessageCircle,
  Moon,
  Pill,
  Scale,
  ShieldCheck,
  UtensilsCrossed,
} from "lucide-react-native";

/** The shared module icon keys as lucide-react-native icons. */
export const MODULE_ICON_COMPONENTS: Record<ModuleIconKey, LucideIcon> = {
  moon: Moon,
  footprints: Footprints,
  "heart-pulse": HeartPulse,
  scale: Scale,
  utensils: UtensilsCrossed,
  pill: Pill,
  flask: FlaskConical,
  "calendar-heart": CalendarHeart,
  "message-circle": MessageCircle,
  "shield-check": ShieldCheck,
};
