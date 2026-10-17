import {
  addMonths,
  bandForGrade,
  DECISION_BANDS,
  EMPTY_ITEM_STATE,
  HIDDEN_APPLICABILITY,
  isValidIsoDate,
  REMINDER_BANDS,
  type Applicability,
  type DeclarationAnswer,
  type ItemState,
  type PreventiveCareResult,
  type PreventiveCriterion,
  type PreventiveItem,
  type PreventiveItemView,
  type PreventivePack,
  type PreventiveRegion,
} from "./preventive-care-contract";
import type { WellnessAvailability, WellnessSex } from "./wellness-profile-contract";

/**
 * Issue #97 — the deterministic preventive-care engine. Pure: no DB, no clock
 * of its own.
 *
 * Its only inputs about the person are the four below. It never reads a lab
 * value, a measurement, a score or a risk estimate (a test asserts that no
 * other input is read), and it never fills a gap: a missing age or sex makes
 * the item say what is missing instead of guessing.
 */
export type PreventiveEngineInput = {
  region: PreventiveRegion;
  /** #98 age range from birth year (with consent); unavailable → reason. */
  ageRange: WellnessAvailability<{ minAge: number; maxAge: number }>;
  /** #98 sex for reference tables (with consent); unavailable → reason. */
  sex: WellnessAvailability<WellnessSex>;
  /** The person's own answers; a missing key means "not answered". */
  declarations: Partial<Record<PreventiveCriterion, DeclarationAnswer>>;
};

export const PREVENTIVE_ENGINE_INPUT_KEYS = ["region", "ageRange", "sex", "declarations"] as const;

function ageApplicability(
  item: PreventiveItem,
  ageRange: PreventiveEngineInput["ageRange"],
): Applicability | null {
  if (!ageRange.available) return "needs_age";
  const { minAge, maxAge } = ageRange.value;
  const ruleMax = item.population.maxAge ?? Number.POSITIVE_INFINITY;
  const ruleMin = item.population.minAge;
  if (minAge >= ruleMin && maxAge <= ruleMax) return null;
  if (maxAge < ruleMin || minAge > ruleMax) return "outside_age_or_sex";
  return "age_edge";
}

/** Matches one item against the person's inputs (see `Applicability`). */
export function applicabilityFor(
  item: PreventiveItem,
  input: PreventiveEngineInput,
): Applicability {
  // Sex first: a sex-specific item that cannot match is hidden whatever the age.
  if (item.population.sex !== "any") {
    if (!input.sex.available) {
      const age = ageApplicability(item, input.ageRange);
      return age === "outside_age_or_sex" ? age : "needs_sex";
    }
    if (input.sex.value !== item.population.sex) return "outside_age_or_sex";
  }
  const age = ageApplicability(item, input.ageRange);
  if (age !== null) return age;
  let pending = false;
  for (const { criterion, meetsWhen } of item.population.criteria) {
    const answer = input.declarations[criterion];
    if (answer === undefined || answer === "prefer_not_to_say") pending = true;
    else if (answer !== meetsWhen) return "declared_not_met";
  }
  return pending ? "may_apply" : "applies";
}

export function isBeingReviewed(item: PreventiveItem, asOf: string): boolean {
  return asOf > item.reviewBy;
}

function itemView(
  item: PreventiveItem,
  input: PreventiveEngineInput,
  state: ItemState,
  asOf: string,
  showDateReached: boolean,
): PreventiveItemView {
  const band = bandForGrade(item.grade);
  const beingReviewed = isBeingReviewed(item, asOf);
  const canRemind = !beingReviewed && REMINDER_BANDS.includes(band);
  const canDecide = !beingReviewed && DECISION_BANDS.includes(band);
  return {
    id: item.id,
    version: item.version,
    title: item.title,
    statementTitle: item.statementTitle,
    authority: item.authority,
    band,
    grade: item.grade,
    statementDate: item.statementDate,
    sourceUrl: item.sourceUrl,
    sourceVersion: item.sourceVersion,
    retrievedOn: item.retrievedOn,
    reviewedOn: item.reviewedOn,
    reviewBy: item.reviewBy,
    beingReviewed,
    applicability: applicabilityFor(item, input),
    population: item.population,
    intervalText: item.intervalText,
    reminderMode: item.reminderMode,
    decisionAidUrl: item.decisionAidUrl,
    note: item.note,
    state,
    suggestedNextOn:
      canRemind && state.lastDoneOn && item.suggestMonths
        ? addMonths(state.lastDoneOn, item.suggestMonths)
        : null,
    // Only the person's own date, only for items that can carry one; decision
    // and informational items never count down.
    dateReached:
      showDateReached &&
      canRemind &&
      state.plan !== "decided_no" &&
      state.nextOn !== null &&
      state.nextOn <= asOf,
    canRemind,
    canDecide,
  };
}

export type PreventiveEngineOutput = Pick<PreventiveCareResult, "items" | "notShown" | "criteria">;

/**
 * Evaluates the region's items. Items that do not match are listed in
 * `notShown` (title and reason) rather than silently dropped. Criteria are
 * asked only when an item in the region names them.
 */
export function evaluatePreventiveCare(
  pack: PreventivePack,
  input: PreventiveEngineInput,
  states: ReadonlyMap<string, ItemState>,
  options: { asOf: string; showDateReached: boolean },
): PreventiveEngineOutput {
  const regionItems = pack.items.filter((item) => item.region === input.region);
  const items: PreventiveItemView[] = [];
  const notShown: PreventiveEngineOutput["notShown"] = [];
  for (const item of regionItems) {
    const view = itemView(
      item,
      input,
      states.get(item.id) ?? EMPTY_ITEM_STATE,
      options.asOf,
      options.showDateReached,
    );
    if (HIDDEN_APPLICABILITY.includes(view.applicability))
      notShown.push({ id: item.id, title: item.title, applicability: view.applicability });
    else items.push(view);
  }
  const asked = new Set(
    regionItems.flatMap((item) => item.population.criteria.map((entry) => entry.criterion)),
  );
  const criteria = pack.criteria
    .filter((criterion) => asked.has(criterion.id))
    .map((criterion) => ({
      id: criterion.id,
      question: criterion.question,
      purpose: criterion.purpose,
      answer: input.declarations[criterion.id] ?? null,
    }));
  return { items, notShown, criteria };
}

/** Value-free reason an update to an item is refused. */
export type ItemUpdateRejection =
  | "unknown_item"
  | "being_reviewed"
  | "plan_not_allowed"
  | "dates_not_allowed"
  | "remind_needs_date"
  | "remind_not_allowed"
  | "invalid_date";

/**
 * Applies a partial item update with the band rules: only date-carrying items
 * take dates and reminders, only individual-decision items take "decided: …",
 * only invitation-based items take "expect invitation". "Decided: no" turns a
 * reminder off.
 */
export function applyItemUpdate(
  item: PreventiveItem,
  current: ItemState,
  patch: {
    plan?: ItemState["plan"];
    lastDoneOn?: string | null;
    nextOn?: string | null;
    remind?: boolean;
  },
  asOf: string,
): { ok: true; next: ItemState; changed: string[] } | { ok: false; reason: ItemUpdateRejection } {
  if (isBeingReviewed(item, asOf)) return { ok: false, reason: "being_reviewed" };
  const band = bandForGrade(item.grade);
  const next: ItemState = { ...current };
  const changed: string[] = [];

  if (patch.plan !== undefined) {
    const allowed =
      patch.plan === "none" ||
      (patch.plan === "expect_invitation" && item.reminderMode === "expect_invitation") ||
      (patch.plan.startsWith("decided_") && DECISION_BANDS.includes(band));
    if (!allowed) return { ok: false, reason: "plan_not_allowed" };
    next.plan = patch.plan;
    changed.push("plan");
  }
  for (const key of ["lastDoneOn", "nextOn"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!REMINDER_BANDS.includes(band) && key === "nextOn" && value !== null)
      return { ok: false, reason: "dates_not_allowed" };
    if (value !== null && !isValidIsoDate(value)) return { ok: false, reason: "invalid_date" };
    next[key] = value;
    changed.push(key);
  }
  if (patch.remind !== undefined) {
    if (patch.remind && !REMINDER_BANDS.includes(band))
      return { ok: false, reason: "remind_not_allowed" };
    next.remind = patch.remind;
    changed.push("remind");
  }
  if (next.plan === "decided_no" && next.remind) {
    next.remind = false;
    if (!changed.includes("remind")) changed.push("remind");
  }
  if (next.remind && next.nextOn === null) return { ok: false, reason: "remind_needs_date" };
  return { ok: true, next, changed };
}
