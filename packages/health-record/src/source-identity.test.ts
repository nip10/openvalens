import { describe, expect, test } from "bun:test";

import {
  buildDataSourceIdentity,
  buildSourceIdentityKey,
  readSourceIdentityTuple,
} from "./source-identity";

describe("health-record — source identity", () => {
  test("string passthrough returns the same key", () => {
    expect(buildSourceIdentityKey("oura-health-v1")).toBe("oura-health-v1");
  });

  test("tuple segments are normalized and joined", () => {
    const key = buildSourceIdentityKey({
      provider: "oura",
      importChannel: "health-connect",
      deviceType: "ring",
      deviceModel: "Oura Ring Gen3",
      softwareVersion: "2.4.1",
      originalSourceName: "Oura",
      sourceAppId: "com.ouraring.oura",
    });
    expect(key).toBe("oura|health_connect|ring|oura_ring_gen3|2.4.1|oura|com.ouraring.oura");
  });

  test("case and whitespace are normalized at segment level", () => {
    const a = buildSourceIdentityKey({ provider: "Oura", sourceAppId: " OURA " });
    const b = buildSourceIdentityKey({ provider: "oura", sourceAppId: "oura" });
    expect(a).toBe(b);
  });

  test("rich identity sets canonicalSourceKey only when >= 2 fields populated", () => {
    const identity = buildDataSourceIdentity({
      provider: "oura",
      importChannel: "health-connect",
      deviceType: null,
      deviceModel: null,
      softwareVersion: null,
      originalSourceName: null,
      sourceAppId: null,
    });
    expect(identity.canonicalSourceKey).toBeUndefined();
    expect(identity.sourceKey).toMatch(/^oura\|health_connect/);
  });

  test("existing source key takes precedence over derived key", () => {
    const identity = buildDataSourceIdentity({
      provider: "oura",
      existingSourceKey: "preferred-key",
    });
    expect(identity.sourceKey).toBe("preferred-key");
  });

  test("readSourceIdentityTuple trims and drops empty strings", () => {
    const tuple = readSourceIdentityTuple({
      provider: "  oura  ",
      deviceType: "",
      deviceModel: null,
      sourceAppId: "oura",
    });
    expect(tuple.provider).toBe("oura");
    expect(tuple.deviceType).toBeUndefined();
    expect(tuple.sourceAppId).toBe("oura");
  });
});
