import { expect, test } from "bun:test";
import { EXPORT_DOMAINS } from "./domains";
import { buildExportPayload, type ExportPayloadScope } from "./build-payload";

// A stub `db` is sufficient because every extractor in this test is overridden
// by the extractor map and never touches the database.
const db = {} as Parameters<typeof buildExportPayload>[0];

const scope: ExportPayloadScope = { organizationId: "org-123" };

function extractorMap(
  overrides: Partial<
    Record<string, (passedDb: unknown, passedScope: ExportPayloadScope) => Promise<unknown>>
  >,
): Parameters<typeof buildExportPayload>[3] {
  const base: Record<
    string,
    (passedDb: unknown, passedScope: ExportPayloadScope) => Promise<unknown>
  > = {};
  for (const domain of EXPORT_DOMAINS) {
    base[domain] = async () => {
      throw new Error(`Unexpected extractor call: ${domain}`);
    };
  }
  return { extractors: { ...base, ...overrides } } as Parameters<typeof buildExportPayload>[3];
}

test("includes only selected domains", async () => {
  const payload = await buildExportPayload(db, ["blood", "supplements"], scope, {
    now: () => new Date("2026-03-02T12:00:00.000Z"),
    extractors: {
      blood: async () => [
        {
          recordedAt: "2026-02-28",
          markerKey: "ast",
          markerName: "AST",
          value: 35,
          unit: "U/L",
          flag: null,
        },
      ],
      supplements: async () => [{ id: 1, name: "Omega-3" }],
    },
  });

  expect(payload.selectedDomains).toEqual(["blood", "supplements"]);
  expect(Object.keys(payload.data)).toEqual(["blood", "supplements"]);
  expect("workouts" in payload.data).toBe(false);
});

test("normalizes selected domains into deterministic canonical order", async () => {
  const payload = await buildExportPayload(
    db,
    ["workouts", "blood", "supplements", "blood", "workouts"],
    scope,
    extractorMap({
      ["blood"]: async () => [],
      ["supplements"]: async () => [],
      ["workouts"]: async () => [],
    }),
  );

  expect(payload.selectedDomains).toEqual(["blood", "supplements", "workouts"]);
});

test("invokes extractor with active organization id only", async () => {
  const calls: string[] = [];
  const payload = await buildExportPayload(db, ["supplements", "blood"], scope, {
    now: () => new Date("2026-03-02T12:00:00.000Z"),
    extractors: {
      blood: async (passedDb, passedScope) => {
        calls.push(`blood:${passedScope?.organizationId ?? "none"}`);
        void passedDb;
        return [];
      },
      supplements: async (passedDb, passedScope) => {
        calls.push(`supplements:${passedScope?.organizationId ?? "none"}`);
        void passedDb;
        return [{ id: "s-1" }];
      },
    },
  });

  expect(calls).toEqual(["blood:org-123", "supplements:org-123"]);
  expect(payload.data.blood).toEqual([]);
  expect(payload.data.supplements).toEqual([{ id: "s-1" }]);
  expect(payload.generatedAt).toBe("2026-03-02T12:00:00.000Z");
});
