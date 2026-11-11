/**
 * Pebble watch model registry.
 *
 * Ported from Gadgetbridge's Pebble family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2.
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/pebble/
 *   PebbleHardware.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/pebble/
 *   PebbleCoordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/pebble/
 *   PebbleHealthSampleProvider.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/pebble/
 *   PebbleSupport.java, PebbleIoThread.java, PebbleProtocol.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/pebble/
 *   DatalogSession*.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/pebble/ble/
 *   PebbleLESupport.java, PebbleGATTClient.java, PebbleGATTServer.java,
 *   PebbleGATTConstants.java
 *
 * Transport split
 * ---------------
 * Upstream selects the transport by generation (`PebbleIoThread.connect`):
 *
 * - Pebble 2 (DIORITE), Pebble Time 2 (EMERY) and Pebble 2 Duo (FLINT) are
 *   `bleOnly` and talk PPoGATT over GATT.
 * - Pebble Classic (APLITE), Pebble Steel (APLITE), Pebble Time (BASALT),
 *   Pebble Time Steel (BASALT) and Pebble Time Round (CHALK) are Bluetooth
 *   Classic watches. Their data path is RFCOMM/SPP (UUID `00001101`), which a
 *   BLE-only stack cannot carry. They cannot pair at all here, so they are
 *   registered with `bleOnly: false`, `records: []` and `sync: false` so the
 *   UI can say so plainly instead of pretending a connection exists.
 *
 * Name matching
 * -------------
 * Upstream's coordinator accepts every Pebble with one pattern, `Pebble.*`
 * (`PebbleCoordinator.getSupportedDeviceName`). The model is then resolved
 * from the hardware revision byte in the advertisement's manufacturer data
 * (`PebbleHardware.getByHardwareId`) or from the firmware-version reply.
 *
 * This registry keeps that split:
 *
 * - `hardwareIds` and `codenamePrefixes` are the exact upstream table. Two
 *   catalogued models can share a platform (Classic/Steel on APLITE,
 *   Time/Time Steel on BASALT), and upstream cannot tell them apart at the
 *   platform level either.
 * - `bleNamePatterns` describe the advertised-name shapes from
 *   `PebbleHardware.isBleOnlyByName` / `isLePebbleCompanion`: the three BLE
 *   models advertise as `Pebble XXXX` (four hex digits) and are
 *   indistinguishable by name alone; the Classic generation advertises as
 *   `Pebble` / `Pebble-LE XXXX` and the Time generation as `Pebble Time` /
 *   `Pebble Time LE XXXX`. The Steel and Time Steel entries also accept their
 *   marketed BR/EDR names (`Pebble Steel`, `Pebble Time Steel`); upstream's
 *   single `Pebble.*` pattern accepts those too.
 *
 * `matchPebbleDevice(name, hardwareId?)` resolves the hardware id first when
 * it is available (the exact model), then falls back to the name shape. The
 * name-only fallback returns the first model registered for that shape, which
 * is documented on each entry; callers that need the exact model must pass the
 * hardware id (or parse the firmware-version reply).
 *
 * Health coverage
 * ---------------
 * The BLE models expose the DATALOG health sessions: 1-minute `steps`
 * (log tag 81, versions 5/6/7/12/13/14), `sleep_session` bounds (tag 83) with
 * stage intervals (tag 84), and per-minute `heart_rate` embedded in the steps
 * records (v>=7). Tag 85 (standalone HR) is a stub upstream and produces no
 * records. No new record types are introduced.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the codec is expected to reach;
 * it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Pebble GATT service the watch exposes for pairing/PPoGATT (`0000fed9-…`). */
export const PEBBLE_SERVICE_UUID = "0000fed9-0000-1000-8000-00805f9b34fb";

/** Record kinds the BLE models can emit. No new record types. */
export type PebbleRecordType = "steps" | "heart_rate" | "sleep_session";

/** Upstream `PebbleHardware.Platform` names. */
export type PebblePlatform = "aplite" | "basalt" | "chalk" | "diorite" | "emery" | "flint";

/** Stable upstream YAML ids for the eight catalogued models. */
export type PebbleModelId =
  | "pebble_classic"
  | "pebble_steel"
  | "pebble_time"
  | "pebble_time_steel"
  | "pebble_time_round"
  | "pebble_classic_2"
  | "pebble_2_duo"
  | "pebble_time_2";

export type PebbleModel = Readonly<{
  /** Upstream YAML id. */
  id: PebbleModelId;
  displayName: string;
  /** Upstream `PebbleHardware.Platform`. */
  platform: PebblePlatform;
  /**
   * Upstream `Platform.isBleOnly()`. True only for the three models whose data
   * path is PPoGATT over GATT; false for the Bluetooth Classic generation.
   */
  bleOnly: boolean;
  /** Upstream `Platform.hasHealth()`. */
  hasHealth: boolean;
  /** Upstream `Platform.hasHRM()`. */
  hasHrm: boolean;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns, matched case-sensitively like
   * upstream `Matcher.matches()`.
   */
  bleNamePatterns: readonly RegExp[];
  /**
   * Hardware revision ids from `PebbleHardware` that map to this model's
   * platform. Shared by models on the same platform.
   */
  hardwareIds: readonly number[];
  /** Codename prefixes from `PebbleHardware.Platform`. */
  codenamePrefixes: readonly string[];
  /** Record kinds the model's capture path can emit. Empty for BT-Classic. */
  records: readonly PebbleRecordType[];
  /** True when the model syncs stored history on connection. */
  sync: boolean;
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const DEVICES_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/pebble";
const SERVICE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/pebble";

const SHARED_SOURCE_FILES: readonly string[] = [
  `${DEVICES_ROOT}/PebbleHardware.java`,
  `${DEVICES_ROOT}/PebbleCoordinator.java`,
  `${DEVICES_ROOT}/PebbleHealthSampleProvider.java`,
  `${SERVICE_ROOT}/PebbleSupport.java`,
  `${SERVICE_ROOT}/PebbleIoThread.java`,
  `${SERVICE_ROOT}/PebbleProtocol.java`,
  `${SERVICE_ROOT}/DatalogSession.java`,
  `${SERVICE_ROOT}/DatalogSessionPebbleHealth.java`,
  `${SERVICE_ROOT}/DatalogSessionHealthSteps.java`,
  `${SERVICE_ROOT}/DatalogSessionHealthSleep.java`,
  `${SERVICE_ROOT}/DatalogSessionHealthOverlayData.java`,
  `${SERVICE_ROOT}/DatalogSessionHealthHR.java`,
  `${SERVICE_ROOT}/ble/PebbleLESupport.java`,
  `${SERVICE_ROOT}/ble/PebbleGATTClient.java`,
  `${SERVICE_ROOT}/ble/PebbleGATTServer.java`,
  `${SERVICE_ROOT}/ble/PebbleGATTConstants.java`,
];

const BLE_RECORDS: readonly PebbleRecordType[] = ["steps", "heart_rate", "sleep_session"];
const NO_RECORDS: readonly PebbleRecordType[] = [];
const BLE_SERVICES: readonly string[] = [PEBBLE_SERVICE_UUID];
const NO_SERVICES: readonly string[] = [];

type ModelDefinition = Readonly<{
  id: PebbleModelId;
  displayName: string;
  platform: PebblePlatform;
  bleOnly: boolean;
  hasHealth: boolean;
  hasHrm: boolean;
  patterns: readonly RegExp[];
  hardwareIds: readonly number[];
  codenamePrefixes: readonly string[];
  /** Extra provenance files, relative to the app repo root. */
  extraSourceFiles?: readonly string[];
}>;

/** `Pebble XXXX` — the three BLE-only models share this shape. */
const BLE_ONLY_NAME = /^Pebble [0-9A-Fa-f]{4}$/;
/** `Pebble-LE XXXX` — the Classic generation's LE companion. */
const APLITE_LE_NAME = /^Pebble-LE [0-9A-Fa-f]{4}$/;
/** `Pebble Time LE XXXX` — the Time generation's LE companion. */
const BASALT_LE_NAME = /^Pebble Time LE [0-9A-Fa-f]{4}$/;
/** `Pebble Time Round LE XXXX` — the Round generation's LE companion. */
const CHALK_LE_NAME = /^Pebble Time Round LE [0-9A-Fa-f]{4}$/;

/**
 * The eight catalogued models, in upstream catalog order. Hardware ids and
 * codenames are copied from the `PebbleHardware` static registry; the
 * `unknown` id 0 is omitted because it is a fallback, not a model.
 */
const DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "pebble_classic",
    displayName: "Pebble Classic",
    platform: "aplite",
    bleOnly: false,
    hasHealth: false,
    hasHrm: false,
    patterns: [/^Pebble$/, APLITE_LE_NAME],
    hardwareIds: [1, 2, 3, 4, 5, 6, 254, 255],
    codenamePrefixes: [],
  },
  {
    id: "pebble_steel",
    displayName: "Pebble Steel",
    platform: "aplite",
    bleOnly: false,
    hasHealth: false,
    hasHrm: false,
    patterns: [/^Pebble Steel$/, APLITE_LE_NAME],
    hardwareIds: [1, 2, 3, 4, 5, 6, 254, 255],
    codenamePrefixes: [],
  },
  {
    id: "pebble_time",
    displayName: "Pebble Time",
    platform: "basalt",
    bleOnly: false,
    hasHealth: true,
    hasHrm: false,
    patterns: [/^Pebble Time$/, BASALT_LE_NAME],
    hardwareIds: [7, 8, 10, 252, 253],
    codenamePrefixes: ["snowy"],
  },
  {
    id: "pebble_time_steel",
    displayName: "Pebble Time Steel",
    platform: "basalt",
    bleOnly: false,
    hasHealth: true,
    hasHrm: false,
    patterns: [/^Pebble Time Steel$/, BASALT_LE_NAME],
    hardwareIds: [7, 8, 10, 252, 253],
    codenamePrefixes: ["snowy"],
  },
  {
    id: "pebble_time_round",
    displayName: "Pebble Time Round",
    platform: "chalk",
    bleOnly: false,
    hasHealth: true,
    hasHrm: false,
    patterns: [/^Pebble Time Round$/, CHALK_LE_NAME],
    hardwareIds: [9, 11, 251],
    codenamePrefixes: ["spalding"],
  },
  {
    id: "pebble_classic_2",
    displayName: "Pebble Classic 2",
    platform: "diorite",
    bleOnly: true,
    hasHealth: true,
    hasHrm: true,
    patterns: [BLE_ONLY_NAME],
    hardwareIds: [12, 14, 248, 250],
    codenamePrefixes: ["silk"],
  },
  {
    id: "pebble_2_duo",
    displayName: "Pebble 2 Duo",
    platform: "flint",
    bleOnly: true,
    hasHealth: true,
    hasHrm: false,
    patterns: [BLE_ONLY_NAME],
    hardwareIds: [15],
    codenamePrefixes: ["asterix"],
  },
  {
    id: "pebble_time_2",
    displayName: "Pebble Time 2",
    platform: "emery",
    bleOnly: true,
    hasHealth: true,
    hasHrm: true,
    patterns: [BLE_ONLY_NAME],
    hardwareIds: [13, 16, 17, 18, 243, 244, 247, 249],
    codenamePrefixes: ["robert", "obelix"],
  },
];

export const PEBBLE_MODELS: readonly PebbleModel[] = DEFINITIONS.map((definition) => ({
  id: definition.id,
  displayName: definition.displayName,
  platform: definition.platform,
  bleOnly: definition.bleOnly,
  hasHealth: definition.hasHealth,
  hasHrm: definition.hasHrm,
  transportValidated: false,
  bleNamePatterns: definition.patterns,
  hardwareIds: definition.hardwareIds,
  codenamePrefixes: definition.codenamePrefixes,
  records: definition.bleOnly ? BLE_RECORDS : NO_RECORDS,
  sync: definition.bleOnly,
  serviceUuids: definition.bleOnly ? BLE_SERVICES : NO_SERVICES,
  sourceFiles: [...(definition.extraSourceFiles ?? []), ...SHARED_SOURCE_FILES],
}));

const MODEL_BY_ID = new Map<PebbleModelId, PebbleModel>(
  PEBBLE_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getPebbleModel(id: PebbleModelId): PebbleModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Resolves a hardware revision id to the first model registered for its
 * platform. Two models share a platform (Classic/Steel, Time/Time Steel), so
 * the platform-level id cannot distinguish them; upstream cannot either.
 */
export function pebbleModelByHardwareId(hardwareId: number): PebbleModel | null {
  if (!Number.isInteger(hardwareId)) return null;
  for (const model of PEBBLE_MODELS) {
    if (model.hardwareIds.includes(hardwareId)) return model;
  }
  return null;
}

/**
 * Matches an advertised BLE name (and, when available, the hardware revision
 * id from manufacturer data) to a registered Pebble model.
 *
 * The hardware id wins when supplied. Otherwise the name shape decides, and
 * the first registered model for that shape is returned: `Pebble XXXX` is
 * ambiguous between the three BLE models, and the Classic/Time shapes are
 * ambiguous between each generation's two models. Returns null when nothing
 * matches.
 */
export function matchPebbleDevice(
  name: string | null | undefined,
  hardwareId?: number | null,
): PebbleModel | null {
  if (hardwareId !== undefined && hardwareId !== null) {
    const byHardware = pebbleModelByHardwareId(hardwareId);
    if (byHardware) return byHardware;
  }
  if (!name) return null;
  for (const model of PEBBLE_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}

/** The three models that can actually connect over BLE. */
export const PEBBLE_BLE_MODELS: readonly PebbleModel[] = PEBBLE_MODELS.filter(
  (model) => model.bleOnly,
);

/** True when the model's transport is PPoGATT over GATT (and therefore usable). */
export function isPebbleBleOnly(model: Pick<PebbleModel, "bleOnly">): boolean {
  return model.bleOnly;
}
