import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import type { AiHealthToolContext } from "./access";
import { bodyCompOutput, createBodyCompTool, executeBodyComp } from "./body-comp";
import { createGoalsTool, executeGoals, goalsOutput } from "./goals";
import { createAiHealthTools } from "./index";
import { createLabsTool, executeLabs, labsOutput } from "./labs";
import { createOutOfRangeTool, executeOutOfRange, outOfRangeOutput } from "./out-of-range";
import { createPanelCompareTool, executePanelCompare, panelCompareOutput } from "./panel-compare";
import { createSupplementsTool, executeSupplements, supplementsOutput } from "./supplements";
import {
  createTimelineSummaryTool,
  executeTimelineSummary,
  timelineSummaryOutput,
} from "./timeline-summary";
import { createWeightTrendTool, executeWeightTrend, weightTrendOutput } from "./weight-trend";
import {
  FIXED_NOW,
  ORG_A,
  ORG_B,
  USER_A,
  bloodPanel,
  createCapturingLogger,
  createFakeSources,
  dexaScanRow,
  goalEntry,
  supplementEntry,
  timelineEntry,
  toolContext,
  type FakeOrgData,
} from "./test-fixtures";

/**
 * Shared guarantees for the eight tools added in Issue #130: every tool is
 * bound to the session org, re-checks permission and consent before any read,
 * redacts ids / notes / source names, returns honest empty results, validates
 * strict input and logs no values. Behaviour per tool lives in its own suite.
 */

/** Values only ORG_B has; none may appear in an ORG_A result. */
const ORG_B_SENTINEL = 987.65;

function orgAData(): Partial<FakeOrgData> {
  return {
    bloodPanels: [
      bloodPanel(11, "2026-01-05", [
        { testKey: "ferritin", testName: "Ferritin", value: 40, unit: "ng/mL" },
        { testKey: "glucose", testName: "Glucose", value: 101, flag: "HIGH" },
      ]),
      bloodPanel(12, "2026-03-01", [
        { testKey: "ferritin", testName: "Ferritin", value: 52.5, unit: "ng/mL" },
        { testKey: "glucose", testName: "Glucose", value: 92 },
        { testKey: "ldl", testName: "LDL", value: 141, outOfRangeFlag: "HIGH" },
      ]),
    ],
    dexaScans: [dexaScanRow(31, "2026-02-15"), dexaScanRow(30, "2025-08-15", { bodyFatPct: 22 })],
    bodyComp: {
      canonicalDailyPoints: [
        { date: "2026-03-09", weightKg: 72.4, source: "SYNTHETIC_WEIGHT_SOURCE", confidence: 1 },
        { date: "2026-02-20", weightKg: 73.9, source: "SYNTHETIC_WEIGHT_SOURCE", confidence: 1 },
      ],
      compositionMarkers: [
        {
          date: "2026-03-09",
          measuredAt: "2026-03-09T07:00:00.000Z",
          source: "SYNTHETIC_SCALE_NAME",
          confidence: 0.8,
          weightKg: 72.4,
          bodyFatPct: 19.5,
          fatMassKg: 14.1,
          leanMassKg: 55.2,
          boneMassKg: 3.1,
        },
      ],
    },
    supplements: [supplementEntry(41, "Vitamin D3", ["active"])],
    goals: [
      goalEntry(51, "Reach target weight", "in_progress", {
        current: "74 kg",
        target: "70 kg",
        checkins: ["74 kg"],
      }),
    ],
    timeline: [
      timelineEntry("health_event:61", "2026-03-08T22:00:00.000Z"),
      timelineEntry("metric_sample:62", "2026-03-09T08:00:00.000Z", {
        kind: "metric",
        domain: "body",
        canonical: { metricCode: "body_weight" },
      }),
    ],
  };
}

function orgBData(): Partial<FakeOrgData> {
  return {
    bloodPanels: [
      bloodPanel(91, "2026-03-02", [{ testKey: "ferritin", value: ORG_B_SENTINEL }], ORG_B),
      bloodPanel(
        92,
        "2026-03-03",
        [{ testKey: "ferritin", value: ORG_B_SENTINEL, flag: "HIGH" }],
        ORG_B,
      ),
    ],
    dexaScans: [dexaScanRow(99, "2026-03-03", { bodyFatPct: ORG_B_SENTINEL })],
    bodyComp: {
      canonicalDailyPoints: [
        { date: "2026-03-09", weightKg: ORG_B_SENTINEL, source: "x", confidence: 1 },
      ],
      compositionMarkers: [],
    },
    supplements: [supplementEntry(97, "ORG_B_SUPPLEMENT", ["active"])],
    goals: [goalEntry(98, "ORG_B_GOAL", "in_progress")],
    timeline: [timelineEntry("health_event:99", "2026-03-09T00:00:00.000Z", { domain: "imaging" })],
  };
}

type ToolCase = {
  name: string;
  run: (context: AiHealthToolContext) => Promise<unknown>;
  schema: z.ZodType;
  create: (context: AiHealthToolContext) => { inputSchema: unknown };
  validInput: Record<string, unknown>;
  emptyStatus: string;
};

const CASES: ToolCase[] = [
  {
    name: "labs",
    run: (context) => executeLabs(context, {}),
    schema: labsOutput,
    create: createLabsTool,
    validInput: {},
    emptyStatus: "no_data",
  },
  {
    name: "panelCompare",
    run: (context) => executePanelCompare(context, {}),
    schema: panelCompareOutput,
    create: createPanelCompareTool,
    validInput: {},
    emptyStatus: "insufficient_data",
  },
  {
    name: "outOfRange",
    run: (context) => executeOutOfRange(context, {}),
    schema: outOfRangeOutput,
    create: createOutOfRangeTool,
    validInput: {},
    emptyStatus: "no_data",
  },
  {
    name: "bodyComp",
    run: (context) => executeBodyComp(context),
    schema: bodyCompOutput,
    create: createBodyCompTool,
    validInput: {},
    emptyStatus: "no_data",
  },
  {
    name: "weightTrend",
    run: (context) => executeWeightTrend(context, { days: 90 }),
    schema: weightTrendOutput,
    create: createWeightTrendTool,
    validInput: { days: 30 },
    emptyStatus: "no_data",
  },
  {
    name: "supplements",
    run: (context) => executeSupplements(context, { includeInactive: true }),
    schema: supplementsOutput,
    create: createSupplementsTool,
    validInput: {},
    emptyStatus: "no_data",
  },
  {
    name: "goals",
    run: (context) => executeGoals(context, {}),
    schema: goalsOutput,
    create: createGoalsTool,
    validInput: {},
    emptyStatus: "no_data",
  },
  {
    name: "timelineSummary",
    run: (context) => executeTimelineSummary(context, { days: 30 }),
    schema: timelineSummaryOutput,
    create: createTimelineSummaryTool,
    validInput: { days: 7 },
    emptyStatus: "no_data",
  },
];

const FORBIDDEN_IN_OUTPUT = [
  ORG_A,
  ORG_B,
  USER_A,
  "organizationId",
  "userId",
  "SYNTHETIC_PANEL_CONTEXT",
  "SYNTHETIC_FACILITY",
  "SYNTHETIC_PHYSICIAN",
  "SYNTHETIC_SOURCE_FILE",
  "SYNTHETIC_PDF_PATH",
  "SYNTHETIC_PANEL_NOTE",
  "SYNTHETIC_DEXA_FILE",
  "SYNTHETIC_WEIGHT_SOURCE",
  "SYNTHETIC_SCALE_NAME",
  "SYNTHETIC_CHANGE_REASON",
  "SYNTHETIC_SCHEDULE_NOTE",
  "SYNTHETIC_GOAL_NOTE",
  "SYNTHETIC_CHECKIN_NOTE",
  "SYNTHETIC_EVENT_TITLE",
  "SYNTHETIC_EVENT_SUMMARY",
  "SYNTHETIC_DEVICE_NAME",
  "SYNTHETIC_DIAGNOSIS",
  "health_event:",
  "metric_sample:",
  String(ORG_B_SENTINEL),
  "ORG_B_SUPPLEMENT",
  "ORG_B_GOAL",
];

describe("Issue #130 tool set", () => {
  test("createAiHealthTools offers exactly the ten planned tools", () => {
    const tools = createAiHealthTools(toolContext());
    expect(Object.keys(tools).sort()).toEqual(
      [
        "bodyComp",
        "goals",
        "healthSnapshot",
        "labs",
        "markerTrend",
        "outOfRange",
        "panelCompare",
        "supplements",
        "timelineSummary",
        "weightTrend",
      ].sort(),
    );
  });
});

describe.each(CASES)("$name guarantees", (toolCase) => {
  test("reads fresh data for the bound organization only, with a valid shape", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData(), [ORG_B]: orgBData() });

    const result = await toolCase.run(toolContext({ sources }));

    expect(result).toMatchObject({ status: "ok" });
    expect(() => toolCase.schema.parse(result)).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.organizationId === ORG_A)).toBe(true);
  });

  test("redacts ids, notes, source names and other tenants' values", async () => {
    const { sources } = createFakeSources({ [ORG_A]: orgAData(), [ORG_B]: orgBData() });

    const serialized = JSON.stringify(await toolCase.run(toolContext({ sources })));

    for (const forbidden of FORBIDDEN_IN_OUTPUT) expect(serialized).not.toContain(forbidden);
  });

  test("returns an honest empty result when nothing is recorded", async () => {
    const { sources } = createFakeSources({ [ORG_B]: orgBData() });

    const result = await toolCase.run(toolContext({ sources }));

    expect(result).toMatchObject({ status: toolCase.emptyStatus });
    expect(() => toolCase.schema.parse(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain(String(ORG_B_SENTINEL));
  });

  test("returns unavailable without reading data when records:read is denied", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await toolCase.run(toolContext({ sources, canReadRecords: async () => false }));

    expect(result).toEqual({
      status: "unavailable",
      reason: "permission_denied",
      generatedAt: FIXED_NOW.toISOString(),
    });
    expect(calls).toHaveLength(0);
  });

  test("fails closed when the permission check throws", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await toolCase.run(
      toolContext({
        sources,
        canReadRecords: async () => {
          throw new Error("authz backend down");
        },
      }),
    );

    expect(result).toMatchObject({ status: "unavailable", reason: "permission_denied" });
    expect(calls).toHaveLength(0);
  });

  test.each([
    ["user has no consent row", { orgMetadata: { aiConsent: true }, userGranted: null }],
    ["user revoked consent", { orgMetadata: { aiConsent: true }, userGranted: false }],
    ["org consent disabled", { orgMetadata: { aiConsent: false }, userGranted: true }],
    ["org consent is chat-only", { orgMetadata: { aiConsent: "chat" }, userGranted: true }],
  ])("returns unavailable without reading data when %s", async (_label, consent) => {
    const { sources, calls } = createFakeSources({ [ORG_A]: orgAData() });

    const result = await toolCase.run(toolContext({ sources, consent }));

    expect(result).toMatchObject({ status: "unavailable", reason: "consent_required" });
    expect(calls).toHaveLength(0);
  });

  test("logs status and counts only, never values, labels or dates", async () => {
    const { sources } = createFakeSources({ [ORG_A]: orgAData() });
    const { logger, records } = createCapturingLogger();

    await toolCase.run(toolContext({ sources, logger }));

    expect(records.map((record) => record.event)).toEqual(["ai.tool.executed"]);
    expect(records[0]?.metadata).toMatchObject({ tool: toolCase.name, organizationId: ORG_A });
    const serialized = JSON.stringify(records);
    for (const forbidden of [
      "52.5",
      "72.4",
      "Ferritin",
      "ferritin",
      "Vitamin D3",
      "Reach target weight",
      "2026-03-01",
      "2026-03-09",
      "body_weight",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("the AI SDK tool takes strict input and rejects tenant overrides", () => {
    const schema = toolCase.create(toolContext()).inputSchema as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(schema.safeParse(toolCase.validInput).success).toBe(true);
    expect(schema.safeParse({ ...toolCase.validInput, organizationId: ORG_B }).success).toBe(false);
    expect(schema.safeParse({ ...toolCase.validInput, userId: USER_A }).success).toBe(false);
  });
});
