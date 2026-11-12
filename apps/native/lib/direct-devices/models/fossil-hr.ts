/**
 * Fossil Hybrid HR family registry: Fossil Hybrid HR, Fossil Gen 6 Hybrid and
 * Skagen Jorn Gen 6 (issue #429).
 *
 * Upstream (Gadgetbridge 8976702fc3d00e6008c91fe994668cb4027f7bc2) discovers
 * every QHybrid watch by service `3dda0001-…` only and never uses the
 * advertised name; the model is decided after connecting, from the Device
 * Information Firmware Revision (which picks the HR adapter) and Model Number
 * (which names the model). See docs/research/notes/Fossil Hybrid HR protocol/
 * fossil-hybrid-hr-protocol.md §1.
 *
 * Health data: per-minute steps, plus per-minute heart rate in the HR variant
 * of the activity file. Upstream stores no sleep for these watches (spec §7);
 * SpO2 and workout summaries are parsed upstream but have no record type here.
 *
 * Non-HR Q Hybrids (`fossil_q_hybrid`) use a different, unencrypted adapter and
 * `citizen_cz_gen2` has no upstream mapping; both are out of scope.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import { FOSSIL_SERVICE_UUID } from "../protocol/fossil-hr";

export { FOSSIL_SERVICE_UUID };

export type FossilHrModelId = "fossil_hybrid_hr" | "fossil_gen_6_hybrid" | "skagen_jorn_gen_6";
export type FossilHrRecordType = "steps" | "heart_rate";

export type FossilHrModel = Readonly<{
  /** Upstream YAML id. */
  id: FossilHrModelId;
  displayName: string;
  /** Always false: nothing in this family is hardware-validated here. */
  transportValidated: false;
  /** Model Number (0x2A24) values upstream maps to this model (`WatchAdapter:80-96`). */
  modelNumbers: readonly string[];
  records: readonly FossilHrRecordType[];
  /** True: activity history syncs with the user's 16-byte key. */
  sync: true;
  serviceUuids: readonly string[];
  sourceFiles: readonly string[];
}>;

const SERVICE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/qhybrid";
const SOURCE_FILES: readonly string[] = [
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/qhybrid/QHybridCoordinator.kt",
  `${SERVICE_ROOT}/QHybridSupport.java`,
  `${SERVICE_ROOT}/adapter/fossil_hr/FossilHRWatchAdapter.java`,
  `${SERVICE_ROOT}/requests/fossil_hr/authentication/VerifyPrivateKeyRequest.java`,
  `${SERVICE_ROOT}/requests/fossil_hr/file/FileEncryptedGetRequest.java`,
  `${SERVICE_ROOT}/requests/fossil/file/FileLookupRequest.java`,
  `${SERVICE_ROOT}/requests/fossil/file/FileDeleteRequest.java`,
  `${SERVICE_ROOT}/parser/ActivityFileParser.java`,
];

const RECORDS: readonly FossilHrRecordType[] = ["steps", "heart_rate"];

export const FOSSIL_HR_MODELS: readonly FossilHrModel[] = [
  {
    id: "fossil_hybrid_hr",
    displayName: "Fossil Hybrid HR",
    transportValidated: false,
    modelNumbers: ["IV.0.0", "DN.1.0"],
    records: RECORDS,
    sync: true,
    serviceUuids: [FOSSIL_SERVICE_UUID],
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "fossil_gen_6_hybrid",
    displayName: "Fossil Gen 6 Hybrid",
    transportValidated: false,
    modelNumbers: ["VA.0.0", "WA.0.0"],
    records: RECORDS,
    sync: true,
    serviceUuids: [FOSSIL_SERVICE_UUID],
    sourceFiles: SOURCE_FILES,
  },
  {
    // INFERRED: upstream has no Skagen string; the Jorn is assumed to be a
    // rebadged Gen 6 Hybrid reporting the same model numbers (spec §1.2).
    id: "skagen_jorn_gen_6",
    displayName: "Skagen Jorn Gen 6",
    transportValidated: false,
    modelNumbers: ["VA.0.0", "WA.0.0"],
    records: RECORDS,
    sync: true,
    serviceUuids: [FOSSIL_SERVICE_UUID],
    sourceFiles: SOURCE_FILES,
  },
];

const MODEL_BY_ID = new Map<FossilHrModelId, FossilHrModel>(
  FOSSIL_HR_MODELS.map((model) => [model.id, model]),
);

export function getFossilHrModel(id: FossilHrModelId): FossilHrModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Scan candidates: anything advertising the Fossil service. The advertisement
 * cannot tell HR watches from other Q Hybrids, so a candidate has no model
 * until the post-connect identity reads.
 */
export function isFossilCandidate(serviceUuids: readonly string[] | null | undefined): boolean {
  return (serviceUuids ?? []).some((uuid) => uuid.toLowerCase() === FOSSIL_SERVICE_UUID);
}

/**
 * Upstream picks the HR adapter from the Firmware Revision string
 * (`WatchAdapterFactory:25-39`): third character `1`, or prefix `IV0`, `VA`, `WA`.
 */
export function isFossilHrFirmware(firmwareRevision: string): boolean {
  return (
    firmwareRevision.charAt(2) === "1" ||
    firmwareRevision.startsWith("IV0") ||
    firmwareRevision.startsWith("VA") ||
    firmwareRevision.startsWith("WA")
  );
}

/**
 * Resolves the model from the post-connect reads. Returns null for anything
 * that is not an HR-adapter watch with a known model number, so non-HR
 * Q Hybrids and unknown hardware are refused rather than guessed.
 */
export function resolveFossilHrModel(input: {
  firmwareRevision: string;
  modelNumber: string;
  advertisedName?: string | null;
}): FossilHrModel | null {
  if (!isFossilHrFirmware(input.firmwareRevision)) return null;
  const modelNumber = input.modelNumber.trim();
  if (["IV.0.0", "DN.1.0"].includes(modelNumber)) return MODEL_BY_ID.get("fossil_hybrid_hr")!;
  if (["VA.0.0", "WA.0.0"].includes(modelNumber))
    return /skagen/i.test(input.advertisedName ?? "")
      ? MODEL_BY_ID.get("skagen_jorn_gen_6")!
      : MODEL_BY_ID.get("fossil_gen_6_hybrid")!;
  return null;
}
