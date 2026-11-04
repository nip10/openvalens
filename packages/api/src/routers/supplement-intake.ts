import { writeAuditLog } from "@openvalens/audit-security";
import { AuthzHttpError, requirePermission } from "@openvalens/auth/authz/guard";
import {
  createSupplementIntakeRepository,
  SupplementIntakeConflictError,
  SupplementIntakeMutationConflictError,
  SupplementIntakeNotFoundError,
  SupplementIntakeValidationError,
} from "@openvalens/plans";
import { z } from "zod";

import type { Context } from "../context";
import { permissionedProcedure, protectedProcedure, raiseApiError, validateInput } from "../index";

const isoInstant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
    "Expected an ISO instant",
  );
const uuid = z.string().uuid();
const payload = {
  supplementId: z.number().int().positive(),
  occurredAt: isoInstant,
  timeZone: z.string().trim().min(1).max(100),
  dose: z.string().trim().min(1).max(120),
  note: z.string().max(2000).nullable().optional(),
};
const listInput = z
  .strictObject({ from: isoInstant.optional(), to: isoInstant.optional() })
  .optional();
const createInput = z.strictObject({ ...payload, clientMutationId: uuid });
const updateInput = z.strictObject({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  clientMutationId: uuid,
  supplementId: payload.supplementId.optional(),
  occurredAt: payload.occurredAt.optional(),
  timeZone: payload.timeZone.optional(),
  dose: payload.dose.optional(),
  note: payload.note,
});
const deleteInput = z.strictObject({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  clientMutationId: uuid,
});
const intakeShape = z.object({
  id: z.number(),
  supplementId: z.number(),
  occurredAt: z.string(),
  timeZone: z.string(),
  dose: z.string(),
  note: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const createOutput = intakeShape.extend({ created: z.boolean(), targetId: z.string() });
const updateOutput = intakeShape.extend({ targetId: z.string() });
const deleteOutput = z.object({
  id: z.number(),
  version: z.number(),
  deleted: z.literal(true),
  targetId: z.string(),
});

type RequestContext = Pick<Context, "honoContext" | "correlationId" | "db">;
type AuthContext = RequestContext & {
  authz: { activeOrganizationId: string; user: { id: string } };
};

async function authorize(context: RequestContext, action: "read" | "write") {
  try {
    return await requirePermission(context.honoContext as never, {
      resource: "supplements",
      action,
    });
  } catch (error) {
    if (error instanceof AuthzHttpError) throw raiseApiError(error.code, error.message);
    throw raiseApiError("INTERNAL", "Authorization failed.");
  }
}

function repository(context: RequestContext, owner: AuthContext["authz"]) {
  return createSupplementIntakeRepository(context.db, {
    organizationId: owner.activeOrganizationId,
    userId: owner.user.id,
  });
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SupplementIntakeNotFoundError)
      throw raiseApiError("NOT_FOUND", error.message);
    if (
      error instanceof SupplementIntakeConflictError ||
      error instanceof SupplementIntakeMutationConflictError
    )
      throw raiseApiError("CONFLICT", error.message);
    if (error instanceof SupplementIntakeValidationError)
      throw raiseApiError("INVALID_INPUT", error.message);
    throw error;
  }
}

async function audit(
  context: AuthContext,
  eventType: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED",
  id: number,
) {
  await writeAuditLog({
    db: context.db,
    organizationId: context.authz.activeOrganizationId,
    actorUserId: context.authz.user.id,
    eventType,
    targetType: "supplement_intake",
    targetId: String(id),
    correlationId: context.correlationId,
    metadata: { resource: "supplements", action: "write" },
  });
}

/** Actual intake records; supplement schedules are never treated as evidence. */
export const supplementIntakeRouter = {
  list: permissionedProcedure({ resource: "supplements", action: "read" })
    .use(validateInput(listInput))
    .input(listInput)
    .output(z.array(intakeShape))
    .handler(({ input, context }) =>
      run(() => repository(context, context.authz).list(input ?? {})),
    ),

  create: protectedProcedure
    .use(validateInput(createInput))
    .input(createInput)
    .output(createOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const authz = await authorize(context, "write");
        const result = await repository(context, authz).create(input);
        if (result.created) await audit({ ...context, authz }, "RECORD_CREATED", result.intake.id);
        return { ...result.intake, created: result.created, targetId: String(result.intake.id) };
      }),
    ),

  update: protectedProcedure
    .use(validateInput(updateInput))
    .input(updateInput)
    .output(updateOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const authz = await authorize(context, "write");
        const intake = await repository(context, authz).update(input);
        await audit({ ...context, authz }, "RECORD_UPDATED", intake.id);
        return { ...intake, targetId: String(intake.id) };
      }),
    ),

  delete: protectedProcedure
    .use(validateInput(deleteInput))
    .input(deleteInput)
    .output(deleteOutput)
    .handler(({ input, context }) =>
      run(async () => {
        const authz = await authorize(context, "write");
        const result = await repository(context, authz).delete(input);
        await audit({ ...context, authz }, "RECORD_DELETED", result.id);
        return { ...result, targetId: String(result.id) };
      }),
    ),
};
