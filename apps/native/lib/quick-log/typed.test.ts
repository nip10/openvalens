import { describe, expect, mock, test } from "bun:test";
import {
  availableLogKinds,
  drinkLogKinds,
  LOG_KINDS,
  type LogKind,
} from "@openvalens/api/presenters/log-kinds";
import { parseOneLiner, type OneLinerContext } from "@openvalens/api/presenters/one-liner";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n } from "@openvalens/i18n/testing";

import { performPickerWrite, type PickerApi, type PickerOffline } from "./perform-write";
import { buildTypedSection, type PickerItem, typedSubmitItem } from "./picker";

const now = new Date(2026, 10, 13, 9, 30);
const supplements = [{ id: 3, name: "Magnesium", dose: "200 mg" }];

const kindsWith = (enabledModules: Parameters<typeof availableLogKinds>[0]["enabledModules"]) =>
  availableLogKinds<LogKind>(
    { enabledModules, preferences: { plain_water: true, private_body: true, pain: true } },
    [...LOG_KINDS, ...drinkLogKinds([{ key: "espresso", available: true }])],
  );

function typed(
  text: string,
  overrides: Partial<OneLinerContext> = {},
  i18n = englishI18n,
  locale = "en",
) {
  const oneLiner = parseOneLiner(text, {
    kinds: kindsWith(null),
    trackers: [],
    supplements,
    locale,
    now,
    foodDrafts: false,
    ...overrides,
  });
  const section = buildTypedSection(oneLiner, i18n, {
    timeZone: "Europe/Lisbon",
    newId: () => "m-1",
    locale,
    now,
    weightUnit: overrides.weightUnit,
    supplements,
  });
  return { oneLiner, section, submit: typedSubmitItem(oneLiner, section) };
}

const rows = (section: { items: PickerItem[] } | null) =>
  section?.items.map((item) => [item.label, item.detail, item.hint]) ?? [];

function fakeApi() {
  return {
    healthRecord: { ingestMetricSample: mock(async () => ({})) },
    sleep: {
      logManualSession: mock(async () => ({ id: 4, created: true, possibleDuplicate: false })),
      deleteManualSession: mock(async () => ({ deleted: true })),
    },
    plainWater: {
      add: mock(async () => ({ outcome: "applied", entry: { id: 8, revision: 1 } })),
      delete: mock(async () => ({})),
    },
    supplementIntake: {
      create: mock(async () => ({ id: 2, version: 1, created: true })),
      delete: mock(async () => ({})),
    },
    trackers: { log: mock(async () => ({ id: "e-1" })), deleteEntry: mock(async () => ({})) },
    nutritionDiary: {
      logEntry: mock(async () => ({ created: true, entry: { id: 11, revision: 1 } })),
      deleteEntry: mock(async () => ({})),
    },
    pain: { log: mock(async () => [{ id: "p-1" }]), delete: mock(async () => ({})) },
  } as unknown as PickerApi & {
    plainWater: { add: ReturnType<typeof mock>; delete: ReturnType<typeof mock> };
    healthRecord: { ingestMetricSample: ReturnType<typeof mock> };
  };
}

const offline = (): PickerOffline => ({
  enqueueMetric: mock(() => {}),
  enqueueWater: mock(() => "queue-1"),
  discardWater: mock(() => true),
  enqueueSupplement: mock(() => "queue-2"),
  discardSupplement: mock(() => true),
});

describe("typed one-liners in the mobile picker", () => {
  test("“500 ml” previews as one entry; the return key saves it", () => {
    const { section, submit } = typed("500 ml");
    expect(section?.heading).toBe("From what you typed");
    expect(rows(section)).toEqual([["Water", "500 ml · now", "Save"]]);
    expect(submit?.action).toMatchObject({ type: "typed", preview: { write: { type: "water" } } });
  });

  test("“82” offers choices, and the return key saves nothing", () => {
    const { section, submit } = typed("82", { kindCounts: { weight: 3 } });
    expect(section?.heading).toBe("Log 82 as…");
    expect(section!.items.length).toBeGreaterThan(1);
    expect(section!.items[0]!.label).toBe("Weight");
    expect(submit).toBeNull();
  });

  test("a bare number with a single plausible kind still waits for a tap", () => {
    const { oneLiner, submit } = typed("82", { kinds: kindsWith(["body"]) });
    expect(oneLiner?.type).toBe("choices");
    expect(submit).toBeNull();
  });

  test("decimals in the member's locale: “peso 82,4” is 82.4 kg in pt-PT", async () => {
    const pt = createAppI18n("pt-PT");
    const { section, submit } = typed("peso 82,4", {}, pt, "pt-PT");
    expect(section!.items[0]!.label).toBe("Peso");
    expect(section!.items[0]!.detail).toContain("82,4 kg");
    expect(submit?.action.type).toBe("typed");
    const action = submit!.action as Extract<PickerItem["action"], { type: "typed" }>;
    const api = fakeApi();
    await performPickerWrite(action.preview.write!, api, offline());
    expect(api.healthRecord.ingestMetricSample).toHaveBeenCalledTimes(1);
    expect(api.healthRecord.ingestMetricSample.mock.calls[0]![0]).toMatchObject({
      metricCode: "weight",
      valueNumeric: 82.4,
    });
  });

  test("“182 lb” is converted and previews in kg", () => {
    const { section } = typed("182 lb", {}, createAppI18n("pt-PT"), "pt-PT");
    expect(section!.items[0]!.detail).toContain("82,6 kg");
  });

  test("a saved water entry can be undone through the picker's write path", async () => {
    const { submit } = typed("água 500 ml");
    const action = submit!.action as Extract<PickerItem["action"], { type: "typed" }>;
    const api = fakeApi();
    const result = await performPickerWrite(action.preview.write!, api, offline());
    expect(api.plainWater.add).toHaveBeenCalledTimes(1);
    expect(result.undo).toBeDefined();
    await result.undo!();
    expect(api.plainWater.delete).toHaveBeenCalledTimes(1);
  });

  test("offline, a typed water entry waits on the device and undo takes it off the queue", async () => {
    const { submit } = typed("500 ml");
    const action = submit!.action as Extract<PickerItem["action"], { type: "typed" }>;
    const api = fakeApi();
    api.plainWater.add.mockImplementation(async () => {
      throw Object.assign(new Error("Network request failed"), { name: "TypeError" });
    });
    const queue = offline();
    const result = await performPickerWrite(action.preview.write!, api, queue);
    expect(result.queued).toBe(true);
    await result.undo!();
    expect(queue.discardWater).toHaveBeenCalledWith("queue-1");
  });

  test("a value out of range has no write: the row opens the form instead", () => {
    const { section } = typed("weight 900 kg");
    expect(section!.items[0]!.hint).toBe("Open");
    expect(section!.items[0]!.action).toMatchObject({ type: "typed", preview: { write: null } });
  });

  test("workouts open the workout screen; other text opens the food search", () => {
    expect(typed("ran 5 km").section!.items[0]).toMatchObject({
      label: "Log a workout: “ran 5 km”",
      hint: "Open",
      action: { type: "typed_workout", text: "ran 5 km" },
    });
    const food = typed("banana").section!.items[0]!;
    expect(food).toMatchObject({
      label: "Search foods for “banana”",
      action: { type: "typed_food", text: "banana" },
    });
    expect(typed("banana").submit).toEqual(food);
  });

  test("turned-off features never appear: water with food off is not offered", () => {
    const { section } = typed("500 ml", { kinds: kindsWith(["body"]) });
    expect(rows(section).map(([label]) => label)).not.toContain("Water");
  });

  test("blank text shows nothing", () => {
    expect(typed("  ").section).toBeNull();
  });
});
