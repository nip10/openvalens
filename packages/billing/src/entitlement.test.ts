import { describe, expect, test } from "bun:test";

import {
  accessState,
  addMonths,
  DAY_MS,
  DEFAULT_PAST_DUE_GRACE_DAYS,
  parseGraceDays,
  parseRetentionConfig,
  subtractMonths,
  type AccessInput,
} from "./entitlement";

/** Issue #298 — the access each subscription state grants. */

const NOW = new Date("2026-11-10T12:00:00.000Z");
const GRACE = 7 * DAY_MS;

function row(overrides: Partial<AccessInput>): AccessInput {
  return {
    status: "active",
    trialEndsAt: new Date("2026-10-01T00:00:00.000Z"),
    stripeSubscriptionId: "sub_1",
    pastDueSince: null,
    ...overrides,
  };
}

describe("accessState", () => {
  test("trialing and active have full access", () => {
    expect(
      accessState(
        row({
          status: "trialing",
          stripeSubscriptionId: null,
          trialEndsAt: new Date("2026-11-20T00:00:00.000Z"),
        }),
        NOW,
        GRACE,
      ),
    ).toEqual({ status: "trialing", level: "full", graceEndsAt: null });
    expect(accessState(row({ status: "active" }), NOW, GRACE).level).toBe("full");
  });

  test("past_due keeps full access during the grace period, then read-only", () => {
    const since = new Date(NOW.getTime() - 6 * DAY_MS);
    expect(accessState(row({ status: "past_due", pastDueSince: since }), NOW, GRACE)).toEqual({
      status: "past_due",
      level: "full",
      graceEndsAt: new Date(since.getTime() + GRACE),
    });
    const late = new Date(NOW.getTime() - 7 * DAY_MS);
    expect(accessState(row({ status: "past_due", pastDueSince: late }), NOW, GRACE).level).toBe(
      "read_only",
    );
  });

  test("a past_due row without its start never cuts access short", () => {
    const state = accessState(row({ status: "past_due", pastDueSince: null }), NOW, GRACE);
    expect(state.level).toBe("full");
    expect(state.graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE));
  });

  test("a zero-day grace period ends access at once", () => {
    expect(accessState(row({ status: "past_due", pastDueSince: NOW }), NOW, 0).level).toBe(
      "read_only",
    );
  });

  test("canceled, ended and a lapsed local trial are read-only", () => {
    expect(accessState(row({ status: "canceled" }), NOW, GRACE).level).toBe("read_only");
    expect(accessState(row({ status: "ended" }), NOW, GRACE).level).toBe("read_only");
    expect(
      accessState(
        row({ status: "trialing", stripeSubscriptionId: null, trialEndsAt: NOW }),
        NOW,
        GRACE,
      ),
    ).toEqual({ status: "ended", level: "read_only", graceEndsAt: null });
  });

  test("no subscription row is read-only (`none`)", () => {
    expect(accessState(null, NOW, GRACE)).toEqual({
      status: "none",
      level: "read_only",
      graceEndsAt: null,
    });
  });
});

describe("configuration", () => {
  test("grace days default to 7 and accept 0–60", () => {
    expect(parseGraceDays(undefined)).toBe(DEFAULT_PAST_DUE_GRACE_DAYS);
    expect(parseGraceDays("")).toBe(7);
    expect(parseGraceDays(0)).toBe(0);
    expect(parseGraceDays("14")).toBe(14);
    expect(() => parseGraceDays(61)).toThrow("BILLING_PAST_DUE_GRACE_DAYS");
    expect(() => parseGraceDays("1.5")).toThrow("BILLING_PAST_DUE_GRACE_DAYS");
  });

  test("retention is off unless set, and dry run is opt-in", () => {
    expect(parseRetentionConfig({})).toEqual({ months: null, dryRun: false });
    expect(parseRetentionConfig({ CLOUD_ENDED_RETENTION_MONTHS: "" })).toEqual({
      months: null,
      dryRun: false,
    });
    expect(
      parseRetentionConfig({
        CLOUD_ENDED_RETENTION_MONTHS: 12,
        CLOUD_ENDED_RETENTION_DRY_RUN: true,
      }),
    ).toEqual({ months: 12, dryRun: true });
    expect(
      parseRetentionConfig({
        CLOUD_ENDED_RETENTION_MONTHS: "6",
        CLOUD_ENDED_RETENTION_DRY_RUN: "false",
      }),
    ).toEqual({ months: 6, dryRun: false });
    expect(() => parseRetentionConfig({ CLOUD_ENDED_RETENTION_MONTHS: "0" })).toThrow(
      "CLOUD_ENDED_RETENTION_MONTHS",
    );
  });

  test("calendar months clamp to the end of shorter months", () => {
    expect(subtractMonths(new Date("2026-03-31T10:00:00.000Z"), 1).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(subtractMonths(new Date("2026-11-10T00:00:00.000Z"), 12).toISOString()).toBe(
      "2025-11-10T00:00:00.000Z",
    );
  });
});
