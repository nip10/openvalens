import { expect, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";
import { latestPhoneSync, phoneSyncLine } from "./mobile-sync";

test("phone receipt summary picks the latest active device for each integration", () => {
  const old = {
    deviceId: "old",
    provider: "health_connect",
    status: "active",
    lastIngestAt: "2026-11-01T10:00:00Z",
  };
  const newest = { ...old, deviceId: "new", lastIngestAt: "2026-11-02T10:00:00Z" };
  const apple = { ...old, deviceId: "apple", provider: "apple_health", lastIngestAt: null };
  expect(
    latestPhoneSync([
      old,
      newest,
      apple,
      { ...newest, deviceId: "revoked", status: "revoked", lastIngestAt: "2026-11-03T10:00:00Z" },
    ]),
  ).toEqual([apple, newest]);
  expect(phoneSyncLine(apple, englishI18n)).toBe("Apple Health: no records received yet.");
  expect(phoneSyncLine(newest, englishI18n)).toMatch(/^Last received from Health Connect: /);
  expect(phoneSyncLine({ ...apple, lastIngestAt: "invalid" }, englishI18n)).not.toContain(
    "Invalid",
  );
});
