import { useProductSettings } from "@/utils/product-settings";

/**
 * Honest, minimal display-preferences status.
 *
 * - Initial load: subtle loading copy.
 * - Error with no usable preference: metric fallback warning.
 * - Error with stale cached preference: last-loaded warning.
 * - Otherwise hidden so the page intent/spacing is preserved.
 */
export function ProductSettingsStatus() {
  const { data, isPending, isError } = useProductSettings();

  if (isPending && !data) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Loading display defaults…
      </p>
    );
  }

  if (isError && !data) {
    return (
      <p className="text-xs text-destructive" role="alert">
        Display defaults unavailable · showing metric fallback
      </p>
    );
  }

  if (isError && data) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Display defaults refresh failed · showing last loaded defaults
      </p>
    );
  }

  return null;
}
