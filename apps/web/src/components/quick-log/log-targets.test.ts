import { describe, expect, test } from "bun:test";
import { findLogKind } from "@openvalens/api/presenters/log-kinds";
import { hasQuickForm } from "@openvalens/api/presenters/quick-log";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  logTargetKey,
  logTargetLabel,
  paletteStart,
  resolveLogLaunch,
  ROUTE_LOG_TARGETS,
  routeLogTarget,
} from "./log-targets";

/** Every built-in kind is available, with its real quick form. */
const everything = {
  has: (id: string) => findLogKind(id) !== undefined,
  hasQuickForm: (id: string) => {
    const kind = findLogKind(id);
    return kind !== undefined && hasQuickForm(kind);
  },
};

describe("routeLogTarget (app-shell#0)", () => {
  test("each record screen preselects its subject", () => {
    expect(routeLogTarget("/body")).toEqual({ kind: "weight" });
    expect(routeLogTarget("/records/vitals")).toEqual({
      kind: "heart_rate",
      related: ["blood_pressure", "resting_heart_rate"],
    });
    expect(routeLogTarget("/records/activity")?.kind).toBe("steps");
    expect(routeLogTarget("/records/sleep")?.kind).toBe("sleep");
    expect(routeLogTarget("/records/labs")?.kind).toBe("lab_result");
    expect(routeLogTarget("/nutrition")?.kind).toBe("food");
    expect(routeLogTarget("/cycle")?.kind).toBe("period");
    expect(routeLogTarget("/workouts")?.kind).toBe("workout");
    expect(routeLogTarget("/supplements")?.kind).toBe("supplement_intake");
    expect(routeLogTarget("/private-measurements")?.kind).toBe("private_measurement");
    expect(routeLogTarget("/goals")?.kind).toBe("goal_checkin");
  });

  test("a path covers what is under it, not its look-alikes", () => {
    expect(routeLogTarget("/goals/12")?.kind).toBe("goal_checkin");
    expect(routeLogTarget("/body/")?.kind).toBe("weight");
    expect(routeLogTarget("/body-map")).toBeNull();
    expect(routeLogTarget("/nutrition-targets")).toBeNull();
  });

  test("elsewhere the palette opens unfiltered", () => {
    for (const path of ["/", "/dashboard", "/records/timeline", "/settings", "/coach"])
      expect(routeLogTarget(path)).toBeNull();
  });

  test("every palette kind in the map exists", () => {
    for (const { target } of ROUTE_LOG_TARGETS) {
      if (target.kind === "period") continue;
      expect(findLogKind(target.kind)).toBeDefined();
    }
  });
});

describe("logTargetLabel", () => {
  test("names the kind, the page-only ones too", () => {
    expect(englishI18n._(logTargetLabel({ kind: "weight" })!)).toBe("Weight");
    expect(englishI18n._(logTargetLabel({ kind: "period" })!)).toBe("Period");
    expect(logTargetLabel(null)).toBeNull();
  });
});

describe("logTargetKey", () => {
  test("equal targets share a key", () => {
    expect(logTargetKey({ kind: "food", date: "2026-11-16" })).toBe(
      logTargetKey({ kind: "food", date: "2026-11-16" }),
    );
    expect(logTargetKey({ kind: "food", date: "2026-11-16" })).not.toBe(
      logTargetKey({ kind: "food", date: "2026-11-15" }),
    );
    expect(logTargetKey(null)).toBe("");
  });
});

describe("resolveLogLaunch", () => {
  const none = () => false;

  test("the page's own dialog wins for its kind", () => {
    const target = { kind: "lab_result" } as const;
    expect(resolveLogLaunch(target, (kind) => kind === "lab_result")).toEqual({
      type: "dialog",
      target,
    });
    expect(resolveLogLaunch({ kind: "weight" }, (kind) => kind === "lab_result")).toEqual({
      type: "palette",
      target: { kind: "weight" },
    });
  });

  test("a page-only kind without its dialog opens the full palette", () => {
    expect(resolveLogLaunch({ kind: "period" }, none)).toEqual({ type: "palette", target: null });
  });

  test("no target: the full palette", () => {
    expect(resolveLogLaunch(null, none)).toEqual({ type: "palette", target: null });
  });
});

describe("paletteStart", () => {
  test("a quick-form kind opens its form with the related kinds one tap away", () => {
    expect(paletteStart(routeLogTarget("/records/vitals"), everything)).toEqual({
      type: "form",
      kindId: "heart_rate",
      values: undefined,
      related: ["blood_pressure", "resting_heart_rate"],
    });
    expect(
      paletteStart({ kind: "supplement_intake", values: { supplement: "3" } }, everything),
    ).toEqual({
      type: "form",
      kindId: "supplement_intake",
      values: { supplement: "3" },
      related: [],
    });
  });

  test("related kinds the member cannot log stay out", () => {
    const noBloodPressure = { ...everything, has: (id: string) => id !== "blood_pressure" };
    expect(paletteStart(routeLogTarget("/records/vitals"), noBloodPressure)).toMatchObject({
      related: ["resting_heart_rate"],
    });
  });

  test("food opens the food list for the meal and day", () => {
    expect(paletteStart({ kind: "food", meal: "lunch", date: "2026-11-14" }, everything)).toEqual({
      type: "food",
      meal: "lunch",
      date: "2026-11-14",
    });
  });

  test("a kind without a quick form, or one the member cannot log, opens the list", () => {
    expect(paletteStart({ kind: "lab_result" }, everything)).toEqual({ type: "list" });
    expect(paletteStart({ kind: "period" }, everything)).toEqual({ type: "list" });
    expect(paletteStart({ kind: "weight" }, { ...everything, has: () => false })).toEqual({
      type: "list",
    });
    expect(paletteStart(null, everything)).toEqual({ type: "list" });
  });
});
