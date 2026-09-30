import { expect, test } from "bun:test";
import { maxIsoDate, selectLatestBodyWeight } from "./body-source";

test("selectLatestBodyWeight prefers canonical when both exist", () => {
  const selected = selectLatestBodyWeight(
    { date: "2026-03-07", weightKg: 83.4 },
    { date: "2026-03-08", weightKg: 84.1, bodyFatPct: 24 },
  );

  expect(selected).toEqual({
    date: "2026-03-07",
    weightKg: 83.4,
    bodyFatPct: null,
  });
});

test("selectLatestBodyWeight falls back to legacy when canonical is missing", () => {
  const selected = selectLatestBodyWeight(undefined, {
    date: "2026-03-08",
    weightKg: 84.1,
    bodyFatPct: 24,
  });

  expect(selected).toEqual({
    date: "2026-03-08",
    weightKg: 84.1,
    bodyFatPct: 24,
  });
});

test("selectLatestBodyWeight returns null when both canonical and legacy are missing", () => {
  expect(selectLatestBodyWeight(undefined, undefined)).toBeNull();
});

test("maxIsoDate picks the later non-null date", () => {
  expect(maxIsoDate(null, "2026-03-02")).toBe("2026-03-02");
  expect(maxIsoDate("2026-03-02", null)).toBe("2026-03-02");
  expect(maxIsoDate(null, null)).toBeNull();
  expect(maxIsoDate("2026-03-02", "2026-03-03")).toBe("2026-03-03");
  expect(maxIsoDate("2026-03-05", "2026-03-03")).toBe("2026-03-05");
});
