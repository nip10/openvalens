import {
  createPrivateBodyMeasurementService,
  privateBodyMeasurementIdInput,
  privateBodyMeasurementPreferenceInput,
  privateBodyMeasurementValueInput,
} from "@openvalens/body";
import { writeAuditLog } from "@openvalens/audit-security";
import { privateBodyMeasurementPreference } from "@openvalens/db/schema/body";
import { createStructuredLogger } from "@openvalens/observability";
import { describeStorageError, type StorageService } from "@openvalens/storage";
import { eq } from "drizzle-orm";
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

const logger = createStructuredLogger({ level: "info" });

/** A progress photo's metadata (#85). The image itself is read via `storage.downloadUrl`. */
const photo = z.object({
  id: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});
const photoList = z.object({
  /** The member's private-body opt-in; photos are hidden and uploads refused while off. */
  enabled: z.boolean(),
  /** Whether this server has object storage configured. */
  storage: z.boolean(),
  photos: z.array(photo),
});
/** Upload limit before decoding; the sanitizer enforces the same bound. */
export const PROGRESS_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const uploadPhotoInput = z.strictObject({
  photo: z
    .instanceof(Blob)
    .refine((file) => file.size > 0 && file.size <= PROGRESS_PHOTO_MAX_BYTES, {
      message: "Choose a JPEG or PNG photo up to 10 MB.",
    }),
});

const photoIdInput = z.strictObject({ id: z.uuid() });

function toPhoto(object: { id: string; contentType: string; sizeBytes: number; createdAt: Date }) {
  return {
    id: object.id,
    contentType: object.contentType,
    sizeBytes: object.sizeBytes,
    createdAt: object.createdAt.toISOString(),
  };
}

/** The member turned private body tracking off while a photo was being stored. */
class PhotoOptOutError extends Error {}

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
  targetType: "private_body_measurement" | "progress_photo" = "private_body_measurement",
) {
  await writeAuditLog({
    db: context.db,
    organizationId: context.authz.activeOrganizationId,
    actorUserId: userId,
    eventType,
    targetType,
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

  /** The member's own progress photos (#85); empty while private body tracking is off. */
  photos: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(empty))
    .input(empty)
    .output(photoList)
    .handler(async ({ context }) => {
      const { userId, organizationId } = member(context);
      const storage = context.storage ?? null;
      const enabled = await createPrivateBodyMeasurementService({ db: context.db }).enabled(userId);
      if (!enabled || !storage) return { enabled, storage: storage !== null, photos: [] };
      const objects = await storage.listPhotos({ organizationId, createdByUserId: userId });
      return { enabled, storage: true, photos: objects.map(toPhoto) };
    }),

  /**
   * Stores one progress photo (#85). The original bytes are decoded and
   * re-encoded first, which drops EXIF, GPS and every other metadata block;
   * only the sanitized copy is written to private storage. Refused unless the
   * member opted in, re-checked inside the publishing transaction.
   */
  uploadPhoto: permissionedProcedure({ resource: "weight", action: "write" })
    .use(validateInput(uploadPhotoInput))
    .input(uploadPhotoInput)
    .output(photo)
    .handler(async ({ context, input }) => {
      const { userId, organizationId } = member(context);
      const storage: StorageService | null = context.storage ?? null;
      if (!storage) throw raiseApiError("CONFLICT", "Photo storage is not set up on this server.");
      const service = createPrivateBodyMeasurementService({ db: context.db });
      if (!(await service.enabled(userId)))
        throw raiseApiError("CONFLICT", "Turn on private body tracking first.");

      // Loaded on demand: Sharp is a native module only the server needs.
      const { ImageSanitizationError, sanitizeImage } =
        await import("@openvalens/body/sanitize-image");
      let sanitized: Awaited<ReturnType<typeof sanitizeImage>>;
      try {
        sanitized = await sanitizeImage(new Uint8Array(await input.photo.arrayBuffer()));
      } catch (error) {
        if (error instanceof ImageSanitizationError)
          throw raiseApiError("INVALID_INPUT", "Choose a JPEG or PNG photo up to 10 MB.");
        throw error;
      }

      try {
        const ref = await storage.reservePhoto({
          organizationId,
          createdByUserId: userId,
          contentType: sanitized.contentType,
          canonicalBytes: sanitized.bytes,
        });
        const stored = await storage.writePhoto({
          ref,
          bytes: sanitized.bytes,
          linkPhoto: async (tx) => {
            const [preference] = await tx
              .select({ enabled: privateBodyMeasurementPreference.enabled })
              .from(privateBodyMeasurementPreference)
              .where(eq(privateBodyMeasurementPreference.userId, userId))
              .for("update");
            if (preference?.enabled !== true) throw new PhotoOptOutError();
          },
        });
        await audit(context, userId, stored.id, "RECORD_CREATED", "progress_photo");
        return toPhoto(stored);
      } catch (error) {
        if (error instanceof PhotoOptOutError)
          throw raiseApiError("CONFLICT", "Turn on private body tracking first.");
        logger.error("private_body.photo.upload_failed", {
          correlationId: context.correlationId,
          ...describeStorageError(error),
        });
        throw raiseApiError("INTERNAL", "The photo could not be saved.");
      }
    }),

  /**
   * The image bytes of one of the member's own progress photos (#85), served
   * through the authenticated API so no shareable link exists. Another
   * member's photo, a missing one, or any photo while the opt-in is off is
   * indistinguishable: `NOT_FOUND`.
   */
  photoFile: permissionedProcedure({ resource: "weight", action: "read" })
    .use(validateInput(photoIdInput))
    .input(photoIdInput)
    .output(z.instanceof(Blob))
    .handler(async ({ context, input }) => {
      const { userId, organizationId } = member(context);
      const storage = context.storage ?? null;
      const enabled = await createPrivateBodyMeasurementService({ db: context.db }).enabled(userId);
      const found =
        enabled && storage ? await storage.getObject({ organizationId, objectId: input.id }) : null;
      if (
        !found ||
        found.object.purpose !== "progress_photo" ||
        found.object.createdByUserId !== userId
      ) {
        await found?.body.cancel();
        throw raiseApiError("NOT_FOUND", "Photo not found.");
      }
      const bytes = await new Response(found.body).arrayBuffer();
      return new Blob([bytes], { type: found.object.contentType });
    }),
};
