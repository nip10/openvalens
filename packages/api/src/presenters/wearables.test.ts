import { describe, expect, test } from "bun:test";

import { englishI18n } from "@openvalens/i18n/testing";

import {
  wearableActions,
  wearableCallbackNotice,
  wearableErrorLabel,
  wearableSendsLabel,
  wearableStatusLabel,
} from "./wearables";

describe("wearables presenter", () => {
  test("callback notice: success for connected, errors for the failure statuses", () => {
    const connected = wearableCallbackNotice("connected", "Oura");
    expect(connected?.tone).toBe("success");
    expect(englishI18n._(connected!.message)).toInclude("Oura is connected");

    for (const status of ["denied", "failed", "unauthenticated"]) {
      const notice = wearableCallbackNotice(status, "WHOOP");
      expect(notice?.tone).toBe("error");
      expect(englishI18n._(notice!.message)).toInclude("WHOOP");
    }
    expect(englishI18n._(wearableCallbackNotice("unauthenticated", "Polar")!.message)).toInclude(
      "not signed in",
    );
  });

  test("callback notice: unknown or missing status yields nothing", () => {
    expect(wearableCallbackNotice(undefined, "Oura")).toBeNull();
    expect(wearableCallbackNotice("<script>", "Oura")).toBeNull();
  });

  test("actions follow the connection status", () => {
    expect(wearableActions("not_connected")).toEqual({
      connect: true,
      syncNow: false,
      disconnect: false,
      resolveQuarantine: false,
    });
    expect(wearableActions("active")).toEqual({
      connect: false,
      syncNow: true,
      disconnect: true,
      resolveQuarantine: false,
    });
    expect(wearableActions("reconnect_needed")).toMatchObject({
      connect: true,
      syncNow: false,
      disconnect: true,
    });
    expect(wearableActions("quarantined")).toMatchObject({
      connect: true,
      syncNow: false,
      disconnect: false,
      resolveQuarantine: true,
    });
  });

  test("error label: null without a code, reconnect wording for grant failures", () => {
    expect(wearableErrorLabel(null)).toBeNull();
    expect(englishI18n._(wearableErrorLabel("reauthorization_required")!)).toInclude(
      "Connect again",
    );
    expect(englishI18n._(wearableErrorLabel("rate_limited")!)).toInclude("retry");
    expect(englishI18n._(wearableErrorLabel("sync_failed")!)).toInclude("last sync failed");
  });

  test("labels exist for every status and provider", () => {
    expect(englishI18n._(wearableStatusLabel("active"))).toBe("Connected");
    expect(englishI18n._(wearableStatusLabel("quarantined"))).toBe("Access revoked");
    expect(englishI18n._(wearableSendsLabel("oura"))).toInclude("Readiness score");
  });
});
