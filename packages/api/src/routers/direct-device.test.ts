import { expect, test } from "bun:test";

import { appRouter } from "./index";
import { directDeviceRouter } from "./direct-device";

test("direct-device procedures are mounted only at the root directDevice namespace", () => {
  expect(directDeviceRouter).toHaveProperty("registerDirectDevice");
  expect(directDeviceRouter).toHaveProperty("ingestDirectDeviceBatch");
  expect(directDeviceRouter).toHaveProperty("listDirectDevices");
  expect(appRouter.directDevice).toBe(directDeviceRouter);
  expect(appRouter.mobile).not.toHaveProperty("directDevice");
  expect(appRouter).not.toHaveProperty("ingestDirectDeviceBatch");
  expect(Object.keys(appRouter.directDevice).sort()).toEqual([
    "ingestDirectDeviceBatch",
    "listDirectDevices",
    "registerDirectDevice",
  ]);
});

test("direct-device wire procedures reject client provenance and tenant fields", async () => {
  const deviceId = "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11";
  const input = {
    expectedContext: { userId: "user", organizationId: "org" },
    batch: {
      schemaVersion: 1,
      deviceId,
      provider: "direct_device",
      recordType: "steps",
      mode: "backfill",
      upserts: [
        {
          type: "steps",
          externalRecordId: "x",
          sourceApp: null,
          startTime: "2026-10-01T07:00:00.000Z",
          endTime: "2026-10-01T08:00:00.000Z",
          count: 1,
        },
      ],
      deletions: [],
      clientTimezone: "UTC",
    },
  };
  const invoke = directDeviceRouter.ingestDirectDeviceBatch.callable({ context: {} as never });
  await expect(
    invoke({
      ...input,
      batch: {
        ...input.batch,
        upserts: [{ ...input.batch.upserts[0], sourceDevice: { model: "spoof" } }],
      },
    } as never),
  ).rejects.toBeDefined();
  await expect(invoke({ ...input, organizationId: "attacker-org" } as never)).rejects.toBeDefined();
});
