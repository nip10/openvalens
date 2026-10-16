import { describe, expect, test } from "bun:test";

import { EMPTY_ITEM_STATE, type ItemState, type PreventivePack } from "./preventive-care-contract";
import {
  applicabilityFor,
  applyItemUpdate,
  evaluatePreventiveCare,
  PREVENTIVE_ENGINE_INPUT_KEYS,
  type PreventiveEngineInput,
} from "./preventive-care-engine";
import { findPreventiveItem, PREVENTIVE_CARE_PACK } from "./preventive-care-pack";

const AS_OF = "2026-10-16";
const age = (minAge: number, maxAge: number) =>
  ({ available: true, value: { minAge, maxAge } }) as const;
const NO_AGE = { available: false, reason: "not_provided" } as const;
const NO_SEX = { available: false, reason: "declined" } as const;

function input(overrides: Partial<PreventiveEngineInput> = {}): PreventiveEngineInput {
  return {
    region: "us",
    ageRange: age(52, 53),
    sex: { available: true, value: "female" },
    declarations: {},
    ...overrides,
  };
}

function item(id: string) {
  const found = findPreventiveItem(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function run(engineInput: PreventiveEngineInput, states = new Map<string, ItemState>()) {
  return evaluatePreventiveCare(PREVENTIVE_CARE_PACK, engineInput, states, {
    asOf: AS_OF,
    showDateReached: true,
  });
}

describe("preventive-care engine", () => {
  test("reads only region, age range, sex and self-declarations", () => {
    const read = new Set<string>();
    const guarded = new Proxy(input(), {
      get(target, key) {
        if (typeof key === "string") read.add(key);
        return target[key as keyof PreventiveEngineInput];
      },
    });
    run(guarded);
    for (const key of read)
      expect(PREVENTIVE_ENGINE_INPUT_KEYS as readonly string[]).toContain(key);
    expect([...PREVENTIVE_ENGINE_INPUT_KEYS].map(String).sort()).toEqual(
      ["ageRange", "declarations", "region", "sex"].sort(),
    );
  });

  test("filters by region only: a region swap changes the rule set", () => {
    const us = run(input({ region: "us" }));
    const uk = run(input({ region: "uk" }));
    expect(us.items.every((view) => view.id.startsWith("us."))).toBe(true);
    expect(uk.items.every((view) => view.id.startsWith("uk."))).toBe(true);
    expect(uk.items.map((view) => view.id)).toContain("uk.breast_screening");
  });

  test("age and sex from the profile select the matching items", () => {
    const output = run(input());
    const ids = output.items.map((view) => view.id);
    expect(ids).toContain("us.breast_screening");
    expect(ids).toContain("us.colorectal_screening_50_75");
    expect(ids).not.toContain("us.colorectal_screening_45_49");
    expect(output.notShown.map((entry) => entry.id)).toContain("us.prostate_psa_55_69");
  });

  test("missing age: nothing is inferred, items say what is missing", () => {
    const output = run(input({ ageRange: NO_AGE }));
    const breast = output.items.find((view) => view.id === "us.breast_screening");
    expect(breast?.applicability).toBe("needs_age");
    expect(output.notShown.every((entry) => entry.applicability === "outside_age_or_sex")).toBe(
      true,
    );
  });

  test("missing sex: sex-specific items ask for it instead of guessing", () => {
    expect(applicabilityFor(item("us.breast_screening"), input({ sex: NO_SEX }))).toBe("needs_sex");
    expect(applicabilityFor(item("us.hepatitis_c_screening"), input({ sex: NO_SEX }))).toBe(
      "applies",
    );
  });

  test("birth year on the edge of an age limit is reported, not resolved", () => {
    expect(applicabilityFor(item("us.breast_screening"), input({ ageRange: age(39, 40) }))).toBe(
      "age_edge",
    );
  });

  test("self-declared criteria: unanswered or prefer-not-to-say → may apply; never pre-selected", () => {
    const male = { available: true, value: "male" } as const;
    const aaa = item("us.aaa_screening");
    const base = input({ sex: male, ageRange: age(66, 67) });
    expect(applicabilityFor(aaa, base)).toBe("may_apply");
    expect(
      applicabilityFor(aaa, { ...base, declarations: { ever_smoked: "prefer_not_to_say" } }),
    ).toBe("may_apply");
    expect(applicabilityFor(aaa, { ...base, declarations: { ever_smoked: "yes" } })).toBe(
      "applies",
    );
    expect(applicabilityFor(aaa, { ...base, declarations: { ever_smoked: "no" } })).toBe(
      "declared_not_met",
    );
    const output = run(base);
    expect(output.criteria.map((criterion) => criterion.answer)).toEqual(
      output.criteria.map(() => null),
    );
  });

  test("a criterion met by 'no' (NHS Health Check)", () => {
    const check = item("uk.nhs_health_check");
    const base = input({ region: "uk", ageRange: age(45, 46) });
    expect(
      applicabilityFor(check, {
        ...base,
        declarations: { nhs_health_check_listed_condition: "no" },
      }),
    ).toBe("applies");
    expect(
      applicabilityFor(check, {
        ...base,
        declarations: { nhs_health_check_listed_condition: "yes" },
      }),
    ).toBe("declared_not_met");
  });

  test("dates reached only for date-carrying items; individual decisions never count down", () => {
    const male = { available: true, value: "male" } as const;
    const states = new Map<string, ItemState>([
      [
        "us.prostate_psa_55_69",
        { ...EMPTY_ITEM_STATE, plan: "decided_later", nextOn: "2026-01-01" },
      ],
      [
        "us.colorectal_screening_50_75",
        { ...EMPTY_ITEM_STATE, nextOn: "2026-10-01", remind: true },
      ],
    ]);
    const output = run(input({ sex: male, ageRange: age(56, 57) }), states);
    const psa = output.items.find((view) => view.id === "us.prostate_psa_55_69");
    const crc = output.items.find((view) => view.id === "us.colorectal_screening_50_75");
    expect(psa?.dateReached).toBe(false);
    expect(psa?.canRemind).toBe(false);
    expect(psa?.canDecide).toBe(true);
    expect(crc?.dateReached).toBe(true);
  });

  test("a suggested next date comes only from a single published interval", () => {
    const states = new Map<string, ItemState>([
      ["us.breast_screening", { ...EMPTY_ITEM_STATE, lastDoneOn: "2025-02-28" }],
      ["us.colorectal_screening_50_75", { ...EMPTY_ITEM_STATE, lastDoneOn: "2025-02-28" }],
    ]);
    const output = run(input(), states);
    expect(output.items.find((view) => view.id === "us.breast_screening")?.suggestedNextOn).toBe(
      "2027-02-28",
    );
    expect(
      output.items.find((view) => view.id === "us.colorectal_screening_50_75")?.suggestedNextOn,
    ).toBeNull();
  });

  test("expired items are suppressed with 'being reviewed' and take no updates", () => {
    const stale: PreventivePack = {
      ...PREVENTIVE_CARE_PACK,
      items: PREVENTIVE_CARE_PACK.items.map((entry) => ({ ...entry, reviewBy: "2026-01-01" })),
    };
    const output = evaluatePreventiveCare(stale, input(), new Map(), {
      asOf: AS_OF,
      showDateReached: true,
    });
    expect(output.items.every((view) => view.beingReviewed && !view.canRemind)).toBe(true);
    const result = applyItemUpdate(stale.items[0]!, EMPTY_ITEM_STATE, { plan: "none" }, AS_OF);
    expect(result).toEqual({ ok: false, reason: "being_reviewed" });
  });

  test("update rules by band", () => {
    const psa = item("us.prostate_psa_55_69");
    expect(
      applyItemUpdate(psa, EMPTY_ITEM_STATE, { remind: true, nextOn: "2027-01-01" }, AS_OF),
    ).toMatchObject({
      ok: false,
    });
    expect(applyItemUpdate(psa, EMPTY_ITEM_STATE, { plan: "decided_no" }, AS_OF)).toMatchObject({
      ok: true,
      next: { plan: "decided_no" },
    });
    const breast = item("us.breast_screening");
    expect(applyItemUpdate(breast, EMPTY_ITEM_STATE, { plan: "decided_no" }, AS_OF)).toEqual({
      ok: false,
      reason: "plan_not_allowed",
    });
    expect(applyItemUpdate(breast, EMPTY_ITEM_STATE, { remind: true }, AS_OF)).toEqual({
      ok: false,
      reason: "remind_needs_date",
    });
    expect(applyItemUpdate(breast, EMPTY_ITEM_STATE, { nextOn: "2027-02-30" }, AS_OF)).toEqual({
      ok: false,
      reason: "invalid_date",
    });
    const uk = item("uk.bowel_screening");
    expect(
      applyItemUpdate(uk, EMPTY_ITEM_STATE, { plan: "expect_invitation" }, AS_OF),
    ).toMatchObject({ ok: true });
    expect(applyItemUpdate(breast, EMPTY_ITEM_STATE, { plan: "expect_invitation" }, AS_OF)).toEqual(
      {
        ok: false,
        reason: "plan_not_allowed",
      },
    );
  });
});
