import type { Database } from "@openvalens/db";
import { nutritionTargetSettings } from "@openvalens/db/schema/nutrition";
import { and, eq } from "drizzle-orm";

import { NutritionError } from "./errors";
import {
  ENERGY_DIRECTIONS,
  NUTRITION_DECLARATIONS,
  NUTRITION_SAFETY_POLICY,
  type EnergyDirection,
  type NutritionDeclaration,
} from "./nutrition-safety";
import type { NutritionScope } from "./repository";
import { lockNutritionSafetyScope } from "./repository";

/**
 * Per-member nutrition target settings (Issue #80): hide-numbers mode, the
 * direction energy suggestions may take, the active opt-in for the protein
 * reference, a self-declared height and the member's self-declared yes/no
 * declarations. Scoped to the session's organization AND member; a missing
 * row reads as the defaults. Nothing here logs a value or a declaration.
 */

export type NutritionTargetSettings = {
  revision: number;
  hideNumbers: boolean;
  energyDirection: EnergyDirection;
  activeProtein: boolean;
  heightCm: number | null;
  declarations: NutritionDeclaration[];
};

export const DEFAULT_TARGET_SETTINGS: Readonly<NutritionTargetSettings> = Object.freeze({
  revision: 0,
  hideNumbers: false,
  energyDirection: NUTRITION_SAFETY_POLICY.defaultDirection,
  activeProtein: false,
  heightCm: null,
  declarations: [],
});

export type TargetSettingsPatch = Partial<Omit<NutritionTargetSettings, "revision">>;

export type UpdateSettingsOutcome =
  | { outcome: "updated"; settings: NutritionTargetSettings; previous: NutritionTargetSettings }
  | { outcome: "conflict"; settings: NutritionTargetSettings };

export const HEIGHT_RANGE_CM = Object.freeze({ min: 100, max: 250 });

function scoped(scope: NutritionScope) {
  return and(
    eq(nutritionTargetSettings.organizationId, scope.organizationId),
    eq(nutritionTargetSettings.userId, scope.userId),
  );
}

function toSettings(row: typeof nutritionTargetSettings.$inferSelect): NutritionTargetSettings {
  return {
    revision: row.revision,
    hideNumbers: row.hideNumbers,
    energyDirection: row.energyDirection,
    activeProtein: row.activeProtein,
    heightCm: row.heightCm,
    // Display order, and nothing outside the known list.
    declarations: NUTRITION_DECLARATIONS.filter((key) => row.declarations.includes(key)),
  };
}

export async function readNutritionTargetSettings(
  executor: Pick<Database, "select">,
  scope: NutritionScope,
): Promise<NutritionTargetSettings> {
  const [row] = await executor.select().from(nutritionTargetSettings).where(scoped(scope));
  return row ? toSettings(row) : { ...DEFAULT_TARGET_SETTINGS, declarations: [] };
}

/** Validates a patch; throws `INVALID_INPUT`. */
function validate(patch: TargetSettingsPatch): void {
  if (patch.energyDirection !== undefined && !ENERGY_DIRECTIONS.includes(patch.energyDirection))
    throw new NutritionError("INVALID_INPUT", "Unknown direction");
  if (
    patch.heightCm !== undefined &&
    patch.heightCm !== null &&
    !(
      Number.isFinite(patch.heightCm) &&
      patch.heightCm >= HEIGHT_RANGE_CM.min &&
      patch.heightCm <= HEIGHT_RANGE_CM.max
    )
  )
    throw new NutritionError("INVALID_INPUT", "Height must be between 100 and 250 cm");
  if (
    patch.declarations !== undefined &&
    patch.declarations.some((key) => !NUTRITION_DECLARATIONS.includes(key))
  )
    throw new NutritionError("INVALID_INPUT", "Unknown declaration");
}

export function createNutritionTargetSettings(db: Database) {
  async function read(
    executor: Pick<Database, "select">,
    scope: NutritionScope,
  ): Promise<NutritionTargetSettings> {
    return readNutritionTargetSettings(executor, scope);
  }

  return {
    /** The member's settings, or the defaults when none were saved. */
    async get(scope: NutritionScope): Promise<NutritionTargetSettings> {
      return read(db, scope);
    },

    /**
     * Applies `patch` when `expectedRevision` matches the stored revision
     * (0 for a member with no row yet); otherwise returns the current
     * settings as a conflict and writes nothing.
     */
    async update(
      scope: NutritionScope,
      patch: TargetSettingsPatch,
      expectedRevision: number,
    ): Promise<UpdateSettingsOutcome> {
      validate(patch);
      return db.transaction(async (tx) => {
        await lockNutritionSafetyScope(tx, scope);
        const previous = await read(tx, scope);
        if (previous.revision !== expectedRevision)
          return { outcome: "conflict", settings: previous };
        const next: NutritionTargetSettings = {
          ...previous,
          ...patch,
          declarations: patch.declarations
            ? NUTRITION_DECLARATIONS.filter((key) => patch.declarations!.includes(key))
            : previous.declarations,
          revision: previous.revision + 1,
        };
        const now = new Date();
        const values = {
          revision: next.revision,
          hideNumbers: next.hideNumbers,
          energyDirection: next.energyDirection,
          activeProtein: next.activeProtein,
          heightCm: next.heightCm,
          declarations: next.declarations,
          updatedAt: now,
        };
        const [row] = await tx
          .insert(nutritionTargetSettings)
          .values({ ...scope, ...values, createdAt: now })
          .onConflictDoUpdate({
            target: [nutritionTargetSettings.organizationId, nutritionTargetSettings.userId],
            set: values,
          })
          .returning();
        if (!row) throw new Error("Settings upsert did not return a row");
        return { outcome: "updated", settings: toSettings(row), previous };
      });
    },
  };
}

export type NutritionTargetSettingsStore = ReturnType<typeof createNutritionTargetSettings>;
