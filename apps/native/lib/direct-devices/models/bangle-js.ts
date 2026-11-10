/**
 * Bangle.js / Espruino smartwatch model registry.
 *
 * Ported from Gadgetbridge's Bangle.js support at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name, so every pattern here is anchored with `^`/`$`.
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/banglejs/BangleJSCoordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/banglejs/BangleJSDeviceSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/banglejs/BangleJSConstants.java
 *
 * Upstream's coordinator regex is
 * `Bangle\.js.*|Pixl\.js.*|Puck\.js.*|MDBT42Q.*|Espruino.*`. This registry is
 * deliberately narrower: it only claims the two Bangle.js catalog models
 * (`bangle_js_1`, `bangle_js_2`). Pixl.js, Puck.js, bare MDBT42Q boards and
 * other Espruino devices share the protocol but are not registered here, so
 * they are not matched and no support is claimed for them.
 *
 * Both models are `pair_free`/`feature_high` in the upstream catalog and share
 * one protocol: the Nordic UART service, JSON lines wrapped in `GB(...)`, and
 * a 10-minute activity history stream. Bonding is optional and, when the user
 * chooses it, is handled by the BLE stack (`BONDING_STYLE_ASK` upstream).
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the codec is expected to reach;
 * it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/**
 * Nordic UART service. Naming is inverted relative to the Nordic convention,
 * exactly as upstream wires it (`BangleJSDeviceSupport.java:349-359`):
 * phone → watch writes go to the TX characteristic (0x0002) and watch → phone
 * notifications arrive on the RX characteristic (0x0003).
 */
export const BANGLE_JS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** Phone → watch write characteristic. */
export const BANGLE_JS_TX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** Watch → phone notify characteristic. */
export const BANGLE_JS_RX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** Record kinds this family can emit. */
export type BangleJsRecordType = "steps_interval" | "heart_rate";

/** Stable upstream YAML ids for the two registered Bangle.js models. */
export type BangleJsModelId = "bangle_js_1" | "bangle_js_2";

export type BangleJsModel = Readonly<{
  /** Upstream YAML id. */
  id: BangleJsModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns, matched case-sensitively like
   * upstream `Matcher.matches()`. Both revisions share upstream's single
   * `Bangle\.js.*` pattern.
   */
  bleNamePatterns: readonly RegExp[];
  /**
   * Optional advertised-name hints that pick this revision inside the shared
   * family pattern. Upstream does not distinguish Bangle.js 1 from 2 by name,
   * so this is a local heuristic only: Espruino advertises the model number in
   * the default name ("Bangle.js 2"). Without a hint the first registered
   * model is used.
   */
  nameHints?: readonly RegExp[];
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Record kinds the model's capture path can emit. */
  records: readonly BangleJsRecordType[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const SOURCE_FILES: readonly string[] = [
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/banglejs/BangleJSCoordinator.java",
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/banglejs/BangleJSDeviceSupport.java",
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/banglejs/BangleJSConstants.java",
];

const RECORDS: readonly BangleJsRecordType[] = ["steps_interval", "heart_rate"];

const SERVICES: readonly string[] = [BANGLE_JS_SERVICE_UUID];

/** Upstream coordinator pattern, restricted to the Bangle.js models. */
const BANGLE_NAME_PATTERN = /^Bangle\.js.*$/;

/**
 * The two models, in upstream catalog order. Both share the same capture path,
 * so `records` and `serviceUuids` are identical.
 */
export const BANGLE_JS_MODELS: readonly BangleJsModel[] = [
  {
    id: "bangle_js_1",
    displayName: "Bangle.js 1",
    transportValidated: false,
    bleNamePatterns: [BANGLE_NAME_PATTERN],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "bangle_js_2",
    displayName: "Bangle.js 2",
    transportValidated: false,
    bleNamePatterns: [BANGLE_NAME_PATTERN],
    nameHints: [/^Bangle\.js 2(?:$| )/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
];

const MODEL_BY_ID = new Map<BangleJsModelId, BangleJsModel>(
  BANGLE_JS_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getBangleJsModel(id: BangleJsModelId): BangleJsModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name and/or advertised service UUIDs to a
 * registered Bangle.js model.
 *
 * Name matching comes first, like upstream's coordinator regex. When the
 * advertised name cannot select a revision, a `nameHints` match (for example
 * "Bangle.js 2") wins, otherwise the first registered model is returned. When
 * no name matches, the Nordic UART service UUID is accepted as a fallback so a
 * watch that advertises no name is still reachable; the family default model
 * is returned in that case. Returns null when nothing matches.
 */
export function matchBangleJsDevice(
  name: string | null | undefined,
  serviceUuids: readonly string[] | null | undefined = [],
): BangleJsModel | null {
  if (name) {
    const familyMatch = BANGLE_JS_MODELS.find((model) =>
      model.bleNamePatterns.some((pattern) => pattern.test(name)),
    );
    if (familyMatch) {
      const hinted = BANGLE_JS_MODELS.find(
        (model) =>
          model.nameHints?.some((pattern) => pattern.test(name)) &&
          model.bleNamePatterns.some((pattern) => pattern.test(name)),
      );
      return hinted ?? familyMatch;
    }
  }
  const advertised = new Set((serviceUuids ?? []).map((uuid) => uuid.trim().toLowerCase()));
  if (advertised.has(BANGLE_JS_SERVICE_UUID)) return BANGLE_JS_MODELS[0] ?? null;
  return null;
}
