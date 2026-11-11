/**
 * Casio watch model registry.
 *
 * Ported from Gadgetbridge's Casio family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name (`AbstractDeviceCoordinator.supports`), so every pattern here is written
 * with explicit `^`/`$`. Matching is case-sensitive, as upstream's patterns are.
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/casio/
 *   CasioConstants.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/casio/
 *   CasioDeviceCoordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/casio/
 *   Casio2C2DDeviceCoordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/casio/
 *   <model>/<Model>DeviceCoordinator.java (listed in each entry's `sourceFiles`)
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/
 *   CasioSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/
 *   Casio2C2DSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/
 *   BasicCasio2C2DSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/
 *   AbstractCasioConvoyFetchOperation.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio/
 *   <model>/<Model>DeviceSupport.java and FetchStepCountDataOperation.java
 *
 * Two GATT roles
 * --------------
 * `CasioSupport` models (GB-5600B, GB-6900B, GB-X6900B, STB-1000) make the
 * *phone* the GATT server: the watch connects to the phone and pushes clock,
 * alarm and notification traffic. There is no recorded-data path at all, so
 * those models are connection-only here (`records: []`).
 *
 * `Casio2C2DSupport` models make the phone the GATT client: requests go out on
 * `26eb002c`/`26eb002d` and block transfers arrive on `26eb0023`/`26eb0024`.
 *
 * Record kinds
 * ------------
 * The only health data the upstream Casio code reads is a step counter. There
 * is no heart-rate or sleep capture anywhere in this family, so the frozen
 * contract is `steps_interval` and nothing else.
 *
 * Steps coverage is narrower than "every client-role model":
 * - GBX-100 / GBD-100 / GBD-H1000 / GBD-200: `FetchStepCountDataOperation`
 *   walks a TLV payload of hourly bins (XOR 0xFF encoded).
 * - GG-B100: `FetchStepCountDataOperation` parses a 160-byte life log
 *   (not XOR encoded).
 * - ECB-S100 / GW-B5600 / GMW-B5000: `BasicCasio2C2DSupport` implements no
 *   `onFetchRecordedData` override, so upstream has no steps fetch for them.
 *   They are client-role but connection-only, and `records` is empty rather
 *   than claiming a capture path that does not exist.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the codec is expected to reach;
 * it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Watch Features service (`26eb000d`); the only service the family needs. */
export const CASIO_WATCH_FEATURES_SERVICE_UUID = "26eb000d-b012-49a8-b1f8-394fb2032b0f";
/** Phone → watch feature requests (`26eb002c`). */
export const CASIO_READ_REQUEST_FEATURES_UUID = "26eb002c-b012-49a8-b1f8-394fb2032b0f";
/** Phone → watch feature writes, watch → phone feature notifications (`26eb002d`). */
export const CASIO_ALL_FEATURES_UUID = "26eb002d-b012-49a8-b1f8-394fb2032b0f";
/** Block-transfer request/ACK characteristic, "h0011" (`26eb0023`). */
export const CASIO_DATA_REQUEST_UUID = "26eb0023-b012-49a8-b1f8-394fb2032b0f";
/** Block-transfer payload characteristic, "h0014" (`26eb0024`). */
export const CASIO_CONVOY_UUID = "26eb0024-b012-49a8-b1f8-394fb2032b0f";
/** Text-push notification characteristic (`26eb0030`); not used for capture. */
export const CASIO_NOTIFICATION_UUID = "26eb0030-b012-49a8-b1f8-394fb2032b0f";
/** Standard Client Characteristic Configuration descriptor. */
export const CASIO_CCCD_UUID = "00002902-0000-1000-8000-00805f9b34fb";

/** Record kinds this family can emit. */
export type CasioRecordType = "steps_interval";

/** Stable upstream YAML ids for the twelve registered models. */
export type CasioModelId =
  | "casio_ecb-s100"
  | "casio_gb-5600b"
  | "casio_gb-6900b"
  | "casio_gb-x6900b"
  | "casio_stb-1000"
  | "casio_gbx-100"
  | "casio_gbd-100"
  | "casio_gbd-200"
  | "casio_gbd-h1000"
  | "casio_gw-b5600"
  | "casio_gmw-b5000"
  | "casio_gg-b100";

/**
 * GATT role. `server` models make the phone a GATT server and have no data
 * path; `client` models let the phone request block transfers.
 */
export type CasioRole = "client" | "server";

/** Which upstream steps payload the model answers with. */
export type CasioStepsSource = "hourly-tlv" | "life-log";

export type CasioModel = Readonly<{
  /** Upstream YAML id. */
  id: CasioModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns. `Matcher.matches()` anchors the whole
   * string, so patterns are written with explicit `^`/`$`.
   */
  bleNamePatterns: readonly RegExp[];
  /** GATT role; `server` models are connection-only. */
  role: CasioRole;
  /** Record kinds the model's capture path can emit. */
  records: readonly CasioRecordType[];
  /** Steps payload shape, or null when upstream implements no fetch. */
  stepsSource: CasioStepsSource | null;
  /** True when the CONVOY payload is XOR 0xFF encoded (GBX-100/GBD-200 family). */
  stepPayloadXor: boolean;
  /**
   * GBD-200: entering the watch main menu sends `3d 01` and resets the watch's
   * CONVOY state, so the phone must toggle CCCDs and warm it with a dummy
   * steps fetch (`CasioGBD200DeviceSupport.handleMainMenuResync`).
   */
  mainMenuResync: boolean;
  /**
   * BasicCasio2C2D models (ECB-S100, GW-B5600, GMW-B5000): reconnect once when
   * `26eb002c`/`26eb002d` are not discovered on the first connect
   * (`BasicCasio2C2DSupport.initializeDevice`, upstream issue 3216).
   */
  reconnectOnMissingCharacteristics: boolean;
  /**
   * Pairing hint shown next to the model, or null. The GB-6900B family needs
   * Bluetooth toggled on the watch before the first connection.
   */
  pairingHint: string | null;
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const DEVICES_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/casio";
const SERVICE_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/casio";

const SHARED_SOURCE_FILES: readonly string[] = [
  `${DEVICES_ROOT}/CasioConstants.java`,
  `${DEVICES_ROOT}/CasioDeviceCoordinator.java`,
  `${DEVICES_ROOT}/Casio2C2DDeviceCoordinator.java`,
  `${SERVICE_ROOT}/CasioSupport.java`,
  `${SERVICE_ROOT}/Casio2C2DSupport.java`,
  `${SERVICE_ROOT}/BasicCasio2C2DSupport.java`,
  `${SERVICE_ROOT}/AbstractCasioConvoyFetchOperation.java`,
];

const SERVICES: readonly string[] = [CASIO_WATCH_FEATURES_SERVICE_UUID];

const STEPS: readonly CasioRecordType[] = ["steps_interval"];
const NO_RECORDS: readonly CasioRecordType[] = [];

const GB6900_PAIRING_HINT =
  "Turn Bluetooth off and on again on the watch before the first connection; " +
  "the GB-6900B family does not accept a new bond otherwise.";

type ModelDefinition = Readonly<{
  id: CasioModelId;
  displayName: string;
  /** Upstream coordinator class name, used for provenance. */
  coordinator: string;
  /** Upstream support class name, used for provenance. */
  support: string;
  patterns: readonly RegExp[];
  role: CasioRole;
  stepsSource?: CasioStepsSource;
  stepPayloadXor?: boolean;
  mainMenuResync?: boolean;
  reconnectOnMissingCharacteristics?: boolean;
  pairingHint?: string;
  /** Extra upstream files beyond the coordinator, support and shared set. */
  extraSourceFiles?: readonly string[];
}>;

/**
 * The twelve models, in upstream catalog order.
 *
 * The GB-6900B coordinator pattern is `CASIO.*(6900B|5600B|STB-1000).*`, so
 * GB-X6900B is routed to the same GATT-server support as GB-6900B; it is
 * registered separately because the catalog lists it separately.
 */
const DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "casio_ecb-s100",
    displayName: "Casio ECB-S100",
    coordinator: "CasioECBS100DeviceCoordinator",
    support: "CasioECBS100DeviceSupport",
    // Upstream `Pattern.compile("CASIO ECB-S100")` under `matches()`.
    patterns: [/^CASIO ECB-S100$/],
    role: "client",
    reconnectOnMissingCharacteristics: true,
  },
  {
    id: "casio_gb-5600b",
    displayName: "Casio GB-5600B",
    coordinator: "CasioGB6900DeviceCoordinator",
    support: "CasioGB6900DeviceSupport",
    // Upstream `CASIO.*(6900B|5600B|STB-1000).*`.
    patterns: [/^CASIO.*5600B.*$/],
    role: "server",
    pairingHint: GB6900_PAIRING_HINT,
    extraSourceFiles: [`${SERVICE_ROOT}/gb6900/CasioGB6900HandlerThread.java`],
  },
  {
    // Listed before GB-6900B: upstream matches both with one pattern
    // (`CASIO.*(6900B|5600B|STB-1000).*`), so the registry disambiguates the
    // catalog id with the narrower GB-X6900B pattern first.
    id: "casio_gb-x6900b",
    displayName: "Casio GB-X6900B",
    coordinator: "CasioGB6900DeviceCoordinator",
    support: "CasioGB6900DeviceSupport",
    patterns: [/^CASIO.*X6900B.*$/],
    role: "server",
    pairingHint: GB6900_PAIRING_HINT,
    extraSourceFiles: [`${SERVICE_ROOT}/gb6900/CasioGB6900HandlerThread.java`],
  },
  {
    id: "casio_gb-6900b",
    displayName: "Casio GB-6900B",
    coordinator: "CasioGB6900DeviceCoordinator",
    support: "CasioGB6900DeviceSupport",
    patterns: [/^CASIO.*6900B.*$/],
    role: "server",
    pairingHint: GB6900_PAIRING_HINT,
    extraSourceFiles: [`${SERVICE_ROOT}/gb6900/CasioGB6900HandlerThread.java`],
  },
  {
    id: "casio_stb-1000",
    displayName: "Casio STB-1000",
    coordinator: "CasioGB6900DeviceCoordinator",
    support: "CasioGB6900DeviceSupport",
    patterns: [/^CASIO.*STB-1000.*$/],
    role: "server",
    pairingHint: GB6900_PAIRING_HINT,
    extraSourceFiles: [`${SERVICE_ROOT}/gb6900/CasioGB6900HandlerThread.java`],
  },
  {
    id: "casio_gbx-100",
    displayName: "Casio GBX-100",
    coordinator: "CasioGBX100DeviceCoordinator",
    support: "CasioGBX100DeviceSupport",
    // Upstream `CASIO.*(GBX-100|GBD-100|GBD-H1000)` under `matches()`.
    patterns: [/^CASIO.*GBX-100$/],
    role: "client",
    stepsSource: "hourly-tlv",
    stepPayloadXor: true,
  },
  {
    id: "casio_gbd-100",
    displayName: "Casio GBD-100",
    coordinator: "CasioGBX100DeviceCoordinator",
    support: "CasioGBX100DeviceSupport",
    patterns: [/^CASIO.*GBD-100$/],
    role: "client",
    stepsSource: "hourly-tlv",
    stepPayloadXor: true,
  },
  {
    id: "casio_gbd-200",
    displayName: "Casio GBD-200",
    coordinator: "CasioGBD200DeviceCoordinator",
    support: "CasioGBD200DeviceSupport",
    // Upstream `^CASIO GBD-200.*`.
    patterns: [/^CASIO GBD-200.*$/],
    role: "client",
    stepsSource: "hourly-tlv",
    stepPayloadXor: true,
    mainMenuResync: true,
  },
  {
    id: "casio_gbd-h1000",
    displayName: "Casio GBD-H1000",
    coordinator: "CasioGBX100DeviceCoordinator",
    support: "CasioGBX100DeviceSupport",
    patterns: [/^CASIO.*GBD-H1000$/],
    role: "client",
    stepsSource: "hourly-tlv",
    stepPayloadXor: true,
  },
  {
    id: "casio_gw-b5600",
    displayName: "Casio GW-B5600",
    coordinator: "CasioGWB5600DeviceCoordinator",
    support: "CasioGWB5600DeviceSupport",
    // Upstream `Pattern.compile("CASIO GW-B5600")` under `matches()`.
    patterns: [/^CASIO GW-B5600$/],
    role: "client",
    reconnectOnMissingCharacteristics: true,
  },
  {
    id: "casio_gmw-b5000",
    displayName: "Casio GMW-B5000",
    coordinator: "CasioGMWB5000DeviceCoordinator",
    support: "CasioGWB5600DeviceSupport",
    // Upstream `Pattern.compile("CASIO GMW-B5000")` under `matches()`.
    patterns: [/^CASIO GMW-B5000$/],
    role: "client",
    reconnectOnMissingCharacteristics: true,
  },
  {
    id: "casio_gg-b100",
    displayName: "Casio GG-B100",
    coordinator: "CasioGGB100DeviceCoordinator",
    support: "CasioGGB100DeviceSupport",
    // Upstream `^CASIO GG-B100.*`.
    patterns: [/^CASIO GG-B100.*$/],
    role: "client",
    stepsSource: "life-log",
    stepPayloadXor: false,
  },
];

export const CASIO_MODELS: readonly CasioModel[] = DEFINITIONS.map((definition) => ({
  id: definition.id,
  displayName: definition.displayName,
  transportValidated: false,
  bleNamePatterns: definition.patterns,
  role: definition.role,
  records: definition.stepsSource ? STEPS : NO_RECORDS,
  stepsSource: definition.stepsSource ?? null,
  stepPayloadXor: definition.stepPayloadXor ?? false,
  mainMenuResync: definition.mainMenuResync ?? false,
  reconnectOnMissingCharacteristics: definition.reconnectOnMissingCharacteristics ?? false,
  pairingHint: definition.pairingHint ?? null,
  serviceUuids: SERVICES,
  sourceFiles: [
    `${DEVICES_ROOT}/${coordinatorPath(definition.coordinator)}.java`,
    `${SERVICE_ROOT}/${supportPath(definition.support)}.java`,
    ...(definition.stepsSource
      ? [`${SERVICE_ROOT}/${supportPath(definition.support, "FetchStepCountDataOperation")}.java`]
      : []),
    ...(definition.extraSourceFiles ?? []),
    ...SHARED_SOURCE_FILES,
  ],
}));

/** Upstream package directory for a coordinator class. */
function coordinatorPath(className: string): string {
  return `${modelDirectory(className)}/${className}`;
}

/** Upstream package directory for a support class. */
function supportPath(className: string, file = className): string {
  return `${modelDirectory(className)}/${file}`;
}

/** Maps a coordinator/support class name to its upstream package directory. */
function modelDirectory(className: string): string {
  const table: Readonly<Record<string, string>> = {
    CasioECBS100DeviceCoordinator: "ecbs100",
    CasioECBS100DeviceSupport: "ecbs100",
    CasioGB6900DeviceCoordinator: "gb6900",
    CasioGB6900DeviceSupport: "gb6900",
    CasioGBX100DeviceCoordinator: "gbx100",
    CasioGBX100DeviceSupport: "gbx100",
    CasioGBD200DeviceCoordinator: "gbd200",
    CasioGBD200DeviceSupport: "gbd200",
    CasioGGB100DeviceCoordinator: "ggb100",
    CasioGGB100DeviceSupport: "ggb100",
    CasioGWB5600DeviceCoordinator: "gwb5600",
    CasioGWB5600DeviceSupport: "gwb5600",
    CasioGMWB5000DeviceCoordinator: "gwb5600",
  };
  return table[className] ?? ".";
}

const MODEL_BY_ID = new Map<CasioModelId, CasioModel>(
  CASIO_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getCasioModel(id: CasioModelId): CasioModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered Casio model.
 *
 * Matching is name-only: upstream's coordinator filter is the Watch Features
 * service, but the name is what selects the model. Patterns are full-string
 * (Java `matches()`) and case-sensitive. Returns null when nothing matches.
 */
export function matchCasioDevice(name: string | null | undefined): CasioModel | null {
  if (!name) return null;
  for (const model of CASIO_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}

/** True when the model has a steps capture path in this codec. */
export function casioHasStepsPath(model: Pick<CasioModel, "stepsSource" | "role">): boolean {
  return model.role === "client" && model.stepsSource !== null;
}
