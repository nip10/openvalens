export type NutritionErrorCode =
  /** The row does not exist inside the caller's organization/user scope. */
  | "NOT_FOUND"
  /** The input breaks a domain rule (empty name, negative nutrient, bad date…). */
  | "INVALID_INPUT"
  /** The amount's unit cannot be converted to the food's nutrient basis. */
  | "UNIT_INCOMPATIBLE";

/**
 * Typed nutrition failure. Messages name the rule that failed, never the
 * submitted values, so they are safe to log.
 */
export class NutritionError extends Error {
  readonly code: NutritionErrorCode;

  constructor(code: NutritionErrorCode, message: string) {
    super(message);
    this.name = "NutritionError";
    this.code = code;
  }
}
