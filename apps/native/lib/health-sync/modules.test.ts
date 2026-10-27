import { describe, expect, test } from "bun:test";
import { MOBILE_RECORD_TYPES } from "@openvalens/api/contracts/mobile-ingest";
import { PERSON_MODULES } from "@openvalens/api/presenters/modules";

import type { HealthSource } from "./drain";
import { HEALTHKIT_SLEEP_TYPE, HEALTHKIT_TYPE_IDENTIFIERS } from "./healthkit-types";
import type { MobileRecordType } from "./map-health-connect";
import type { HealthKitRecordType } from "./map-healthkit";
import {
  healthConnectPermissionsForModules,
  healthKitReadTypesForModules,
  recordTypeModule,
  sourceForModules,
  syncableRecordTypes,
} from "./modules";
import { HEALTH_CONNECT_RECORD_TYPES, SYNCED_TYPES } from "./record-types";

const HEALTHKIT_TYPES = Object.keys(HEALTHKIT_TYPE_IDENTIFIERS) as HealthKitRecordType[];

describe("record types map to modules", () => {
  test("steps, distance, active energy and workouts are activity; heart rate is heart; sleep is sleep; weight and body fat are body", () => {
    const byModule = Object.fromEntries(
      MOBILE_RECORD_TYPES.map((type) => [type, recordTypeModule(type)]),
    );
    expect(byModule).toEqual({
      weight: "body",
      body_fat: "body",
      steps: "activity",
      heart_rate: "heart",
      active_calories: "activity",
      distance: "activity",
      sleep_session: "sleep",
      workout: "activity",
      sleep_segment: "sleep",
    });
  });
});

describe("only enabled modules' types sync", () => {
  test("not chosen (or unknown) syncs every type", () => {
    for (const profile of [null, undefined, { enabledModules: null }])
      expect(syncableRecordTypes(SYNCED_TYPES, profile)).toEqual(SYNCED_TYPES);
  });

  test("a chosen list keeps only its modules' types, in order", () => {
    expect(syncableRecordTypes(SYNCED_TYPES, { enabledModules: ["sleep", "body"] })).toEqual([
      "weight",
      "body_fat",
      "sleep_session",
    ]);
    expect(syncableRecordTypes(SYNCED_TYPES, { enabledModules: ["food", "labs"] })).toEqual([]);
  });

  test("Health Connect asks only for enabled modules' record types", () => {
    expect(healthConnectPermissionsForModules(SYNCED_TYPES, { enabledModules: ["heart"] })).toEqual(
      [{ accessType: "read", recordType: HEALTH_CONNECT_RECORD_TYPES.heart_rate }],
    );
    expect(healthConnectPermissionsForModules(SYNCED_TYPES, null)).toHaveLength(
      SYNCED_TYPES.length,
    );
    expect(healthConnectPermissionsForModules(SYNCED_TYPES, { enabledModules: [] })).toEqual([]);
  });

  test("HealthKit asks only for enabled modules' identifiers", () => {
    expect(healthKitReadTypesForModules(HEALTHKIT_TYPES, { enabledModules: ["sleep"] })).toEqual([
      HEALTHKIT_SLEEP_TYPE,
    ]);
    expect(healthKitReadTypesForModules(HEALTHKIT_TYPES, { enabledModules: ["activity"] })).toEqual(
      [
        "HKQuantityTypeIdentifierStepCount",
        "HKQuantityTypeIdentifierActiveEnergyBurned",
        "HKQuantityTypeIdentifierDistanceWalkingRunning",
        "HKWorkoutTypeIdentifier",
      ],
    );
    expect(
      healthKitReadTypesForModules(HEALTHKIT_TYPES, { enabledModules: [...PERSON_MODULES] }),
    ).toHaveLength(HEALTHKIT_TYPES.length);
  });

  test("the sync source never reads a hidden module's types", async () => {
    const read: MobileRecordType[] = [];
    const source: HealthSource = {
      grantedTypes: async () => ["weight", "steps", "heart_rate", "sleep_session"],
      captureToken: async (type) => {
        read.push(type);
        return "t";
      },
      readWindow: async () => [],
      getChanges: async () => ({
        upserts: [],
        deletions: [],
        nextToken: "t",
        hasMore: false,
        expired: false,
      }),
    };
    const filtered = sourceForModules(source, { enabledModules: ["heart", "sleep"] });
    expect(await filtered.grantedTypes()).toEqual(["heart_rate", "sleep_session"]);
    expect(await sourceForModules(source, null).grantedTypes()).toEqual([
      "weight",
      "steps",
      "heart_rate",
      "sleep_session",
    ]);
    expect(filtered.readWindow).toBe(source.readWindow);
  });
});
