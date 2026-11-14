import { describe, expect, test } from "bun:test";
import { RESOURCES } from "@openvalens/auth/access/permissions";
import { englishI18n } from "@openvalens/i18n/testing";

import { PROCEDURE_ACCESS } from "../access-policy";
import { DRINK_PRESET_KEYS } from "../contracts/nutrition-drinks";
import { PERSON_MODULES } from "../wellness-profile-contract";
import {
  availableLogKinds,
  BUILT_IN_LOG_KIND_IDS,
  drinkLogKind,
  drinkLogKinds,
  drinkPresetKeyOfLogKind,
  findLogKind,
  isLogKindAvailable,
  LOG_KINDS,
  logKindPermissionCheck,
  type LogKind,
  type LogKindContext,
} from "./log-kinds";

const everything: LogKindContext = {
  enabledModules: null,
  preferences: { plain_water: true, private_body: true, pain: true },
};
const ids = (kinds: readonly LogKind[]) => kinds.map((kind) => kind.id);

describe("the log kind list", () => {
  test("has every built-in kind once, in the declared order", () => {
    expect(ids(LOG_KINDS)).toEqual([...BUILT_IN_LOG_KIND_IDS]);
  });

  test("every kind has a label, an icon, a save behaviour, a write permission and paths", () => {
    for (const kind of LOG_KINDS) {
      expect(englishI18n._(kind.label).length).toBeGreaterThan(0);
      expect(kind.icon).toBeTruthy();
      expect(["at_once", "draft"]).toContain(kind.save);
      expect(RESOURCES).toContain(kind.permission.resource);
      expect(kind.permission.action).toBe("write");
      if (kind.gate.module !== null) expect(PERSON_MODULES).toContain(kind.gate.module);
      expect(kind.paths.web.startsWith("/")).toBe(true);
      expect(kind.paths.native.startsWith("/")).toBe(true);
      for (const field of kind.fields) {
        expect(englishI18n._(field.label).length).toBeGreaterThan(0);
        if (field.min !== undefined && field.max !== undefined)
          expect(field.min).toBeLessThan(field.max);
        if (field.type === "choice") expect(field.choiceSource).toBeTruthy();
      }
    }
  });

  test("food, labs and workouts open drafts; simple values save at once", () => {
    const drafts = LOG_KINDS.filter((kind) => kind.save === "draft").map((kind) => kind.id);
    expect(drafts).toEqual(["lab_result", "food", "workout"]);
  });

  test("blood pressure writes the device metric codes, with an optional pulse", () => {
    const bp = findLogKind("blood_pressure");
    expect(bp?.fields.map((field) => [field.id, field.metricCode, field.unit?.code])).toEqual([
      ["systolic", "blood_pressure_systolic", "mmHg"],
      ["diastolic", "blood_pressure_diastolic", "mmHg"],
      ["pulse", "heart_rate", "bpm"],
      ["observedAt", undefined, undefined],
    ]);
    expect(bp?.fields.find((field) => field.id === "pulse")?.required).toBe(false);
  });

  test("sleep takes a bedtime, a wake time and an optional 1–5 quality", () => {
    const sleep = findLogKind("sleep");
    expect(sleep?.fields.map((field) => [field.id, field.type, field.required])).toEqual([
      ["bedtime", "datetime", true],
      ["wakeAt", "datetime", true],
      ["quality", "rating", false],
    ]);
    const quality = sleep?.fields.find((field) => field.id === "quality");
    expect([quality?.min, quality?.max]).toEqual([1, 5]);
  });

  test("every metric a kind writes goes through the manual metric write", () => {
    expect(PROCEDURE_ACCESS["healthRecord.ingestMetricSample"]).toBe("write");
    expect(PROCEDURE_ACCESS["sleep.logManualSession"]).toBe("write");
  });
});

describe("availableLogKinds", () => {
  test("with every feature on and no role check, every kind shows", () => {
    expect(ids(availableLogKinds(everything))).toEqual([...BUILT_IN_LOG_KIND_IDS]);
  });

  test("modules not chosen yet read as all on, like the rest of the app", () => {
    expect(availableLogKinds({ ...everything, enabledModules: undefined })).toHaveLength(
      LOG_KINDS.length,
    );
  });

  test("a turned-off module hides its kinds", () => {
    const kinds = ids(
      availableLogKinds({ ...everything, enabledModules: ["body", "food", "supplements"] }),
    );
    expect(kinds).toEqual([
      "weight",
      "private_measurement",
      "pain",
      "food",
      "water",
      "supplement_intake",
      "goal_checkin",
    ]);
  });

  test("no modules at all still leaves goal check-ins (goals are always on)", () => {
    expect(ids(availableLogKinds({ ...everything, enabledModules: [] }))).toEqual(["goal_checkin"]);
  });

  test("water needs plain water on; private measurements need the private body preference", () => {
    const off = ids(availableLogKinds({ enabledModules: null, preferences: {} }));
    expect(off).not.toContain("water");
    expect(off).not.toContain("private_measurement");
    expect(off).toContain("food");
    expect(off).toContain("weight");
  });

  test("a role without write on a resource hides the kinds that need it", () => {
    const viewer = availableLogKinds({ ...everything, can: () => false });
    expect(viewer).toEqual([]);
    const noSupplements = ids(
      availableLogKinds({
        ...everything,
        can: (permission) => permission.resource !== "supplements",
      }),
    );
    expect(noSupplements).not.toContain("supplement_intake");
    expect(noSupplements).toContain("weight");
  });

  test("filters extra kinds (custom trackers) with the same rule", () => {
    const tracker: LogKind<"tracker:mood"> = {
      id: "tracker:mood",
      label: LOG_KINDS[0]!.label,
      icon: "target",
      save: "at_once",
      permission: { resource: "records", action: "write" },
      gate: { module: "sleep" },
      fields: [],
      paths: { web: "/trackers", native: "/trackers" },
    };
    const kinds = [...LOG_KINDS, tracker];
    expect(ids(availableLogKinds(everything, kinds))).toContain("tracker:mood");
    expect(isLogKindAvailable(tracker, { ...everything, enabledModules: ["food"] })).toBe(false);
  });
});

describe("pain (#442)", () => {
  test("only for a member who turned the pain log on, with the body module", () => {
    expect(ids(availableLogKinds({ ...everything, preferences: {} }))).not.toContain("pain");
    expect(ids(availableLogKinds(everything))).toContain("pain");
    expect(ids(availableLogKinds({ ...everything, enabledModules: ["food"] }))).not.toContain(
      "pain",
    );
    const pain = findLogKind("pain")!;
    expect(pain.save).toBe("at_once");
    expect(pain.paths).toEqual({ web: "/body-map", native: "/body-map?layer=pain" });
    const rating = pain.fields.find((field) => field.id === "rating");
    expect([rating?.min, rating?.max, rating?.step]).toEqual([0, 10, 1]);
  });
});

describe("drink presets (#443)", () => {
  const presets = DRINK_PRESET_KEYS.map((key) => ({ key, available: key !== "spirits" }));

  test("only the presets the server can log, in preset order, as drink:<key> kinds", () => {
    const drinks = drinkLogKinds(presets);
    expect(ids(drinks)).toEqual(
      DRINK_PRESET_KEYS.filter((key) => key !== "spirits").map((key) => `drink:${key}`),
    );
    expect(drinkLogKinds(undefined)).toEqual([]);
    for (const drink of drinks) {
      expect(drink.save).toBe("at_once");
      expect(drink.gate).toEqual({ module: "food" });
      expect(drink.paths).toEqual({ web: "/nutrition", native: "/nutrition" });
      expect<string | null>(drinkPresetKeyOfLogKind(drink.id)).toBe(
        drink.id.slice("drink:".length),
      );
    }
    expect(englishI18n._(drinkLogKind("wine").label)).toBe("Glass of wine");
    expect(drinkPresetKeyOfLogKind("drink:milkshake")).toBeNull();
    expect(drinkPresetKeyOfLogKind("water")).toBeNull();
  });

  test("hidden with the food module off, like food", () => {
    const kinds = [...LOG_KINDS, ...drinkLogKinds(presets)];
    expect(
      ids(availableLogKinds({ ...everything, enabledModules: ["sleep"] }, kinds)).some((id) =>
        id.startsWith("drink:"),
      ),
    ).toBe(false);
  });
});

describe("logKindPermissionCheck", () => {
  test("a viewer can log nothing; a collaborator everything; an unknown role is not checked", () => {
    const context = { enabledModules: null, preferences: { plain_water: true } };
    expect(availableLogKinds({ ...context, can: logKindPermissionCheck("viewer") })).toEqual([]);
    expect(
      availableLogKinds({ ...context, can: logKindPermissionCheck("collaborator") }).length,
    ).toBe(availableLogKinds(context).length);
    expect(logKindPermissionCheck("someone")).toBeUndefined();
  });
});
