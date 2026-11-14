import { writeAuditLog } from "@openvalens/audit-security";
import { requirePermission } from "@openvalens/auth/authz/guard";
import {
  createTrackerService,
  TRACKER_AGGREGATIONS,
  TRACKER_FEED_DEFINITIONS,
  TRACKER_FEEDS,
  TRACKER_ICONS,
  TRACKER_TARGET_PERIODS,
  TRACKER_TEMPLATE_IDS,
  TRACKER_TYPES,
  TrackerError,
  trackerArchiveInput,
  trackerChartInput,
  trackerCreateInput,
  trackerDeleteInput,
  trackerEntriesInput,
  trackerEntryIdInput,
  trackerEntryUpdateInput,
  trackerFeedImportInput,
  trackerFeedLinkInput,
  trackerFeedUnlinkInput,
  trackerIdInput,
  trackerListInput,
  trackerLogInput,
  trackerUpdateInput,
  type TrackerViewer,
} from "@openvalens/trackers";
import { z } from "zod";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #441 — custom trackers, mounted as `appRouter.trackers`.
 *
 * Reads need `records:read`, writes `records:write`, and every call needs the
 * member's own, non-impersonated session. The member and workspace come from
 * the session, never the input. A tracker is private to its owner unless
 * shared; a shared tracker is visible to members with read access, and
 * collaborators and above log into it. Only the owner changes, shares,
 * archives or deletes a tracker (`FORBIDDEN` otherwise). Audit rows carry ids
 * only: no names, values or notes.
 *
 * Phone feeds (#452): the owner links one tracker per feed (HealthKit mindful
 * sessions, Health Connect mindfulness, HealthKit State of Mind) from the
 * phone, and the phone imports what it reads with `importFeed`, idempotent on
 * the platform record id.
 */

const person = z.object({
  userId: z.string().nullable(),
  name: z.string().nullable(),
  isYou: z.boolean(),
});
const targetShape = z.object({ value: z.number(), period: z.enum(TRACKER_TARGET_PERIODS) });
const progress = z.object({
  period: z.enum(TRACKER_TARGET_PERIODS),
  target: z.number(),
  current: z.number().nullable(),
  met: z.boolean(),
  metCount: z.number(),
  periodCount: z.number(),
});
const tracker = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.enum(TRACKER_ICONS),
  template: z.enum(TRACKER_TEMPLATE_IDS).nullable(),
  type: z.enum(TRACKER_TYPES),
  unit: z.string().nullable(),
  decimals: z.number(),
  aggregation: z.enum(TRACKER_AGGREGATIONS),
  target: targetShape.nullable(),
  shared: z.boolean(),
  aiVisible: z.boolean(),
  archivedAt: z.string().nullable(),
  owner: person,
  canEdit: z.boolean(),
  canLog: z.boolean(),
  locked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const summary = tracker.extend({ today: z.number().nullable(), progress: progress.nullable() });
const entry = z.object({
  id: z.string(),
  trackerId: z.string(),
  value: z.number(),
  loggedAt: z.string(),
  localDate: z.string(),
  note: z.string().nullable(),
  source: z.string(),
  loggedBy: person,
  canEdit: z.boolean(),
});
const chart = z.object({
  trackerId: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.array(z.object({ date: z.string(), value: z.number().nullable(), count: z.number() })),
  loggedDays: z.number(),
  average: z.number().nullable(),
  total: z.number().nullable(),
  progress: progress.nullable(),
});

const feedLink = z.object({
  feed: z.enum(TRACKER_FEEDS),
  trackerId: z.string(),
  trackerName: z.string(),
  trackerArchived: z.boolean(),
  linkedAt: z.string(),
});

type TrackerContext = {
  session: Parameters<typeof requireProfileOwner>[0];
  authz: { user: { id: string }; activeOrganizationId: string };
  honoContext: { req: { raw: { headers: Headers } } };
};

function member(context: TrackerContext) {
  const userId = requireProfileOwner(context.session);
  if (userId !== context.authz.user.id)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { userId, organizationId: context.authz.activeOrganizationId };
}

/** A read: whether the member's role may also write records (for `canLog` / `canEdit`). */
async function reader(context: TrackerContext): Promise<TrackerViewer> {
  const scope = member(context);
  let canWrite = false;
  try {
    await requirePermission(
      { req: { raw: { headers: context.honoContext.req.raw.headers } } },
      { resource: "records", action: "write" },
    );
    canWrite = true;
  } catch {
    canWrite = false;
  }
  return { ...scope, canWrite };
}

/** A write: the procedure already checked `records:write`. */
function writer(context: TrackerContext): TrackerViewer {
  return { ...member(context), canWrite: true };
}

function mapError(error: unknown): never {
  if (error instanceof TrackerError) {
    switch (error.code) {
      case "NOT_FOUND":
        throw raiseApiError("NOT_FOUND", error.message);
      case "FORBIDDEN":
        throw raiseApiError("PERMISSION_DENIED", error.message);
      case "INVALID":
      case "CONFIRMATION":
        throw raiseApiError("INVALID_INPUT", error.message);
      case "LOCKED":
      case "LIMIT":
      case "ARCHIVED":
      case "NOT_LINKED":
        throw raiseApiError("CONFLICT", error.message);
    }
  }
  throw error;
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    mapError(error);
  }
}

async function audit(
  context: TrackerContext & {
    db: Parameters<typeof writeAuditLog>[0]["db"];
    correlationId: string;
  },
  eventType: "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_DELETED",
  targetType: "custom_tracker" | "custom_tracker_entry",
  targetId: string,
  metadata: Record<string, string | number> = { source: "manual" },
) {
  await writeAuditLog({
    db: context.db,
    organizationId: context.authz.activeOrganizationId,
    actorUserId: context.authz.user.id,
    eventType,
    targetType,
    targetId,
    correlationId: context.correlationId,
    metadata,
  });
}

const read = () => permissionedProcedure({ resource: "records", action: "read" });
const write = () => permissionedProcedure({ resource: "records", action: "write" });
const service = (context: { db: Parameters<typeof createTrackerService>[0]["db"] }) =>
  createTrackerService({ db: context.db });

export const trackersRouter = {
  list: read()
    .use(validateInput(trackerListInput))
    .input(trackerListInput)
    .output(z.array(summary))
    .handler(async ({ context, input }) =>
      run(async () => service(context).list(await reader(context), input)),
    ),

  get: read()
    .use(validateInput(trackerIdInput))
    .input(trackerIdInput)
    .output(tracker)
    .handler(async ({ context, input }) =>
      run(async () => service(context).get(await reader(context), input.id)),
    ),

  create: write()
    .use(validateInput(trackerCreateInput))
    .input(trackerCreateInput)
    .output(tracker)
    .handler(async ({ context, input }) =>
      run(async () => {
        const created = await service(context).create(writer(context), input);
        await audit(context, "RECORD_CREATED", "custom_tracker", created.id);
        return created;
      }),
    ),

  update: write()
    .use(validateInput(trackerUpdateInput))
    .input(trackerUpdateInput)
    .output(tracker)
    .handler(async ({ context, input }) =>
      run(async () => {
        const updated = await service(context).update(writer(context), input);
        await audit(context, "RECORD_UPDATED", "custom_tracker", updated.id);
        return updated;
      }),
    ),

  setArchived: write()
    .use(validateInput(trackerArchiveInput))
    .input(trackerArchiveInput)
    .output(tracker)
    .handler(async ({ context, input }) =>
      run(async () => {
        const updated = await service(context).setArchived(
          writer(context),
          input.id,
          input.archived,
        );
        await audit(context, "RECORD_UPDATED", "custom_tracker", updated.id);
        return updated;
      }),
    ),

  delete: write()
    .use(validateInput(trackerDeleteInput))
    .input(trackerDeleteInput)
    .output(z.object({ deleted: z.literal(true), deletedEntries: z.number() }))
    .handler(async ({ context, input }) =>
      run(async () => {
        const result = await service(context).remove(writer(context), input.id, input.confirmation);
        await audit(context, "RECORD_DELETED", "custom_tracker", input.id);
        return { deleted: true as const, deletedEntries: result.deletedEntries };
      }),
    ),

  log: write()
    .use(validateInput(trackerLogInput))
    .input(trackerLogInput)
    .output(entry)
    .handler(async ({ context, input }) =>
      run(async () => {
        const created = await service(context).log(writer(context), input);
        await audit(context, "RECORD_CREATED", "custom_tracker_entry", created.id);
        return created;
      }),
    ),

  updateEntry: write()
    .use(validateInput(trackerEntryUpdateInput))
    .input(trackerEntryUpdateInput)
    .output(entry)
    .handler(async ({ context, input }) =>
      run(async () => {
        const updated = await service(context).updateEntry(writer(context), input);
        await audit(context, "RECORD_UPDATED", "custom_tracker_entry", updated.id);
        return updated;
      }),
    ),

  deleteEntry: write()
    .use(validateInput(trackerEntryIdInput))
    .input(trackerEntryIdInput)
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input }) =>
      run(async () => {
        await service(context).deleteEntry(writer(context), input.id);
        await audit(context, "RECORD_DELETED", "custom_tracker_entry", input.id);
        return { deleted: true as const };
      }),
    ),

  entries: read()
    .use(validateInput(trackerEntriesInput))
    .input(trackerEntriesInput)
    .output(z.object({ entries: z.array(entry), hasMore: z.boolean() }))
    .handler(async ({ context, input }) =>
      run(async () => service(context).entries(await reader(context), input)),
    ),

  chart: read()
    .use(validateInput(trackerChartInput))
    .input(trackerChartInput)
    .output(chart)
    .handler(async ({ context, input }) =>
      run(async () => service(context).chart(await reader(context), input)),
    ),

  /** The member's own phone-feed links (#452). */
  feeds: read()
    .output(z.array(feedLink))
    .handler(async ({ context }) => run(async () => service(context).feeds(member(context)))),

  linkFeed: write()
    .use(validateInput(trackerFeedLinkInput))
    .input(trackerFeedLinkInput)
    .output(feedLink)
    .handler(async ({ context, input }) =>
      run(async () => {
        const link = await service(context).linkFeed(writer(context), input);
        await audit(context, "RECORD_UPDATED", "custom_tracker", link.trackerId, {
          source: TRACKER_FEED_DEFINITIONS[input.feed].source,
          feed: input.feed,
          action: "feed_linked",
        });
        return link;
      }),
    ),

  unlinkFeed: write()
    .use(validateInput(trackerFeedUnlinkInput))
    .input(trackerFeedUnlinkInput)
    .output(z.object({ unlinked: z.boolean() }))
    .handler(async ({ context, input }) =>
      run(async () => {
        const result = await service(context).unlinkFeed(writer(context), input);
        if (result.trackerId)
          await audit(context, "RECORD_UPDATED", "custom_tracker", result.trackerId, {
            source: TRACKER_FEED_DEFINITIONS[input.feed].source,
            feed: input.feed,
            action: "feed_unlinked",
          });
        return { unlinked: result.unlinked };
      }),
    ),

  importFeed: write()
    .use(validateInput(trackerFeedImportInput))
    .input(trackerFeedImportInput)
    .output(z.object({ imported: z.number(), duplicates: z.number(), skipped: z.number() }))
    .handler(async ({ context, input }) =>
      run(async () => {
        const result = await service(context).importFeed(writer(context), input);
        // One row per import call, with counts only: no values or record ids.
        if (result.imported > 0)
          await audit(context, "RECORD_CREATED", "custom_tracker", input.trackerId, {
            source: TRACKER_FEED_DEFINITIONS[input.feed].source,
            feed: input.feed,
            imported: result.imported,
          });
        return result;
      }),
    ),
};
