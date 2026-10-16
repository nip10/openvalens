import { describe, expect, test } from "bun:test";

import {
  bandForGrade,
  preventivePackSchema,
  type PreventiveAuthority,
  type PreventiveRegion,
} from "./preventive-care-contract";
import { PREVENTIVE_CARE_PACK } from "./preventive-care-pack";

/**
 * Issue #97 — the build fails if any guideline item lacks its source, date,
 * grade, reviewer or expiry, or breaks the source-fidelity rules: one
 * authority per region, no invented intervals, no countdown on decision or
 * informational items, review windows within the pack's maximum.
 */

const DAY_MS = 86_400_000;
const REGION_AUTHORITY: Record<PreventiveRegion, PreventiveAuthority> = {
  us: "uspstf",
  uk: "nhs_england",
  pt: "dgs",
};
const SOURCE_HOSTS: Record<PreventiveAuthority, string> = {
  uspstf: "www.uspreventiveservicestaskforce.org",
  nhs_england: "www.nhs.uk",
  dgs: "www.dgs.pt",
};

describe("preventive-care rule pack", () => {
  const pack = PREVENTIVE_CARE_PACK;

  test("matches the schema (every item has source, dates, grade, reviewer and expiry)", () => {
    const parsed = preventivePackSchema.safeParse(pack);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    for (const item of pack.items) {
      expect(item.sourceUrl).toStartWith("https://");
      expect(item.statementDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.sourceVersion.length).toBeGreaterThan(3);
      expect(item.reviewer.trim().length).toBeGreaterThan(3);
      expect(item.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.grade).toBeDefined();
    }
  });

  test("item ids are unique and prefixed with their region", () => {
    const ids = pack.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of pack.items) expect(item.id.startsWith(`${item.region}.`)).toBe(true);
  });

  test("each region cites only its own authority, on that authority's site", () => {
    for (const item of pack.items) {
      expect(item.authority).toBe(REGION_AUTHORITY[item.region]);
      expect(new URL(item.sourceUrl).hostname).toBe(SOURCE_HOSTS[item.authority]);
    }
  });

  test("dates are ordered and the review window is within the pack maximum", () => {
    for (const item of pack.items) {
      expect(item.statementDate <= item.retrievedOn).toBe(true);
      expect(item.reviewedOn >= item.retrievedOn).toBe(true);
      const days =
        (Date.parse(`${item.reviewBy}T00:00:00Z`) - Date.parse(`${item.reviewedOn}T00:00:00Z`)) /
        DAY_MS;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(pack.maxReviewDays);
    }
  });

  test("no invented intervals: a suggestion needs a published interval", () => {
    for (const item of pack.items)
      if (item.suggestMonths !== null) expect(item.intervalText).not.toBeNull();
  });

  test("decision and informational items never count down; programmes expect an invitation", () => {
    for (const item of pack.items) {
      const band = bandForGrade(item.grade);
      if (
        band === "individual_decision" ||
        band === "evidence_uncertain" ||
        band === "not_recommended"
      ) {
        expect(item.reminderMode).toBe("none");
        expect(item.suggestMonths).toBeNull();
      }
      if (band === "individual_decision") expect(item.decisionAidUrl).not.toBeNull();
      if (band === "programme") expect(item.reminderMode).toBe("expect_invitation");
      if (band === "recommended") expect(item.reminderMode).toBe("user_date");
    }
  });

  test("criteria named by items are defined, and every defined criterion is used", () => {
    const defined = new Set(pack.criteria.map((criterion) => criterion.id));
    const used = new Set(
      pack.items.flatMap((item) => item.population.criteria.map((entry) => entry.criterion)),
    );
    for (const criterion of used) expect(defined.has(criterion)).toBe(true);
    for (const criterion of defined) expect(used.has(criterion)).toBe(true);
  });

  test("adults only: no item starts below 18", () => {
    for (const item of pack.items) expect(item.population.minAge).toBeGreaterThanOrEqual(18);
  });
});
