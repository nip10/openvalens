import { writeAuditLog } from "@openvalens/audit-security";
import {
  createPainService,
  PAIN_TYPES,
  PainError,
  painEntryIdInput,
  painHistoryInput,
  painLogInput,
  painMapInput,
  painPreferenceInput,
} from "@openvalens/pain";
import { z } from "zod";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #442 — pain log, mounted as `appRouter.pain`.
 *
 * Reads need `records:read` and writes `records:write`, and every call needs
 * the member's own, non-impersonated session: workspace owners, other members
 * and impersonating admins never see a member's pain log. The member and
 * workspace come from the session, never the input. While the opt-in is off,
 * reads return nothing and logging is refused (`CONFLICT`). Audit rows carry
 * ids only: no region, rating or note.
 */

const preference = z.object({ enabled: z.boolean(), aiVisible: z.boolean() });
const entry = z.object({
  id: z.string(),
  region: z.string(),
  rating: z.number(),
  type: z.enum(PAIN_TYPES).nullable(),
  loggedAt: z.string(),
  localDate: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const workoutFact = z.object({
  id: z.number(),
  type: z.string(),
  date: z.string(),
  durationMinutes: z.number().nullable(),
  daysBefore: z.number(),
});
const map = z.object({
  enabled: z.boolean(),
  from: z.string(),
  to: z.string(),
  regions: z.array(
    z.object({
      region: z.string(),
      highest: z.number(),
      entryCount: z.number(),
      lastLoggedAt: z.string(),
    }),
  ),
});
const history = z.object({
  enabled: z.boolean(),
  region: z.string(),
  from: z.string(),
  to: z.string(),
  entries: z.array(entry.extend({ workoutsBefore: z.array(workoutFact) })),
});
const empty = z.strictObject({});

type PainContext = {
  session: Parameters<typeof requireProfileOwner>[0];
  authz: { user: { id: string }; activeOrganizationId: string };
};

function member(context: PainContext) {
  const userId = requireProfileOwner(context.session);
  if (userId !== context.authz.user.id)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { userId, organizationId: context.authz.activeOrganizationId };
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PainError) {
      if (error.code === "DISABLED") throw raiseApiError("CONFLICT", error.message);
      throw raiseApiError("INVALID_INPUT", error.message);
    }
    throw error;
  }
}

async function audit(
  context: PainContext & { db: Parameters<typeof writeAuditLog>[0]["db"]; correlationId: string },
  eventType: "RECORD_CREATED" | "RECORD_DELETED" | "RECORD_UPDATED",
  targetType: "pain_entry" | "pain_preference",
  targetId: string,
) {
  await writeAuditLog({
    db: context.db,
    organizationId: context.authz.activeOrganizationId,
    actorUserId: context.authz.user.id,
    eventType,
    targetType,
    targetId,
    correlationId: context.correlationId,
    metadata: { source: "manual" },
  });
}

const read = () => permissionedProcedure({ resource: "records", action: "read" });
const write = () => permissionedProcedure({ resource: "records", action: "write" });
const service = (context: { db: Parameters<typeof createPainService>[0]["db"] }) =>
  createPainService({ db: context.db });

export const painRouter = {
  preference: read()
    .use(validateInput(empty))
    .input(empty)
    .output(preference)
    .handler(async ({ context }) => service(context).preference(member(context).userId)),

  setPreference: write()
    .use(validateInput(painPreferenceInput))
    .input(painPreferenceInput)
    .output(preference)
    .handler(async ({ context, input }) => {
      const { userId } = member(context);
      const next = await service(context).setPreference(userId, input);
      await audit(context, "RECORD_UPDATED", "pain_preference", userId);
      return next;
    }),

  /** One entry per region. */
  log: write()
    .use(validateInput(painLogInput))
    .input(painLogInput)
    .output(z.array(entry))
    .handler(async ({ context, input }) =>
      run(async () => {
        const created = await service(context).log(member(context), input);
        for (const row of created) await audit(context, "RECORD_CREATED", "pain_entry", row.id);
        return created;
      }),
    ),

  delete: write()
    .use(validateInput(painEntryIdInput))
    .input(painEntryIdInput)
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input }) => {
      const deleted = await service(context).delete(member(context), input.id);
      if (!deleted) throw raiseApiError("NOT_FOUND", "Entry not found.");
      await audit(context, "RECORD_DELETED", "pain_entry", input.id);
      return { deleted: true as const };
    }),

  map: read()
    .use(validateInput(painMapInput))
    .input(painMapInput)
    .output(map)
    .handler(async ({ context, input }) => service(context).map(member(context), input)),

  history: read()
    .use(validateInput(painHistoryInput))
    .input(painHistoryInput)
    .output(history)
    .handler(async ({ context, input }) => service(context).history(member(context), input)),
};
