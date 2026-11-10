/**
 * Behavioural tests for the GloryFit model registry.
 *
 * Derived from Gadgetbridge's GloryFit family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later.
 */

import { expect, test } from "bun:test";

import {
  GLORYFIT_CMD_NOTIFY_UUID,
  GLORYFIT_CMD_SERVICE_UUID,
  GLORYFIT_CMD_WRITE_UUID,
  GLORYFIT_DATA_NOTIFY_UUID,
  GLORYFIT_DATA_SERVICE_UUID,
  GLORYFIT_DATA_WRITE_UUID,
  GLORYFIT_MODELS,
  getGloryFitModel,
  matchGloryFitDevice,
  type GloryFitModelId,
} from "./gloryfit";

const EXPECTED_IDS: readonly GloryFitModelId[] = [
  "gloryfit_d3",
  "gloryfit_r1",
  "gloryfit_s52",
  "gloryfit_swiss_peak",
  "gloryfit_t70",
  "gloryfit_y6",
  "gloryfit_y66",
  "blackview_r3max",
  "colmi_p10",
  "dotn_p66d",
  "grv_fc1",
  "haylou_watch_2_pro",
  "hifuture_zone_2",
  "imiki_frame_2",
  "kieslect_calling_smartwatch_kr_pro",
  "oukitel_bt103",
  "qecnato_s10",
];

test("the registry contains the seventeen GloryFit models exactly once", () => {
  expect(GLORYFIT_MODELS).toHaveLength(17);
  expect(new Set(GLORYFIT_MODELS.map((model) => model.id)).size).toBe(17);
  expect(GLORYFIT_MODELS.map((model) => model.id).sort()).toEqual([...EXPECTED_IDS].sort());
});

test("every model declares the same capture records and services", () => {
  for (const model of GLORYFIT_MODELS) {
    expect(model.transportValidated, model.id).toBe(false);
    expect(model.displayName.length, model.id).toBeGreaterThan(0);
    expect(model.records, model.id).toEqual(["steps_interval", "heart_rate", "sleep_session"]);
    expect(model.serviceUuids, model.id).toEqual([
      GLORYFIT_CMD_SERVICE_UUID,
      GLORYFIT_DATA_SERVICE_UUID,
    ]);
    expect(model.sourceFiles.length, model.id).toBeGreaterThan(0);
    expect(["ask", "none"], model.id).toContain(model.bonding);
  }
});

test("getGloryFitModel resolves every registered id", () => {
  for (const model of GLORYFIT_MODELS) expect(getGloryFitModel(model.id)).toBe(model);
});

test("advertised names match the upstream full-string patterns", () => {
  const cases: readonly [string, GloryFitModelId][] = [
    ["D3(ID-1A2B)", "gloryfit_d3"],
    ["R1(ID-00FF)", "gloryfit_r1"],
    ["S52", "gloryfit_s52"],
    ["Swiss Peak-9F3C", "gloryfit_swiss_peak"],
    ["T70(ID-1234)", "gloryfit_t70"],
    ["T70 (ID-1234)", "gloryfit_t70"],
    ["Y6(ID-ABCD)", "gloryfit_y6"],
    ["Y66(ID-0001)", "gloryfit_y66"],
    ["R3Max(ID-FFFF)", "blackview_r3max"],
    ["P10(ID-1234)", "colmi_p10"],
    ["P66D(ID-1234)", "dotn_p66d"],
    ["FC1(ID-1234)", "grv_fc1"],
    ["HAYLOU Watch 2 Pro", "haylou_watch_2_pro"],
    ["Zone 2(ID-1234)", "hifuture_zone_2"],
    ["Zone 2 (ID-1234)", "hifuture_zone_2"],
    ["IMIKI FRAME 2", "imiki_frame_2"],
    ["Watch Kr Pro-1234", "kieslect_calling_smartwatch_kr_pro"],
    ["BT103(ID-1234)", "oukitel_bt103"],
    ["S10", "qecnato_s10"],
  ];
  for (const [name, id] of cases)
    expect(matchGloryFitDevice(name), name).toBe(getGloryFitModel(id) ?? null);
});

test("the HiFuture Zone 2 is the only case-insensitive pattern", () => {
  expect(matchGloryFitDevice("zone 2 (id-1234)")).toBe(getGloryFitModel("hifuture_zone_2") ?? null);
  expect(matchGloryFitDevice("ZONE 2(ID-ABCD)")).toBe(getGloryFitModel("hifuture_zone_2") ?? null);
  // Every other pattern is case-sensitive like upstream Matcher.matches().
  expect(matchGloryFitDevice("d3(ID-1A2B)")).toBeNull();
  expect(matchGloryFitDevice("imiki frame 2")).toBeNull();
  expect(matchGloryFitDevice("watch kr pro-1234")).toBeNull();
  expect(matchGloryFitDevice("s10")).toBeNull();
  expect(matchGloryFitDevice("HAYLOU watch 2 pro")).toBeNull();
});

test("patterns require the exact (ID-xxxx) suffix form and reject extra text", () => {
  expect(matchGloryFitDevice("D3")).toBeNull();
  expect(matchGloryFitDevice("D3(ID-123)")).toBeNull();
  expect(matchGloryFitDevice("D3(ID-12345)")).toBeNull();
  expect(matchGloryFitDevice("D3(ID-12G4)")).toBeNull();
  expect(matchGloryFitDevice("My D3(ID-1234)")).toBeNull();
  expect(matchGloryFitDevice("D3(ID-1234) extra")).toBeNull();
  // The suffix hex is uppercase in the upstream patterns.
  expect(matchGloryFitDevice("D3(ID-1a2b)")).toBeNull();
  expect(matchGloryFitDevice("Swiss Peak-9f3c")).toBeNull();
  expect(matchGloryFitDevice("")).toBeNull();
  expect(matchGloryFitDevice(null)).toBeNull();
  expect(matchGloryFitDevice(undefined)).toBeNull();
});

test("the six upstream bonding overrides are recorded as none", () => {
  const noBonding: readonly GloryFitModelId[] = [
    "blackview_r3max",
    "dotn_p66d",
    "kieslect_calling_smartwatch_kr_pro",
    "qecnato_s10",
    "gloryfit_s52",
    "gloryfit_t70",
  ];
  for (const model of GLORYFIT_MODELS)
    expect(model.bonding, model.id).toBe(noBonding.includes(model.id) ? "none" : "ask");
});

test("the GloryFit UUIDs match the upstream constants", () => {
  expect(GLORYFIT_CMD_SERVICE_UUID).toBe("000055ff-0000-1000-8000-00805f9b34fb");
  expect(GLORYFIT_CMD_WRITE_UUID).toBe("000033f1-0000-1000-8000-00805f9b34fb");
  expect(GLORYFIT_CMD_NOTIFY_UUID).toBe("000033f2-0000-1000-8000-00805f9b34fb");
  expect(GLORYFIT_DATA_SERVICE_UUID).toBe("000056ff-0000-1000-8000-00805f9b34fb");
  expect(GLORYFIT_DATA_WRITE_UUID).toBe("000034f1-0000-1000-8000-00805f9b34fb");
  expect(GLORYFIT_DATA_NOTIFY_UUID).toBe("000034f2-0000-1000-8000-00805f9b34fb");
});
