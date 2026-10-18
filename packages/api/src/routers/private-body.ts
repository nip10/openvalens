import {
  createPrivateBodyMeasurementService,
  privateBodyMeasurementIdInput,
  privateBodyMeasurementPreferenceInput,
  privateBodyMeasurementValueInput,
} from "@openvalens/body";
import { writeAuditLog } from "@openvalens/audit-security";
import { z } from "zod";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";

const empty = z.strictObject({});
const output = z.object({
  id: z.string(),
  kind: z.string(),
  value: z.number(),
  unit: z.string(),
  measuredAt: z.string(),
  source: z.literal("manual"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const scope = z.object({ enabled: z.boolean() });

function member(context: {
  session: Parameters<typeof requireProfileOwner>[0];
  authz: { user: { id: string }; activeOrganizationId: string };
}) {
  const userId = requireProfileOwner(context.session);
  if (userId !== context.authz.user.id)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { userId, organizationId: context.authz.activeOrganizationId };
}

async function audit(
  context: Parameters<typeof member>[0] & {
    db: Parameters<typeof writeAuditLog>[0]["db"];
    correlationId: string;
  },
  userId: string,
  targetId: string | null,
  eventType: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED",
) {
  await writeAuditLog({
    db: context.db,
    organizationId: context.authz.activeOrganizationId,
    actorUserId: userId,
    eventType,
    targetType: "private_body_measurement",
    targetId: targetId ?? undefined,
    correlationId: context.correlationId,
    metadata: { source: "manual" },
  });
}

export const privateBodyRouter = {
  preference: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(empty))
    .input(empty)
    .output(scope)
    .handler(async ({ context }) => {
      const { userId } = member(context);
      const enabled = await createPrivateBodyMeasurementService({ db: context.db }).enabled(userId);
      return { enabled };
    }),

  setPreference: permissionedProcedure({ resource: "weight", action: "write" })
    .use(validateInput(privateBodyMeasurementPreferenceInput))
    .input(privateBodyMeasurementPreferenceInput)
    .output(scope)
    .handler(async ({ context, input }) => {
      const { userId } = member(context);
      const enabled = await createPrivateBodyMeasurementService({ db: context.db }).setEnabled(
        userId,
        input.enabled,
      );
      return { enabled };
    }),

  list: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(empty))
    .input(empty)
    .output(z.array(output))
    .handler(async ({ context }) => {
      const { userId, organizationId } = member(context);
      return createPrivateBodyMeasurementService({ db: context.db }).list(organizationId, userId);
    }),

  create: permissionedProcedure({ resource: "weight", action: "write" })
    .use(validateInput(privateBodyMeasurementValueInput))
    .input(privateBodyMeasurementValueInput)
    .output(output)
    .handler(async ({ context, input }) => {
      const { userId, organizationId } = member(context);
      const record = await createPrivateBodyMeasurementService({ db: context.db }).create(
        organizationId,
        userId,
        input,
      );
      if (!record) throw raiseApiError("CONFLICT", "Enable private body measurements first.");
      await audit(context, userId, record.id, "RECORD_CREATED");
      return record;
    }),

  update: permissionedProcedure({ resource: "weight", action: "write" })
    .use(
      validateInput(
        privateBodyMeasurementIdInput.extend({ value: privateBodyMeasurementValueInput }),
      ),
    )
    .input(privateBodyMeasurementIdInput.extend({ value: privateBodyMeasurementValueInput }))
    .output(output)
    .handler(async ({ context, input }) => {
      const { userId, organizationId } = member(context);
      const record = await createPrivateBodyMeasurementService({ db: context.db }).update(
        organizationId,
        userId,
        input.id,
        input.value,
      );
      if (!record) throw raiseApiError("NOT_FOUND", "Measurement not found.");
      await audit(context, userId, record.id, "RECORD_UPDATED");
      return record;
    }),

  delete: permissionedProcedure({ resource: "weight", action: "write" })
    .use(validateInput(privateBodyMeasurementIdInput))
    .input(privateBodyMeasurementIdInput)
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input }) => {
      const { userId, organizationId } = member(context);
      const deleted = await createPrivateBodyMeasurementService({ db: context.db }).remove(
        organizationId,
        userId,
        input.id,
      );
      if (!deleted) throw raiseApiError("NOT_FOUND", "Measurement not found.");
      await audit(context, userId, input.id, "RECORD_DELETED");
      return { deleted: true as const };
    }),
};
