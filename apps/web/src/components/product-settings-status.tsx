import { Trans } from "@lingui/react/macro";
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
      <p className="text-sm text-ink-3" role="status">
        <Trans>Loading display defaults…</Trans>
      </p>
    );
  }

  if (isError && !data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        <Trans>Display defaults unavailable · showing metric fallback</Trans>
      </p>
    );
  }

  if (isError && data) {
    return (
      <p className="text-sm text-ink-3" role="status">
        <Trans>Display defaults refresh failed · showing last loaded defaults</Trans>
      </p>
    );
  }

  return null;
}
