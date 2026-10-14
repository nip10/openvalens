/**
 * Product display-settings query keys.
 *
 * Keys are scoped to the trusted signed-in user id so that a stale cache entry
 * from one principal can never populate the form for another principal (the
 * response includes the per-principal `canEdit` cap).
 */

export function productSettingsQueryKey(userId: string) {
  return ["product-settings", userId] as const;
}
