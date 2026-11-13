import { describe, expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { EMPTY_WELLNESS_PROFILE } from "../wellness-profile-contract";
import { logKindPermissionCheck } from "./log-kinds";
import {
  canRestoreSetupCard,
  FIRST_LOG_CARD_COPY,
  FIRST_LOG_KIND_IDS,
  FIRST_RUN_STEP_TITLES,
  FIRST_RUN_STEPS,
  firstLogKinds,
  firstRunPosition,
  firstRunResumeStep,
  isSetupItem,
  isSetupItemDone,
  isStartDone,
  needsFirstRun,
  nextFirstRunStep,
  phoneAppLink,
  previousFirstRunStep,
  SETUP_ITEM_COPY,
  SETUP_ITEMS,
  setupProgress,
  shouldShowSetupCard,
  turnsOnWater,
} from "./onboarding";

const empty = EMPTY_WELLNESS_PROFILE;
const adult = { state: "recorded", value: "adult" } as const;

describe("the first run", () => {
  test("three screens: age and consent, the first log, connect", () => {
    expect([...FIRST_RUN_STEPS]).toEqual(["start", "first_log", "connect"]);
    expect(firstRunPosition("start")).toEqual({ index: 1, total: 3 });
    expect(firstRunPosition("connect")).toEqual({ index: 3, total: 3 });
    expect(nextFirstRunStep("start")).toBe("first_log");
    expect(nextFirstRunStep("connect")).toBeNull();
    expect(previousFirstRunStep("start")).toBeNull();
    expect(previousFirstRunStep("connect")).toBe("first_log");
    for (const step of FIRST_RUN_STEPS) {
      expect(englishI18n._(FIRST_RUN_STEP_TITLES[step]).length).toBeGreaterThan(0);
    }
  });

  test("screen 1 needs an age answer and no waiting consent", () => {
    expect(isStartDone(empty)).toBe(false);
    expect(isStartDone({ eligibility: adult })).toBe(true);
    expect(isStartDone({ eligibility: { state: "declined" } })).toBe(true);
    expect(isStartDone({ eligibility: adult }, { consentNeeded: true })).toBe(false);
    // Unknown consent (still loading) does not hold anyone back.
    expect(isStartDone({ eligibility: adult }, { consentNeeded: null })).toBe(true);
  });

  test("resumes at screen 1 until it is answered, then at the first log", () => {
    expect(firstRunResumeStep(empty)).toBe("start");
    expect(firstRunResumeStep({ eligibility: adult }, { consentNeeded: true })).toBe("start");
    expect(firstRunResumeStep({ eligibility: adult })).toBe("first_log");
  });
});

describe("who is sent to the first run", () => {
  test("a new account, once", () => {
    expect(needsFirstRun(empty)).toBe(true);
    expect(needsFirstRun(null)).toBe(false);
  });

  test("an account that chose modules without opening setup is not", () => {
    expect(needsFirstRun({ ...empty, enabledModules: ["sleep"] })).toBe(false);
  });

  test("someone part-way is sent back only while age or consent is open", () => {
    const partWay = { ...empty, setupStatus: "in_progress" as const };
    expect(needsFirstRun(partWay)).toBe(true);
    expect(needsFirstRun({ ...partWay, eligibility: adult })).toBe(false);
    expect(needsFirstRun({ ...partWay, eligibility: adult }, { consentNeeded: true })).toBe(true);
  });

  test("anyone who finished or dismissed the earlier flow is never sent again", () => {
    for (const setupStatus of ["completed", "skipped"] as const) {
      expect(needsFirstRun({ ...empty, setupStatus })).toBe(false);
      expect(needsFirstRun({ ...empty, setupStatus }, { consentNeeded: true })).toBe(false);
    }
  });
});

describe("the first log", () => {
  test("Weight, Water and Last night's sleep, all on by default", () => {
    expect([...FIRST_LOG_KIND_IDS]).toEqual(["weight", "water", "sleep"]);
    expect(firstLogKinds({ enabledModules: null }).map((kind) => kind.id)).toEqual([
      "weight",
      "water",
      "sleep",
    ]);
    expect(englishI18n._(FIRST_LOG_CARD_COPY.sleep)).toBe("Last night's sleep");
  });

  test("Water shows while plain water is still off, because tapping it turns it on", () => {
    expect(firstLogKinds({ enabledModules: ["food", "sleep"] }).map((kind) => kind.id)).toEqual([
      "water",
      "sleep",
    ]);
    expect(turnsOnWater("water", false)).toBe(true);
    expect(turnsOnWater("water", null)).toBe(true);
    expect(turnsOnWater("water", true)).toBe(false);
    expect(turnsOnWater("weight", false)).toBe(false);
  });

  test("a role that cannot write records sees no cards", () => {
    expect(firstLogKinds({ enabledModules: null, can: logKindPermissionCheck("viewer") })).toEqual(
      [],
    );
  });
});

describe("the phone app link", () => {
  test("carries the server address", () => {
    expect(phoneAppLink("https://health.example.org/")).toBe(
      "openvalens://server?url=https%3A%2F%2Fhealth.example.org",
    );
  });
});

describe("Finish setting up", () => {
  const started = { ...empty, setupStatus: "completed" as const, eligibility: adult };

  test("six items, each with copy", () => {
    expect([...SETUP_ITEMS]).toEqual([
      "first_log",
      "connect",
      "modules",
      "basics",
      "goal",
      "privacy",
    ]);
    for (const item of SETUP_ITEMS) {
      expect(englishI18n._(SETUP_ITEM_COPY[item].title).length).toBeGreaterThan(0);
      expect(englishI18n._(SETUP_ITEM_COPY[item].description).length).toBeGreaterThan(0);
    }
    expect(isSetupItem("goal")).toBe(true);
    expect(isSetupItem("age")).toBe(false);
  });

  test("an item is done once it has an answer", () => {
    expect(isSetupItemDone("first_log", started, { hasEntries: true })).toBe(true);
    expect(isSetupItemDone("connect", started, { connected: true })).toBe(true);
    expect(isSetupItemDone("modules", { ...started, enabledModules: [] })).toBe(true);
    expect(isSetupItemDone("basics", { ...started, region: { state: "declined" } })).toBe(true);
    expect(isSetupItemDone("goal", started, { goalCount: 1 })).toBe(true);
    expect(isSetupItemDone("privacy", started, { aiConsentAnswered: true })).toBe(true);
    expect(isSetupItemDone("privacy", started, { remindersOn: true })).toBe(true);
    // Unknown facts read as not done.
    for (const item of SETUP_ITEMS) expect(isSetupItemDone(item, started)).toBe(false);
  });

  test("counts and lists what is still open, in order", () => {
    expect(setupProgress(started, { goalCount: 2, connected: true })).toEqual({
      done: 2,
      total: 6,
      pending: ["first_log", "modules", "basics", "privacy"],
    });
  });

  test("shows until dismissed or everything is done", () => {
    const all = {
      hasEntries: true,
      connected: true,
      goalCount: 1,
      remindersOn: true,
    };
    const answered = { ...started, enabledModules: [], region: { state: "declined" as const } };
    expect(shouldShowSetupCard(started)).toBe(true);
    expect(shouldShowSetupCard({ ...started, setupStatus: "in_progress" })).toBe(true);
    expect(shouldShowSetupCard(answered, all)).toBe(false);
    expect(shouldShowSetupCard({ ...started, setupStatus: "skipped" })).toBe(false);
    expect(shouldShowSetupCard(null)).toBe(false);
  });

  test("Settings can bring back a dismissed card", () => {
    expect(canRestoreSetupCard({ setupStatus: "skipped" })).toBe(true);
    expect(canRestoreSetupCard({ setupStatus: "completed" })).toBe(false);
    expect(canRestoreSetupCard(null)).toBe(false);
  });
});
