import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@openvalens/db";
import {
  dataSource,
  ingestionBatch,
  ingestionJob,
  ingestionRawArtifact,
  provenanceLink,
} from "@openvalens/db/schema/health-record";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { wearableConnection, wearableOauthState } from "@openvalens/db/schema/wearables";
import { stableSerialize } from "@openvalens/health-record";
import {
  CLOUD_IMPORT_CHANNEL,
  mobileIntentDedupeHash,
  persistCanonicalIntents,
  PHONE_FIRST_RELATION,
  reconcilePhoneFirst,
  type CanonicalRowRef,
  type CanonicalWriteIntent,
} from "@openvalens/ingestion";
import type { StructuredLogger } from "@openvalens/observability";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import {
  describeWearableError,
  isWearableProviderId,
  WearableProviderError,
  WearableWebhookRejected,
  type SyncWindow,
  type WearableAdapter,
  type WearableProviderId,
  type WearableTokenSet,
} from "./adapter";
import { WEARABLE_PROVIDER_INFO } from "./config";
import {
  openToken,
  sealToken,
  WearableTokenUnreadableError,
  type TokenField,
} from "./token-crypto";

/**
 * Cloud wearable connections (Issue #60): OAuth connect, encrypted tokens,
 * locked refresh, sync into the normal ingestion pipeline, webhooks,
 * disconnect and quarantine. Adapters only talk to vendors; this module owns
 * every database write.
 *
 * Tenant isolation: every person-facing call takes the organization and user
 * from the server session and scopes each query by both. Webhooks carry only
 * a vendor user id; they can schedule a sync or hide one record, never read.
 *
 * Logs carry ids, provider ids, counts and value-free error codes only.
 */

export const WEARABLE_SYNC_JOB_TYPE = "wearable_sync";
export const WEARABLE_SYNC_ARTIFACT_TYPE = "wearable_sync_batch";
export const WEARABLE_QUARANTINE_RELATION = "quarantined_by_deauthorization";
/** First sync reaches this far back. */
export const WEARABLE_BACKFILL_DAYS = 30;
/** Each sync re-reads this much before the cursor, because vendors revise recent days. */
const OVERLAP_MS = 2 * 86_400_000;
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 60_000;
const RAW_RETENTION_DAYS = 30;
const DEFAULT_POLL_INTERVAL_MS = 6 * 3_600_000;

export type WearableConnectionStatus =
  | "not_connected"
  | "active"
  | "reconnect_needed"
  | "quarantined";

export type WearableConnectionView = {
  provider: WearableProviderId;
  displayName: string;
  sends: string;
  termsUrl: string;
  status: WearableConnectionStatus;
  /** Last successful sync (the cursor), ISO. */
  lastSyncedAt: string | null;
  /** Value-free code of the last failure, or `null`. */
  lastErrorCode: string | null;
  /** Rows held back after an upstream deauthorization, pending keep / delete. */
  quarantinedRecordCount: number;
};

export type WearableConnectErrorCode =
  | "provider_unavailable"
  | "state_invalid"
  | "session_mismatch"
  | "account_in_use"
  | "already_connected"
  | "provider_failed";

export class WearableConnectError extends Error {
  readonly code: WearableConnectErrorCode;
  constructor(code: WearableConnectErrorCode) {
    super(`Wearable connect failed (${code})`);
    this.name = "WearableConnectError";
    this.code = code;
  }
}

export class WearableNotConnectedError extends Error {
  constructor() {
    super("No wearable connection for this provider.");
    this.name = "WearableNotConnectedError";
  }
}

export type WearableSyncOutcome =
  | {
      status: "succeeded";
      connectionId: number;
      accepted: number;
      duplicates: number;
      rejected: number;
      superseded: number;
      shadowed: number;
    }
  | { status: "failed"; connectionId: number; errorCode: string }
  | { status: "skipped"; connectionId: number };

export type WearablesServiceDeps = {
  db: Database;
  adapters: Readonly<Partial<Record<WearableProviderId, WearableAdapter>>>;
  /** From `deriveWearableTokenKey(BETTER_AUTH_SECRET)`. */
  tokenKey: Buffer;
  /** Public origin of this server (`BETTER_AUTH_URL`): redirect and webhook URLs hang off it. */
  serverOrigin: string;
  /** Register vendor notification callbacks on connect. */
  webhooks: boolean;
  logger?: StructuredLogger;
  now?: () => Date;
};

type ConnectionRow = typeof wearableConnection.$inferSelect;

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function wearableCallbackPath(provider: WearableProviderId): string {
  return `/api/integrations/wearables/${provider}/callback`;
}

export function wearableWebhookPath(provider: WearableProviderId): string {
  return `/api/integrations/wearables/${provider}/webhook`;
}

export type WearablesService = ReturnType<typeof createWearablesService>;

export function createWearablesService(deps: WearablesServiceDeps) {
  const { db, adapters, tokenKey } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.logger;
  const origin = new URL(deps.serverOrigin).origin;

  const configured = () => Object.keys(adapters).filter(isWearableProviderId);

  function adapterFor(provider: WearableProviderId): WearableAdapter {
    const adapter = adapters[provider];
    if (!adapter) throw new WearableConnectError("provider_unavailable");
    return adapter;
  }

  const redirectUri = (provider: WearableProviderId) =>
    `${origin}${wearableCallbackPath(provider)}`;
  const webhookUrl = (provider: WearableProviderId) => `${origin}${wearableWebhookPath(provider)}`;

  const binding = (
    row: Pick<ConnectionRow, "organizationId" | "providerConnectionId">,
    field: TokenField,
  ) => ({
    organizationId: row.organizationId,
    providerConnectionId: row.providerConnectionId,
    field,
  });

  function sealTokens(
    row: Pick<ConnectionRow, "organizationId" | "providerConnectionId">,
    tokens: WearableTokenSet,
  ) {
    return {
      accessTokenCiphertext: sealToken(tokenKey, tokens.accessToken, binding(row, "access_token")),
      refreshTokenCiphertext: tokens.refreshToken
        ? sealToken(tokenKey, tokens.refreshToken, binding(row, "refresh_token"))
        : null,
      accessTokenExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
    };
  }

  function openTokens(row: ConnectionRow) {
    if (!row.accessTokenCiphertext) throw new WearableTokenUnreadableError();
    return {
      accessToken: openToken(tokenKey, row.accessTokenCiphertext, binding(row, "access_token")),
      refreshToken: row.refreshTokenCiphertext
        ? openToken(tokenKey, row.refreshTokenCiphertext, binding(row, "refresh_token"))
        : null,
    };
  }

  async function findForUser(organizationId: string, userId: string, provider: WearableProviderId) {
    const [row] = await db
      .select()
      .from(wearableConnection)
      .where(
        and(
          eq(wearableConnection.organizationId, organizationId),
          eq(wearableConnection.userId, userId),
          eq(wearableConnection.provider, provider),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function markReconnectNeeded(id: number, code: string) {
    const at = now();
    await db
      .update(wearableConnection)
      .set({ status: "reconnect_needed", lastErrorCode: code, updatedAt: at })
      .where(and(eq(wearableConnection.id, id), eq(wearableConnection.status, "active")));
  }

  /**
   * The connection's access token, refreshed first when it is about to
   * expire. The refresh runs while holding the row lock (`FOR UPDATE`), so a
   * concurrent caller waits and then reads the rotated token instead of
   * spending the single-use refresh token a second time (Oura). A refused
   * refresh marks the connection `reconnect_needed`.
   */
  async function freshAccessToken(
    connectionId: number,
    options: { force?: boolean } = {},
  ): Promise<{ accessToken: string; row: ConnectionRow }> {
    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(wearableConnection)
        .where(eq(wearableConnection.id, connectionId))
        .limit(1)
        .for("update");
      if (!row || row.status !== "active") return { kind: "inactive" as const };
      const adapter = adapters[row.provider as WearableProviderId];
      if (!adapter) return { kind: "inactive" as const };
      let tokens: ReturnType<typeof openTokens>;
      try {
        tokens = openTokens(row);
      } catch {
        return { kind: "reconnect" as const, code: "token_unreadable", provider: adapter.id };
      }
      const expiring =
        row.accessTokenExpiresAt !== null &&
        row.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS <= now().getTime();
      if (!adapter.refreshes || (!expiring && !options.force) || !tokens.refreshToken)
        return { kind: "ok" as const, accessToken: tokens.accessToken, row };
      let refreshed: WearableTokenSet;
      try {
        refreshed = await adapter.refresh(tokens.refreshToken);
      } catch (error) {
        if (error instanceof WearableProviderError && error.category === "reauthorization_required")
          return {
            kind: "reconnect" as const,
            code: "reauthorization_required",
            provider: adapter.id,
          };
        throw error;
      }
      const at = now();
      const [updated] = await tx
        .update(wearableConnection)
        .set({
          ...sealTokens(row, {
            ...refreshed,
            // Vendors that keep the refresh token return none on refresh.
            refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
          }),
          tokenVersion: row.tokenVersion + 1,
          updatedAt: at,
        })
        .where(eq(wearableConnection.id, row.id))
        .returning();
      log?.info("wearables.token.refreshed", {
        provider: row.provider,
        connectionId: row.id,
        tokenVersion: row.tokenVersion + 1,
      });
      return { kind: "ok" as const, accessToken: refreshed.accessToken, row: updated! };
    });
    if (outcome.kind === "inactive") throw new WearableNotConnectedError();
    if (outcome.kind === "reconnect") {
      await markReconnectNeeded(connectionId, outcome.code);
      log?.warn("wearables.connection.reconnect_needed", { connectionId, errorCode: outcome.code });
      throw new WearableProviderError(outcome.provider, "reauthorization_required");
    }
    return outcome;
  }

  // ─── Connect ────────────────────────────────────────────────────

  /** Starts an authorization: stores the hashed state and returns the vendor URL. */
  async function startConnect(input: {
    organizationId: string;
    userId: string;
    provider: WearableProviderId;
  }): Promise<{ authorizationUrl: string }> {
    const adapter = adapterFor(input.provider);
    const state = randomBytes(32).toString("base64url");
    const at = now();
    await db.insert(wearableOauthState).values({
      stateHash: hashState(state),
      organizationId: input.organizationId,
      userId: input.userId,
      provider: input.provider,
      expiresAt: new Date(at.getTime() + STATE_TTL_MS),
      createdAt: at,
    });
    return {
      authorizationUrl: adapter.authorizationUrl({
        state,
        redirectUri: redirectUri(input.provider),
      }),
    };
  }

  /**
   * OAuth callback. The state must be unused, unexpired, for this provider and
   * started by the same signed-in person; it is consumed atomically first.
   * Reconnecting keeps the sync cursor, so a gap (for example an expired
   * Google Testing-mode token) is backfilled by the next sync.
   */
  async function completeConnect(input: {
    provider: WearableProviderId;
    state: string;
    code: string;
    sessionUserId: string;
  }): Promise<{ organizationId: string; connectionId: number }> {
    const adapter = adapterFor(input.provider);
    const at = now();
    const [claimed] = await db
      .update(wearableOauthState)
      .set({ usedAt: at })
      .where(
        and(
          eq(wearableOauthState.stateHash, hashState(input.state)),
          eq(wearableOauthState.provider, input.provider),
          isNull(wearableOauthState.usedAt),
          gt(wearableOauthState.expiresAt, at),
        ),
      )
      .returning();
    if (!claimed) throw new WearableConnectError("state_invalid");
    if (claimed.userId !== input.sessionUserId) throw new WearableConnectError("session_mismatch");
    const { organizationId, userId } = claimed;

    let tokens: WearableTokenSet;
    let externalUserId: string;
    try {
      tokens = await adapter.exchangeCode({
        code: input.code,
        redirectUri: redirectUri(input.provider),
      });
      externalUserId = await adapter.identify(tokens);
      if (adapter.onConnected)
        await adapter.onConnected({
          accessToken: tokens.accessToken,
          externalUserId,
          webhookUrl: deps.webhooks ? webhookUrl(input.provider) : null,
        });
    } catch (error) {
      log?.warn("wearables.connect.failed", {
        provider: input.provider,
        organizationId,
        ...describeWearableError(error),
      });
      throw new WearableConnectError("provider_failed");
    }

    const connectionId = await db.transaction(async (tx) => {
      const [existingAccount] = await tx
        .select({
          id: providerConnection.id,
          userId: providerConnection.userId,
          activeUserId: wearableConnection.userId,
        })
        .from(providerConnection)
        .leftJoin(
          wearableConnection,
          and(
            eq(wearableConnection.providerConnectionId, providerConnection.id),
            eq(wearableConnection.organizationId, providerConnection.organizationId),
          ),
        )
        .where(
          and(
            eq(providerConnection.organizationId, organizationId),
            eq(providerConnection.provider, input.provider),
            eq(providerConnection.externalUserId, externalUserId),
          ),
        )
        .limit(1)
        .for("update", { of: providerConnection });
      if (existingAccount?.activeUserId && existingAccount.activeUserId !== userId)
        throw new WearableConnectError("account_in_use");

      let providerConnectionId: number;
      if (existingAccount) {
        providerConnectionId = existingAccount.id;
        await tx
          .update(providerConnection)
          .set({
            userId,
            status: "active",
            disconnectedAt: null,
            accessScope: tokens.scope,
            connectedAt: at,
            updatedAt: at,
          })
          .where(
            and(
              eq(providerConnection.id, providerConnectionId),
              eq(providerConnection.organizationId, organizationId),
            ),
          );
      } else {
        const [created] = await tx
          .insert(providerConnection)
          .values({
            organizationId,
            provider: input.provider,
            externalUserId,
            userId,
            status: "active",
            accessScope: tokens.scope,
            connectedAt: at,
            createdAt: at,
            updatedAt: at,
          })
          .returning({ id: providerConnection.id });
        providerConnectionId = created!.id;
      }

      const [mine] = await tx
        .select()
        .from(wearableConnection)
        .where(
          and(
            eq(wearableConnection.organizationId, organizationId),
            eq(wearableConnection.userId, userId),
            eq(wearableConnection.provider, input.provider),
          ),
        )
        .limit(1)
        .for("update");
      if (mine && mine.providerConnectionId !== providerConnectionId)
        throw new WearableConnectError("already_connected");
      const sealed = sealTokens({ organizationId, providerConnectionId }, tokens);
      if (mine) {
        await tx
          .update(wearableConnection)
          .set({
            ...sealed,
            status: "active",
            tokenVersion: mine.tokenVersion + 1,
            syncRequestedAt: at,
            lastErrorCode: null,
            quarantinedAt: null,
            updatedAt: at,
          })
          .where(eq(wearableConnection.id, mine.id));
        // Reconnecting after a deauthorization keeps the held-back rows.
        await restoreQuarantined(tx, organizationId, providerConnectionId);
        return mine.id;
      }
      const [inserted] = await tx
        .insert(wearableConnection)
        .values({
          organizationId,
          userId,
          providerConnectionId,
          provider: input.provider,
          status: "active",
          ...sealed,
          tokenVersion: 1,
          syncRequestedAt: at,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: wearableConnection.id });
      return inserted!.id;
    });
    log?.info("wearables.connect.completed", {
      provider: input.provider,
      organizationId,
      connectionId,
    });
    return { organizationId, connectionId };
  }

  // ─── Read ───────────────────────────────────────────────────────

  async function listConnections(input: {
    organizationId: string;
    userId: string;
  }): Promise<WearableConnectionView[]> {
    const providers = configured();
    if (!providers.length) return [];
    const rows = await db
      .select()
      .from(wearableConnection)
      .where(
        and(
          eq(wearableConnection.organizationId, input.organizationId),
          eq(wearableConnection.userId, input.userId),
          inArray(wearableConnection.provider, providers),
        ),
      );
    const views: WearableConnectionView[] = [];
    for (const provider of providers) {
      const row = rows.find((candidate) => candidate.provider === provider);
      const quarantinedRecordCount =
        row?.status === "quarantined"
          ? await countQuarantined(input.organizationId, row.providerConnectionId)
          : 0;
      views.push({
        provider,
        ...WEARABLE_PROVIDER_INFO[provider],
        status: (row?.status as WearableConnectionStatus | undefined) ?? "not_connected",
        lastSyncedAt: row?.syncedThrough?.toISOString() ?? null,
        lastErrorCode: row?.lastErrorCode ?? null,
        quarantinedRecordCount,
      });
    }
    return views;
  }

  async function countQuarantined(organizationId: string, providerConnectionId: number) {
    const result = await db.execute(sql`
      select count(*)::int as count from provenance_link
      where organization_id = ${organizationId}
        and relation = ${WEARABLE_QUARANTINE_RELATION}
        and source_table = 'provider_connection' and source_id = ${providerConnectionId}`);
    return Number((result.rows[0] as { count: number } | undefined)?.count ?? 0);
  }

  // ─── Sync ───────────────────────────────────────────────────────

  async function resolveCloudDataSource(
    tx: Pick<Database, "insert" | "select">,
    row: ConnectionRow,
  ): Promise<number> {
    const sourceKey = `${CLOUD_IMPORT_CHANNEL}:${row.provider}:${row.providerConnectionId}`;
    const provider = row.provider as WearableProviderId;
    await tx
      .insert(dataSource)
      .values({
        organizationId: row.organizationId,
        providerConnectionId: row.providerConnectionId,
        sourceType: provider === "oura" ? "ring" : provider === "withings" ? "scale" : "watch",
        sourceKey,
        importChannel: CLOUD_IMPORT_CHANNEL,
        sourceAppId: provider,
        displayName: `${WEARABLE_PROVIDER_INFO[provider].displayName} (cloud)`,
      })
      .onConflictDoNothing({ target: [dataSource.organizationId, dataSource.sourceKey] });
    const [source] = await tx
      .select({ id: dataSource.id })
      .from(dataSource)
      .where(
        and(eq(dataSource.organizationId, row.organizationId), eq(dataSource.sourceKey, sourceKey)),
      )
      .limit(1);
    if (!source) throw new Error("Wearable data source was not resolvable.");
    return source.id;
  }

  /** Fetch with the stored token; on `auth`, force one refresh and retry once. */
  async function fetchWindow(row: ConnectionRow, window: SyncWindow) {
    const adapter = adapterFor(row.provider as WearableProviderId);
    const externalUserId = await externalUserIdOf(row);
    let { accessToken } = await freshAccessToken(row.id);
    try {
      return await adapter.fetchRecords({ accessToken, externalUserId, window });
    } catch (error) {
      if (!(error instanceof WearableProviderError && error.category === "auth")) throw error;
      if (!adapter.refreshes) {
        await markReconnectNeeded(row.id, "reauthorization_required");
        throw new WearableProviderError(adapter.id, "reauthorization_required", error.status);
      }
      ({ accessToken } = await freshAccessToken(row.id, { force: true }));
      return adapter.fetchRecords({ accessToken, externalUserId, window });
    }
  }

  async function externalUserIdOf(row: ConnectionRow): Promise<string> {
    const [pc] = await db
      .select({ externalUserId: providerConnection.externalUserId })
      .from(providerConnection)
      .where(
        and(
          eq(providerConnection.id, row.providerConnectionId),
          eq(providerConnection.organizationId, row.organizationId),
        ),
      )
      .limit(1);
    if (!pc) throw new WearableNotConnectedError();
    return pc.externalUserId;
  }

  /**
   * One sync: fetch the window, then in one transaction write an ingestion
   * job, batch and raw artifact, canonical rows with provenance, replace
   * revised records (latest fetch wins), apply phone-first dedupe and advance
   * the cursor. A failure records a value-free code and leaves the cursor.
   */
  async function syncConnection(connectionId: number): Promise<WearableSyncOutcome> {
    const [row] = await db
      .select()
      .from(wearableConnection)
      .where(eq(wearableConnection.id, connectionId))
      .limit(1);
    if (!row || row.status !== "active" || !adapters[row.provider as WearableProviderId])
      return { status: "skipped", connectionId };
    const to = now();
    const from = row.syncedThrough
      ? new Date(row.syncedThrough.getTime() - OVERLAP_MS)
      : new Date(to.getTime() - WEARABLE_BACKFILL_DAYS * 86_400_000);
    const window = { from, to };
    const provider = row.provider as WearableProviderId;

    let intents: CanonicalWriteIntent[];
    try {
      intents = await fetchWindow(row, window);
    } catch (error) {
      const summary = describeWearableError(error);
      const errorCode =
        error instanceof WearableNotConnectedError
          ? "not_connected"
          : summary.errorCategory === "unknown"
            ? "sync_failed"
            : summary.errorCategory;
      await db
        .update(wearableConnection)
        .set({ lastErrorCode: errorCode, updatedAt: now() })
        .where(eq(wearableConnection.id, row.id));
      log?.warn("wearables.sync.failed", { provider, connectionId: row.id, ...summary });
      return { status: "failed", connectionId: row.id, errorCode };
    }

    const outcome = await db.transaction(async (tx) => {
      const organizationId = row.organizationId;
      const startedAt = now();
      const [job] = await tx
        .insert(ingestionJob)
        .values({
          organizationId,
          providerConnectionId: row.providerConnectionId,
          jobType: WEARABLE_SYNC_JOB_TYPE,
          status: "running",
          triggeredBy: "wearable_cloud",
          idempotencyKey: `wearable-sync:${row.id}:${to.toISOString()}`,
          windowStart: from,
          windowEnd: to,
          startedAt,
          createdAt: startedAt,
          updatedAt: startedAt,
        })
        .returning({ id: ingestionJob.id });
      const [batch] = await tx
        .insert(ingestionBatch)
        .values({ organizationId, ingestionJobId: job!.id, status: "processing", startedAt })
        .returning({ id: ingestionBatch.id });
      const payload = {
        provider,
        window: { from: from.toISOString(), to: to.toISOString() },
        intents,
      };
      const serialized = stableSerialize(payload);
      const [artifact] = await tx
        .insert(ingestionRawArtifact)
        .values({
          organizationId,
          providerConnectionId: row.providerConnectionId,
          ingestionJobId: job!.id,
          ingestionBatchId: batch!.id,
          artifactType: WEARABLE_SYNC_ARTIFACT_TYPE,
          payloadJson: payload,
          payloadHash: createHash("sha256").update(serialized).digest("hex"),
          sizeBytes: Buffer.byteLength(serialized, "utf8"),
          capturedAt: startedAt,
          retentionUntil: new Date(startedAt.getTime() + RAW_RETENTION_DAYS * 86_400_000),
          retentionClass: WEARABLE_SYNC_ARTIFACT_TYPE,
        })
        .returning({ id: ingestionRawArtifact.id });

      const dataSourceId = await resolveCloudDataSource(tx, row);
      const persisted = await persistCanonicalIntents(tx, {
        organizationId,
        dataSourceId,
        ingestionBatchId: batch!.id,
        provider,
        intents,
        dedupe: "mobile",
      });
      await linkProvenance(tx, organizationId, persisted.inserted, artifact!.id);
      const superseded = await reconcileVersions(tx, {
        organizationId,
        providerConnectionId: row.providerConnectionId,
        provider,
        intents,
        now: startedAt,
      });
      const phoneFirst = await reconcilePhoneFirst(tx, {
        organizationId,
        from,
        to,
        now: startedAt,
      });

      const completedAt = now();
      const accepted = persisted.metricSampleCount + persisted.healthEventCount;
      await tx
        .update(ingestionBatch)
        .set({
          status: "completed",
          recordCount: intents.length,
          acceptedCount: accepted,
          rejectedCount: persisted.rejectedCount,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(ingestionBatch.id, batch!.id));
      await tx
        .update(ingestionJob)
        .set({ status: "succeeded", completedAt, updatedAt: completedAt })
        .where(eq(ingestionJob.id, job!.id));
      await tx
        .update(wearableConnection)
        .set({ syncedThrough: to, lastErrorCode: null, updatedAt: completedAt })
        .where(and(eq(wearableConnection.id, row.id), eq(wearableConnection.status, "active")));
      await tx
        .update(providerConnection)
        .set({ lastSyncedAt: completedAt, updatedAt: completedAt })
        .where(
          and(
            eq(providerConnection.id, row.providerConnectionId),
            eq(providerConnection.organizationId, organizationId),
          ),
        );
      return {
        status: "succeeded" as const,
        connectionId: row.id,
        accepted,
        duplicates: persisted.duplicateCount,
        rejected: persisted.rejectedCount,
        superseded,
        shadowed: phoneFirst.shadowed,
      };
    });
    log?.info("wearables.sync.completed", {
      provider,
      connectionId: row.id,
      accepted: outcome.accepted,
      duplicates: outcome.duplicates,
      rejected: outcome.rejected,
      superseded: outcome.superseded,
      shadowed: outcome.shadowed,
    });
    return outcome;
  }

  /**
   * Claims due connections one at a time (`FOR UPDATE SKIP LOCKED`, so two
   * runners never take the same one) and syncs them: those with a pending
   * webhook hint first, then any not attempted within the poll interval.
   * Polling is the fallback for instances without public webhook ingress.
   */
  async function runDueSyncs(
    input: { limit?: number; pollIntervalMs?: number } = {},
  ): Promise<{ claimed: number; succeeded: number; failed: number }> {
    const providers = configured();
    const totals = { claimed: 0, succeeded: 0, failed: 0 };
    if (!providers.length) return totals;
    const limit = input.limit ?? 25;
    const pollBefore = new Date(
      now().getTime() - (input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
    );
    const providerList = sql.join(
      providers.map((provider) => sql`${provider}`),
      sql`, `,
    );
    for (let index = 0; index < limit; index += 1) {
      const at = now();
      const claimed = await db.execute(sql`
        update wearable_connection w
        set sync_requested_at = null, last_sync_at = ${at}, updated_at = ${at}
        where w.id = (
          select id from wearable_connection
          where status = 'active' and provider in (${providerList})
            and (sync_requested_at is not null or last_sync_at is null or last_sync_at < ${pollBefore})
          order by sync_requested_at asc nulls last, last_sync_at asc nulls first, id
          limit 1
          for update skip locked)
        returning w.id`);
      const id = (claimed.rows[0] as { id: number } | undefined)?.id;
      if (id === undefined) break;
      totals.claimed += 1;
      const outcome = await syncConnection(Number(id));
      if (outcome.status === "succeeded") totals.succeeded += 1;
      else if (outcome.status === "failed") totals.failed += 1;
    }
    return totals;
  }

  async function requestSync(input: {
    organizationId: string;
    userId: string;
    provider: WearableProviderId;
  }) {
    const row = await findForUser(input.organizationId, input.userId, input.provider);
    if (!row || row.status !== "active") throw new WearableNotConnectedError();
    await db
      .update(wearableConnection)
      .set({ syncRequestedAt: now(), updatedAt: now() })
      .where(eq(wearableConnection.id, row.id));
  }

  // ─── Disconnect / quarantine ────────────────────────────────────

  /**
   * Revokes the grant upstream (best effort: a vendor outage must not keep
   * tokens around), deletes the tokens and ends the connection. With
   * `deleteData`, every row this connection brought in is deleted too;
   * otherwise the rows stay, attributed to the ended connection.
   */
  async function disconnect(input: {
    organizationId: string;
    userId: string;
    provider: WearableProviderId;
    deleteData: boolean;
  }): Promise<{ revoked: boolean; deletedRows: number }> {
    const row = await findForUser(input.organizationId, input.userId, input.provider);
    if (!row) throw new WearableNotConnectedError();
    let revoked = false;
    const adapter = adapters[input.provider];
    if (adapter && row.accessTokenCiphertext) {
      try {
        // Refresh first when possible: some vendors refuse to revoke with an
        // expired access token. Fall back to what is stored.
        let tokens: ReturnType<typeof openTokens>;
        try {
          tokens = openTokens((await freshAccessToken(row.id)).row);
        } catch {
          tokens = openTokens(row);
        }
        await adapter.revoke({ ...tokens, externalUserId: await externalUserIdOf(row) });
        revoked = true;
      } catch (error) {
        log?.warn("wearables.revoke.failed", {
          provider: input.provider,
          connectionId: row.id,
          ...describeWearableError(error),
        });
      }
    }
    const deletedRows = await db.transaction(async (tx) => {
      const at = now();
      await tx.delete(wearableConnection).where(eq(wearableConnection.id, row.id));
      await tx
        .update(providerConnection)
        .set({ status: "disconnected", disconnectedAt: at, updatedAt: at })
        .where(
          and(
            eq(providerConnection.id, row.providerConnectionId),
            eq(providerConnection.organizationId, row.organizationId),
          ),
        );
      return input.deleteData
        ? deleteConnectionData(tx, row.organizationId, row.providerConnectionId)
        : 0;
    });
    log?.info("wearables.disconnect.completed", {
      provider: input.provider,
      connectionId: row.id,
      revoked,
      deletedRows,
    });
    return { revoked, deletedRows };
  }

  /** After an upstream deauthorization: keep the held-back rows, or delete them. */
  async function resolveQuarantine(input: {
    organizationId: string;
    userId: string;
    provider: WearableProviderId;
    action: "keep" | "delete";
  }): Promise<{ affectedRows: number }> {
    const row = await findForUser(input.organizationId, input.userId, input.provider);
    if (!row || row.status !== "quarantined") throw new WearableNotConnectedError();
    const affectedRows = await db.transaction(async (tx) => {
      const at = now();
      const count =
        input.action === "keep"
          ? await restoreQuarantined(tx, row.organizationId, row.providerConnectionId)
          : await deleteConnectionData(tx, row.organizationId, row.providerConnectionId);
      await tx.delete(wearableConnection).where(eq(wearableConnection.id, row.id));
      await tx
        .update(providerConnection)
        .set({ status: "disconnected", disconnectedAt: at, updatedAt: at })
        .where(
          and(
            eq(providerConnection.id, row.providerConnectionId),
            eq(providerConnection.organizationId, row.organizationId),
          ),
        );
      return count;
    });
    log?.info("wearables.quarantine.resolved", {
      provider: input.provider,
      connectionId: row.id,
      action: input.action,
      affectedRows,
    });
    return { affectedRows };
  }

  /** Hide every active row of the connection and drop its tokens; rows wait for keep / delete. */
  async function quarantine(row: ConnectionRow): Promise<number> {
    return db.transaction(async (tx) => {
      const at = now();
      const [locked] = await tx
        .update(wearableConnection)
        .set({
          status: "quarantined",
          accessTokenCiphertext: null,
          refreshTokenCiphertext: null,
          accessTokenExpiresAt: null,
          quarantinedAt: at,
          syncRequestedAt: null,
          lastErrorCode: "deauthorized",
          updatedAt: at,
        })
        .where(
          and(
            eq(wearableConnection.id, row.id),
            inArray(wearableConnection.status, ["active", "reconnect_needed"]),
          ),
        )
        .returning({ id: wearableConnection.id });
      if (!locked) return 0;
      await tx
        .update(providerConnection)
        .set({ status: "revoked", updatedAt: at })
        .where(
          and(
            eq(providerConnection.id, row.providerConnectionId),
            eq(providerConnection.organizationId, row.organizationId),
          ),
        );
      let hidden = 0;
      for (const table of ["metric_sample", "health_event"] as const) {
        const touch = table === "health_event" ? sql`, updated_at = ${at}` : sql``;
        const result = await tx.execute(sql`
          update ${sql.identifier(table)} r set superseded_at = ${at} ${touch}
          from data_source d
          where d.id = r.data_source_id and d.organization_id = r.organization_id
            and r.organization_id = ${row.organizationId}
            and d.provider_connection_id = ${row.providerConnectionId}
            and r.superseded_at is null
          returning r.id`);
        const ids = (result.rows as { id: number }[]).map((item) => Number(item.id));
        if (!ids.length) continue;
        hidden += ids.length;
        await tx
          .insert(provenanceLink)
          .values(
            ids.map((id) => ({
              organizationId: row.organizationId,
              targetTable: table,
              targetId: id,
              sourceTable: "provider_connection",
              sourceId: row.providerConnectionId,
              relation: WEARABLE_QUARANTINE_RELATION,
            })),
          )
          .onConflictDoNothing();
      }
      return hidden;
    });
  }

  // ─── Webhooks ───────────────────────────────────────────────────

  /**
   * Verifies and applies one webhook delivery. Only database work happens
   * here (fast answer); the caller runs {@link runDueSyncs} afterwards. An
   * unsigned deauthorization (Withings) is believed only when the vendor
   * itself rejects the stored grant.
   */
  async function handleWebhook(
    provider: WearableProviderId,
    request: { headers: Headers; rawBody: string },
  ): Promise<{ status: 200 | 401 | 404; events: number }> {
    const adapter = adapters[provider];
    if (!adapter?.parseWebhook) return { status: 404, events: 0 };
    let events;
    try {
      events = adapter.parseWebhook({ ...request, now: now() });
    } catch (error) {
      log?.warn("wearables.webhook.rejected", {
        provider,
        reason: error instanceof WearableWebhookRejected ? error.reason : "malformed",
      });
      return { status: 401, events: 0 };
    }
    for (const event of events) {
      const rows = await db
        .select({ connection: wearableConnection })
        .from(wearableConnection)
        .innerJoin(
          providerConnection,
          and(
            eq(providerConnection.id, wearableConnection.providerConnectionId),
            eq(providerConnection.organizationId, wearableConnection.organizationId),
          ),
        )
        .where(
          and(
            eq(wearableConnection.provider, provider),
            eq(providerConnection.externalUserId, event.externalUserId),
          ),
        );
      for (const { connection } of rows) {
        if (event.kind === "data_changed" && connection.status === "active")
          await db
            .update(wearableConnection)
            .set({ syncRequestedAt: now(), updatedAt: now() })
            .where(eq(wearableConnection.id, connection.id));
        else if (event.kind === "record_deleted")
          await supersedeRecord(connection, event.externalRecordId);
        else if (event.kind === "deauthorized" && (await grantRejected(connection)))
          await quarantine(connection);
      }
    }
    log?.info("wearables.webhook.accepted", { provider, events: events.length });
    return { status: 200, events: events.length };
  }

  async function grantRejected(row: ConnectionRow): Promise<boolean> {
    const adapter = adapters[row.provider as WearableProviderId];
    if (!adapter || row.status === "quarantined") return false;
    try {
      const { accessToken } = await freshAccessToken(row.id);
      await adapter.identify({
        accessToken,
        refreshToken: null,
        expiresAt: null,
        scope: null,
        externalUserId: await externalUserIdOf(row),
      });
      return false;
    } catch (error) {
      return (
        error instanceof WearableProviderError &&
        (error.category === "reauthorization_required" || error.category === "auth")
      );
    }
  }

  async function supersedeRecord(row: ConnectionRow, externalRecordId: string) {
    const at = now();
    for (const [table, column] of [
      ["metric_sample", "external_sample_id"],
      ["health_event", "source_event_id"],
    ] as const) {
      const touch = table === "health_event" ? sql`, updated_at = ${at}` : sql``;
      await db.execute(sql`
        update ${sql.identifier(table)} r set superseded_at = ${at} ${touch}
        from data_source d
        where d.id = r.data_source_id and d.organization_id = r.organization_id
          and r.organization_id = ${row.organizationId}
          and d.provider_connection_id = ${row.providerConnectionId}
          and (r.${sql.identifier(column)} = ${externalRecordId}
            or r.${sql.identifier(column)} like ${`${externalRecordId}-%`})
          and r.superseded_at is null`);
    }
  }

  return {
    providers: configured,
    redirectUri,
    webhookUrl,
    startConnect,
    completeConnect,
    listConnections,
    requestSync,
    syncConnection,
    runDueSyncs,
    disconnect,
    resolveQuarantine,
    handleWebhook,
    /** Exposed for tests of the locked refresh. */
    freshAccessToken,
  };
}

// ─── Shared SQL helpers ──────────────────────────────────────────

type Tx = Pick<Database, "execute" | "insert" | "select">;

async function linkProvenance(
  tx: Tx,
  organizationId: string,
  inserted: CanonicalRowRef[],
  rawArtifactId: number,
) {
  if (!inserted.length) return;
  await tx
    .insert(provenanceLink)
    .values(
      inserted.map((ref) => ({
        organizationId,
        targetTable: ref.table,
        targetId: ref.id,
        sourceTable: "ingestion_raw_artifact",
        sourceId: rawArtifactId,
        relation: "derived_from_raw_artifact",
      })),
    )
    .onConflictDoNothing();
}

/**
 * Latest fetch wins: for each re-fetched record, the row stored under the
 * record's current content is active and every other version of it (same
 * connection, same external id) is superseded. A record that reverts to an
 * earlier version brings that row back. Returns how many rows changed state.
 */
async function reconcileVersions(
  tx: Tx,
  input: {
    organizationId: string;
    providerConnectionId: number;
    provider: WearableProviderId;
    intents: CanonicalWriteIntent[];
    now: Date;
  },
): Promise<number> {
  let changed = 0;
  for (const [table, column, kind] of [
    ["metric_sample", "external_sample_id", "metric_sample"],
    ["health_event", "source_event_id", "health_event"],
  ] as const) {
    const pairs: { externalId: string; hash: string }[] = [];
    for (const intent of input.intents) {
      if (intent.kind !== kind) continue;
      const externalId = intent.kind === "metric_sample" ? intent.externalId : intent.sourceEventId;
      const hash = mobileIntentDedupeHash(input.provider, intent);
      if (externalId && hash) pairs.push({ externalId, hash });
    }
    if (!pairs.length) continue;
    const values = sql.join(
      pairs.map((pair) => sql`(${pair.externalId}, ${pair.hash})`),
      sql`, `,
    );
    const touch = table === "health_event" ? sql`, updated_at = ${input.now}` : sql``;
    const result = await tx.execute(sql`
      update ${sql.identifier(table)} r
      set superseded_at = case when r.dedupe_hash = v.hash then null else ${input.now}::timestamptz end ${touch}
      from data_source d, (values ${values}) as v(external_id, hash)
      where d.id = r.data_source_id and d.organization_id = r.organization_id
        and r.organization_id = ${input.organizationId}
        and d.provider_connection_id = ${input.providerConnectionId}
        and r.${sql.identifier(column)} = v.external_id
        and ((r.superseded_at is null and r.dedupe_hash <> v.hash)
          or (r.superseded_at is not null and r.dedupe_hash = v.hash))
      returning r.id`);
    const ids = (result.rows as { id: number }[]).map((row) => Number(row.id));
    if (!ids.length) continue;
    changed += ids.length;
    // Version changes reset any phone-first shadow; phone-first runs next.
    await tx.execute(sql`
      delete from provenance_link
      where organization_id = ${input.organizationId} and target_table = ${table}
        and relation = ${PHONE_FIRST_RELATION}
        and target_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`);
  }
  return changed;
}

/** Bring back rows hidden by a deauthorization quarantine. Returns how many. */
async function restoreQuarantined(
  tx: Tx,
  organizationId: string,
  providerConnectionId: number,
): Promise<number> {
  let restored = 0;
  const times: number[] = [];
  for (const [table, column] of [
    ["metric_sample", "sampled_at"],
    ["health_event", "event_at"],
  ] as const) {
    const result = await tx.execute(sql`
      update ${sql.identifier(table)} r set superseded_at = null
      from provenance_link l
      where l.organization_id = r.organization_id and l.target_table = ${table}
        and l.target_id = r.id and l.relation = ${WEARABLE_QUARANTINE_RELATION}
        and l.source_table = 'provider_connection' and l.source_id = ${providerConnectionId}
        and r.organization_id = ${organizationId}
      returning r.${sql.identifier(column)} as at`);
    for (const item of result.rows as { at: string | Date }[]) {
      restored += 1;
      times.push(new Date(item.at).getTime());
    }
  }
  await tx.execute(sql`
    delete from provenance_link
    where organization_id = ${organizationId} and relation = ${WEARABLE_QUARANTINE_RELATION}
      and source_table = 'provider_connection' and source_id = ${providerConnectionId}`);
  if (times.length)
    await reconcilePhoneFirst(tx, {
      organizationId,
      from: new Date(Math.min(...times)),
      to: new Date(Math.max(...times)),
      now: new Date(),
    });
  return restored;
}

/**
 * Delete everything one connection brought in: canonical rows and their
 * provenance, raw artifacts, ingestion jobs/batches/errors and its data
 * sources. The `provider_connection` row stays as the disconnected record.
 */
async function deleteConnectionData(
  tx: Pick<Database, "execute">,
  organizationId: string,
  providerConnectionId: number,
): Promise<number> {
  const org = organizationId;
  const pc = providerConnectionId;
  const rowsOf = (table: "metric_sample" | "health_event") => sql`
    select r.id from ${sql.identifier(table)} r
    join data_source d on d.id = r.data_source_id and d.organization_id = r.organization_id
    where r.organization_id = ${org} and d.provider_connection_id = ${pc}`;
  await tx.execute(sql`
    delete from provenance_link
    where organization_id = ${org}
      and ((target_table = 'metric_sample' and target_id in (${rowsOf("metric_sample")}))
        or (target_table = 'health_event' and target_id in (${rowsOf("health_event")}))
        or (source_table = 'provider_connection' and source_id = ${pc}))`);
  await tx.execute(sql`
    delete from ingestion_error
    where organization_id = ${org}
      and (metric_sample_id in (${rowsOf("metric_sample")})
        or ingestion_job_id in (select id from ingestion_job where organization_id = ${org} and provider_connection_id = ${pc}))`);
  let deleted = 0;
  for (const table of ["metric_sample", "health_event"] as const) {
    const result = await tx.execute(sql`
      delete from ${sql.identifier(table)} r using data_source d
      where d.id = r.data_source_id and d.organization_id = r.organization_id
        and r.organization_id = ${org} and d.provider_connection_id = ${pc}
      returning r.id`);
    deleted += result.rows.length;
  }
  await tx.execute(sql`
    delete from ingestion_raw_artifact
    where organization_id = ${org} and provider_connection_id = ${pc}`);
  await tx.execute(sql`
    delete from ingestion_job
    where organization_id = ${org} and provider_connection_id = ${pc}`);
  await tx.execute(sql`
    delete from data_source where organization_id = ${org} and provider_connection_id = ${pc}`);
  return deleted;
}
