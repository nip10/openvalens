import type { Session } from "@openvalens/auth";
import { requireTrustedIdentity } from "@openvalens/auth/authz/trusted-session";
import { lockNutritionSafetyUser, type Database } from "@openvalens/db";
import { wellnessProfile } from "@openvalens/db/schema/profile";
import { eq } from "drizzle-orm";

import { raiseApiError } from "./errors";
import {
  applyWellnessProfileUpdate,
  EMPTY_WELLNESS_PROFILE,
  LEGACY_PURPOSE_CONSENTS,
  normalizeModules,
  wellnessProfileSnapshotSchema,
  wellnessProfileUpdateInput,
  snapshotToState,
  type WellnessProfileField,
  type WellnessProfileRejection,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "./wellness-profile-contract";

/**
 * Issue #98 — user-owned wellness profile service.
 *
 * Ownership: every read and write is keyed by the trusted session user id and
 * nothing else — no organization, membership or client-supplied id is
 * consulted, so a workspace role can never reach another person's profile and
 * switching workspace never changes it. Impersonated sessions are denied.
 *
 * Writes are partial and optimistic:
 * - The row is locked (`for update`) and the shared contract rules
 *   ({@link applyWellnessProfileUpdate}) run against the locked state.
 * - A request that changes nothing (including a retry of a request that
 *   already succeeded) returns the current snapshot without a revision bump,
 *   even when its `expectedRevision` is stale.
 * - Otherwise a stale `expectedRevision` is a `CONFLICT` with no write.
 *
 * There is no per-field consent: the account's health-data consent covers the
 * profile, and clearing an answer deletes it.
 *
 * No answer value ever reaches a log line or an error: callers log only the
 * changed field names returned in {@link UpdateOutcome}.
 */

export type WellnessProfileErrorCode = "DENIED" | "CONFLICT" | "INVALID_INPUT" | "INTERNAL";

export class WellnessProfileError extends Error {
  readonly code: WellnessProfileErrorCode;
  readonly reason?: WellnessProfileRejection;
  readonly field?: WellnessProfileField;

  constructor(
    code: WellnessProfileErrorCode,
    detail: { reason?: WellnessProfileRejection; field?: WellnessProfileField } = {},
  ) {
    super(code);
    this.name = "WellnessProfileError";
    this.code = code;
    this.reason = detail.reason;
    this.field = detail.field;
  }
}

export type UpdateOutcome = {
  snapshot: WellnessProfileSnapshot;
  changedFields: string[];
};

export type WellnessProfileService = {
  read(userId: string): Promise<WellnessProfileSnapshot>;
  update(userId: string, input: WellnessProfileUpdateInput): Promise<UpdateOutcome>;
};

type ProfileReadExecutor = Pick<Database, "select">;
type ProfileRow = typeof wellnessProfile.$inferSelect;

function answer(state: string | null, value: unknown): unknown {
  if (state === null) return { state: "unknown" };
  if (state === "recorded") return { state, value };
  return { state };
}

/** Maps the stored row to the contract snapshot; a malformed row fails closed. */
export function toSnapshot(row: ProfileRow | undefined): WellnessProfileSnapshot {
  if (!row) return EMPTY_WELLNESS_PROFILE;
  const parsed = wellnessProfileSnapshotSchema.safeParse({
    revision: row.revision,
    setupStatus: row.setupStatus,
    eligibility: answer(row.eligibilityState, row.eligibility),
    focus: answer(row.focusState, row.focusAreas),
    inputMethod: answer(row.inputMethodState, row.inputMethod),
    region: answer(row.regionState, row.region),
    birthYear: answer(row.birthYearState, row.birthYear),
    sex: answer(row.sexState, row.sex),
    enabledModules: row.enabledModules,
    consents: LEGACY_PURPOSE_CONSENTS,
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed.success) throw new WellnessProfileError("INTERNAL");
  const modules = parsed.data.enabledModules;
  return { ...parsed.data, enabledModules: modules === null ? null : normalizeModules(modules) };
}

function columnsFor(snapshotAnswers: ReturnType<typeof snapshotToState>["answers"]) {
  const pair = (value: { state: string; value?: unknown }) => ({
    state: value.state === "unknown" ? null : value.state,
    value: value.state === "recorded" ? value.value : null,
  });
  const eligibility = pair(snapshotAnswers.eligibility);
  const focus = pair(snapshotAnswers.focus);
  const inputMethod = pair(snapshotAnswers.inputMethod);
  const region = pair(snapshotAnswers.region);
  const birthYear = pair(snapshotAnswers.birthYear);
  const sex = pair(snapshotAnswers.sex);
  return {
    eligibilityState: eligibility.state,
    eligibility: eligibility.value as string | null,
    focusState: focus.state,
    focusAreas: focus.value as string[] | null,
    inputMethodState: inputMethod.state,
    inputMethod: inputMethod.value as string | null,
    regionState: region.state,
    region: region.value as string | null,
    birthYearState: birthYear.state,
    birthYear: birthYear.value as number | null,
    sexState: sex.state,
    sex: sex.value as string | null,
  };
}

export function createWellnessProfileService(deps: {
  db: Database;
  now?: () => Date;
}): WellnessProfileService {
  const { db } = deps;
  const clock = deps.now ?? (() => new Date());

  async function read(userId: string): Promise<WellnessProfileSnapshot> {
    return readWellnessProfile(db, userId);
  }

  async function update(userId: string, input: WellnessProfileUpdateInput): Promise<UpdateOutcome> {
    // Re-validate strictly even though the router already did.
    const parsed = wellnessProfileUpdateInput.safeParse(input);
    if (!parsed.success) throw new WellnessProfileError("INVALID_INPUT");
    const request = parsed.data;
    const now = clock();

    try {
      return await db.transaction(async (tx) => {
        await lockNutritionSafetyUser(tx, userId);
        await tx.insert(wellnessProfile).values({ userId }).onConflictDoNothing();
        const [row] = await tx
          .select()
          .from(wellnessProfile)
          .where(eq(wellnessProfile.userId, userId))
          .for("update");
        const current = toSnapshot(row);

        const result = applyWellnessProfileUpdate(snapshotToState(current), request, now);
        if (!result.ok) {
          throw new WellnessProfileError("INVALID_INPUT", {
            reason: result.reason,
            field: result.field,
          });
        }

        if (result.changedFields.length === 0) {
          return { snapshot: current, changedFields: [] };
        }
        if (request.expectedRevision !== current.revision) {
          throw new WellnessProfileError("CONFLICT");
        }

        await tx
          .update(wellnessProfile)
          .set({
            ...columnsFor(result.next.answers),
            setupStatus: result.next.setupStatus,
            enabledModules: result.next.enabledModules,
            revision: current.revision + 1,
            updatedAt: now,
          })
          .where(eq(wellnessProfile.userId, userId));

        const [saved] = await tx
          .select()
          .from(wellnessProfile)
          .where(eq(wellnessProfile.userId, userId));
        return { snapshot: toSnapshot(saved), changedFields: result.changedFields };
      });
    } catch (error) {
      throw error instanceof WellnessProfileError ? error : new WellnessProfileError("INTERNAL");
    }
  }

  return { read, update };
}

export async function readWellnessProfile(
  executor: ProfileReadExecutor,
  userId: string,
): Promise<WellnessProfileSnapshot> {
  try {
    const [row] = await executor
      .select()
      .from(wellnessProfile)
      .where(eq(wellnessProfile.userId, userId));
    return toSnapshot(row);
  } catch (error) {
    throw error instanceof WellnessProfileError ? error : new WellnessProfileError("INTERNAL");
  }
}

/** The trusted, non-impersonated session user, or a value-free denial. */
export function requireProfileOwner(session: Session | null | undefined): string {
  try {
    return requireTrustedIdentity(session).userId;
  } catch {
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  }
}

/** Maps a typed profile failure to the stable, value-free envelope. */
export function mapWellnessProfileError(error: unknown): never {
  if (error instanceof WellnessProfileError) {
    switch (error.code) {
      case "DENIED":
        throw raiseApiError(
          "PERMISSION_DENIED",
          "You do not have permission to perform this action.",
        );
      case "CONFLICT":
        throw raiseApiError(
          "CONFLICT",
          "Your profile was changed by another request. Reload and try again.",
        );
      case "INVALID_INPUT":
        // Only the reason code and field name leave the server — never a value.
        throw raiseApiError("INVALID_INPUT", "Invalid input", {
          reason: error.reason ?? null,
          field: error.field ?? null,
        });
      case "INTERNAL":
        throw raiseApiError("INTERNAL", "Something went wrong.");
    }
  }
  throw raiseApiError("INTERNAL", "Something went wrong.");
}
