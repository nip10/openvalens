/**
 * Upstream Gadgetbridge device catalog (`device_support.yml`).
 *
 * This is reference data: it records what Gadgetbridge publishes about a
 * device. It is deliberately separate from `direct-device-models.ts`, which is
 * the registration allowlist for the families OpenValens actually implements.
 * Adding a device here never makes it connectable in OpenValens.
 *
 * The snapshot, its pinned revision, SHA-256 and licence notice live next to
 * this module; the refresh procedure is documented in `docs/device-catalog.md`.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */
import rawCatalog from "./device-catalog/gadgetbridge-catalog.json";

export type {
  GadgetbridgeCatalog,
  GadgetbridgeCatalogMeta,
  GadgetbridgeDevice,
  GadgetbridgeFeatureLevel,
} from "./device-catalog/types";
import type {
  GadgetbridgeCatalog,
  GadgetbridgeDevice,
  GadgetbridgeFeatureLevel,
} from "./device-catalog/types";

/** Upstream `feature_*` labels, worst-to-best is unknown/poor/partial/most/high. */
export const GADGETBRIDGE_FEATURE_LEVELS = [
  "high",
  "most",
  "partial",
  "poor",
  "unknown",
] as const satisfies readonly GadgetbridgeFeatureLevel[];

export const GADGETBRIDGE_CATALOG: GadgetbridgeCatalog =
  rawCatalog as unknown as GadgetbridgeCatalog;

/** Look up one upstream device by its stable YAML id. */
export function findGadgetbridgeDevice(id: string): GadgetbridgeDevice | undefined {
  if (!Object.hasOwn(GADGETBRIDGE_CATALOG.devices, id)) return undefined;
  return GADGETBRIDGE_CATALOG.devices[id];
}

/**
 * True when upstream marks the device experimental. Absence of a catalog entry
 * is not evidence either way, so this returns `false` only for a real entry.
 */
export function isGadgetbridgeExperimental(id: string): boolean {
  return findGadgetbridgeDevice(id)?.experimental ?? false;
}
