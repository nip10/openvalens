import { useThemeColor as useHeroThemeColor } from "heroui-native";

/**
 * Reads a color from the active uniwind theme by its openhealth token name.
 *
 * heroui-native's `useThemeColor` only knows its own token names at the type
 * level, but the bridge CSS variables make openhealth names available at
 * runtime. This wrapper casts the name so TypeScript stays happy.
 */
export function useThemeColor(name: string): string {
  return useHeroThemeColor(name as any) as unknown as string;
}
