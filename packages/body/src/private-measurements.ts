import type { Database } from "@openvalens/db";
import {
  privateBodyMeasurement,
  privateBodyMeasurementPreference,
} from "@openvalens/db/schema/body";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

export const PRIVATE_BODY_MEASUREMENT_KINDS = [
  "weight",
  "waist",
  "hip",
  "neck",
  "chest",
  "upper_arm",
  "thigh",
] as const;
export type PrivateBodyMeasurementKind = (typeof PRIVATE_BODY_MEASUREMENT_KINDS)[number];

const measuredAt = z.string().datetime({ offset: true });
export const privateBodyMeasurementValueInput = z
  .strictObject({
    kind: z.enum(PRIVATE_BODY_MEASUREMENT_KINDS),
    value: z.number().finite().gt(0).max(1000),
    unit: z.enum(["kg", "lb", "cm", "in"]),
    measuredAt,
  })
  .refine(
    (value) =>
      value.kind === "weight"
        ? value.unit === "kg" || value.unit === "lb"
        : value.unit === "cm" || value.unit === "in",
    { message: "Unit does not match measurement kind.", path: ["unit"] },
  );
export const privateBodyMeasurementIdInput = z.strictObject({ id: z.uuid() });
export const privateBodyMeasurementPreferenceInput = z.strictObject({ enabled: z.boolean() });

export type PrivateBodyMeasurementValue = z.infer<typeof privateBodyMeasurementValueInput>;
export type PrivateBodyMeasurementRecord = {
  id: string;
  kind: PrivateBodyMeasurementKind;
  value: number;
  unit: string;
  measuredAt: string;
  source: "manual";
  createdAt: string;
  updatedAt: string;
};

function project(row: typeof privateBodyMeasurement.$inferSelect): PrivateBodyMeasurementRecord {
  return {
    id: row.id,
    kind: row.kind as PrivateBodyMeasurementKind,
    value: row.value,
    unit: row.unit,
    measuredAt: row.measuredAt.toISOString(),
    source: "manual",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPrivateBodyMeasurementService(input: { db: Database; now?: () => Date }) {
  const now = input.now ?? (() => new Date());
  const enabled = async (userId: string): Promise<boolean> => {
    const [row] = await input.db
      .select({ enabled: privateBodyMeasurementPreference.enabled })
      .from(privateBodyMeasurementPreference)
      .where(eq(privateBodyMeasurementPreference.userId, userId));
    return row?.enabled === true;
  };
  const setEnabled = async (userId: string, value: boolean) => {
    const [row] = await input.db
      .insert(privateBodyMeasurementPreference)
      .values({ userId, enabled: value, updatedAt: now() })
      .onConflictDoUpdate({
        target: privateBodyMeasurementPreference.userId,
        set: { enabled: value, updatedAt: now() },
      })
      .returning({ enabled: privateBodyMeasurementPreference.enabled });
    return row!.enabled;
  };
  const list = async (organizationId: string, userId: string, limit = 100) => {
    if (!(await enabled(userId))) return [];
    const rows = await input.db
      .select()
      .from(privateBodyMeasurement)
      .where(
        and(
          eq(privateBodyMeasurement.organizationId, organizationId),
          eq(privateBodyMeasurement.userId, userId),
        ),
      )
      .orderBy(desc(privateBodyMeasurement.measuredAt), desc(privateBodyMeasurement.id))
      .limit(Math.max(1, Math.min(500, limit)));
    return rows.map(project);
  };
  const create = async (
    organizationId: string,
    userId: string,
    value: PrivateBodyMeasurementValue,
  ) => {
    if (!(await enabled(userId))) return null;
    const parsed = privateBodyMeasurementValueInput.safeParse(value);
    if (!parsed.success) return null;
    const [row] = await input.db
      .insert(privateBodyMeasurement)
      .values({
        organizationId,
        userId,
        kind: parsed.data.kind,
        value: parsed.data.value,
        unit: parsed.data.unit,
        measuredAt: new Date(parsed.data.measuredAt),
        source: "manual",
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    return project(row!);
  };
  const update = async (
    organizationId: string,
    userId: string,
    id: string,
    value: PrivateBodyMeasurementValue,
  ) => {
    if (!(await enabled(userId))) return null;
    const parsed = privateBodyMeasurementValueInput.safeParse(value);
    if (!parsed.success) return null;
    const [row] = await input.db
      .update(privateBodyMeasurement)
      .set({
        kind: parsed.data.kind,
        value: parsed.data.value,
        unit: parsed.data.unit,
        measuredAt: new Date(parsed.data.measuredAt),
        updatedAt: now(),
      })
      .where(
        and(
          eq(privateBodyMeasurement.id, id),
          eq(privateBodyMeasurement.organizationId, organizationId),
          eq(privateBodyMeasurement.userId, userId),
        ),
      )
      .returning();
    return row ? project(row) : null;
  };
  const remove = async (organizationId: string, userId: string, id: string) => {
    if (!(await enabled(userId))) return false;
    const rows = await input.db
      .delete(privateBodyMeasurement)
      .where(
        and(
          eq(privateBodyMeasurement.id, id),
          eq(privateBodyMeasurement.organizationId, organizationId),
          eq(privateBodyMeasurement.userId, userId),
        ),
      )
      .returning({ id: privateBodyMeasurement.id });
    return rows.length === 1;
  };
  return Object.freeze({ enabled, setEnabled, list, create, update, remove });
}
