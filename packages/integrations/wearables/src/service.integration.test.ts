import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readdir } from "node:fs/promises";

import { createDb, sql } from "@openvalens/db";
import { member, organization, user } from "@openvalens/db/schema/auth";
import { healthEvent, metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { providerConnection } from "@openvalens/db/schema/ingestion";
import { wearableConnection } from "@openvalens/db/schema/wearables";
import {
  ingestMobileBatch,
  registerMobileDevice,
  type MobileHealthRecord,
} from "@openvalens/ingestion";
import { createStructuredLogger } from "@openvalens/observability";
import { and, eq, isNull } from "drizzle-orm";

import type { WearableProviderId } from "./adapter";
import { createWearablesService, WearableConnectError, WearableNotConnectedError } from "./service";
import {
  mockAdapters,
  seedVendorData,
  startMockVendor,
  TEST_CLIENT,
  type MockVendor,
} from "./testing";
import { deriveWearableTokenKey } from "./token-crypto";

/**
 * Cloud wearable connections (Issue #60) against a disposable Postgres and a
 * local mock of the five vendor APIs: connect, first and incremental sync,
 * disconnect with upstream revoke and data deletion, phone-first dedupe,
 * deauthorization quarantine, the Google Testing-mode reconnect, the locked
 * Oura refresh, webhooks and tenant isolation. Synthetic data only.
 */
const url = process.env.WEARABLES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/wearables_issue60"
  )
    throw new Error("Empty disposable loopback wearables_issue60 database required.");
}

const PROVIDERS: WearableProviderId[] = ["oura", "whoop", "polar", "withings", "google_health"];
const VENDOR_USER: Record<WearableProviderId, string> = {
  oura: "oura-user-1",
  whoop: "4242",
  polar: "7001",
  withings: "31337",
  google_health: "g-health-1",
};
const DEVICE = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";

describe.skipIf(!url)("cloud wearables on disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/wearables_issue60" });
  let vendor: MockVendor;
  const logLines: string[] = [];
  const fetchedUrls: string[] = [];
  const tokenKey = deriveWearableTokenKey("synthetic-better-auth-secret-0123456789abcdef");
  let service: ReturnType<typeof createWearablesService>;
  let serviceDeps: Parameters<typeof createWearablesService>[0];

  const connect = async (
    provider: WearableProviderId,
    who: { organizationId: string; userId: string } = { organizationId: "org-a", userId: "u1" },
    vendorUser = VENDOR_USER[provider],
  ) => {
    const { authorizationUrl } = await service.startConnect({ ...who, provider });
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    return service.completeConnect({
      provider,
      state,
      code: vendor.issueCode(provider, vendorUser),
      sessionUserId: who.userId,
    });
  };

  function active(
    table: "metric_sample",
    organizationId?: string,
  ): Promise<{ id: number; ext: string | null; code: string; value: number | null }[]>;
  function active(
    table: "health_event",
    organizationId?: string,
  ): Promise<{ id: number; ext: string | null }[]>;
  async function active(table: "metric_sample" | "health_event", organizationId = "org-a") {
    if (table === "health_event")
      return db
        .select({ id: healthEvent.id, ext: healthEvent.sourceEventId })
        .from(healthEvent)
        .where(
          and(eq(healthEvent.organizationId, organizationId), isNull(healthEvent.supersededAt)),
        );
    return db
      .select({
        id: metricSample.id,
        ext: metricSample.externalSampleId,
        code: metricDefinition.code,
        value: metricSample.numericValue,
      })
      .from(metricSample)
      .innerJoin(metricDefinition, eq(metricDefinition.id, metricSample.metricDefinitionId))
      .where(
        and(eq(metricSample.organizationId, organizationId), isNull(metricSample.supersededAt)),
      );
  }

  const connectionOf = async (provider: WearableProviderId, organizationId = "org-a") => {
    const [row] = await db
      .select()
      .from(wearableConnection)
      .where(
        and(
          eq(wearableConnection.provider, provider),
          eq(wearableConnection.organizationId, organizationId),
        ),
      );
    return row;
  };

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    const root = new URL("../../../db/src/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).sort()) {
      if (!/^\d/.test(directory)) continue;
      const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
      for (const statement of text.split("--> statement-breakpoint"))
        if (statement.trim()) await db.execute(sql.raw(statement));
    }
    await db.insert(organization).values([
      { id: "org-a", name: "A", slug: "a" },
      { id: "org-b", name: "B", slug: "b" },
    ]);
    await db.insert(user).values([
      { id: "u1", name: "U1", email: "u1@example.invalid" },
      { id: "u2", name: "U2", email: "u2@example.invalid" },
    ]);
    await db.insert(member).values([
      { id: "m1", organizationId: "org-a", userId: "u1", role: "owner" },
      { id: "m2", organizationId: "org-b", userId: "u2", role: "owner" },
    ]);
    vendor = await startMockVendor();
  }, 120_000);

  beforeEach(async () => {
    for (const table of [
      "provenance_link",
      "weight_event",
      "daily_weight",
      "metric_sample",
      "health_event",
      "ingestion_raw_artifact",
      "ingestion_error",
      "ingestion_batch",
      "ingestion_job",
      "data_source",
      "wearable_connection",
      "wearable_oauth_state",
      "provider_connection",
    ])
      await db.execute(sql.raw(`delete from "${table}"`));
    vendor.state.data = {
      oura: { daily_readiness: [], sleep: [], daily_activity: [] },
      whoop: { recovery: [], sleep: [] },
      polar: { recharges: [], nights: [] },
      withings: { measuregrps: [], series: [] },
      google_health: {},
    };
    seedVendorData(vendor.state);
    vendor.state.refuseRefresh = {};
    vendor.state.expiresIn = {};
    vendor.state.refreshDelayMs = 0;
    vendor.state.refreshCalls = {};
    vendor.state.revoked = [];
    vendor.state.polarRegistered.clear();
    logLines.length = 0;
    fetchedUrls.length = 0;
    serviceDeps = {
      db,
      adapters: mockAdapters(vendor, {
        fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          fetchedUrls.push(String(input));
          return fetch(input, init);
        }) as typeof fetch,
      }),
      tokenKey,
      serverOrigin: "https://health.example.invalid",
      webhooks: false,
      logger: createStructuredLogger({
        level: "debug",
        sink: (_level, line) => logLines.push(line),
      }),
    };
    service = createWearablesService(serviceDeps);
  });

  afterAll(async () => {
    await vendor?.stop();
    await db.$client.end();
  });

  test.each(PROVIDERS)(
    "%s: connect, first sync, incremental sync with a revised record, disconnect with revoke and delete",
    async (provider) => {
      const { connectionId } = await connect(provider);
      const row = await connectionOf(provider);
      expect(row).toMatchObject({ status: "active", userId: "u1", tokenVersion: 1 });
      expect(row!.syncRequestedAt).not.toBeNull();
      // Tokens are ciphertext at rest.
      const raw = JSON.stringify(row);
      expect(raw).not.toContain(`${provider}-at-`);
      expect(raw).not.toContain(`${provider}-rt-`);

      const first = await service.runDueSyncs();
      expect(first).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
      const metrics = await active("metric_sample");
      const events = await active("health_event");
      expect(metrics.length + events.length).toBeGreaterThan(0);
      expect((await connectionOf(provider))!.syncedThrough).not.toBeNull();

      // Incremental: nothing due within the poll interval; a requested sync
      // re-reads, changes nothing for identical data.
      expect((await service.runDueSyncs()).claimed).toBe(0);
      const again = await service.syncConnection(connectionId);
      expect(again).toMatchObject({ status: "succeeded", accepted: 0, superseded: 0 });

      // The vendor revises one record: the old version is superseded.
      const revise: Record<WearableProviderId, () => void> = {
        oura: () => (vendor.state.data.oura.daily_readiness[1]!.score = 79),
        whoop: () => {
          const score = vendor.state.data.whoop.recovery[0]!.score as Record<string, number>;
          score.recovery_score = 70;
        },
        polar: () => (vendor.state.data.polar.recharges[0]!.nightly_recharge_status = 5),
        withings: () => {
          const group = vendor.state.data.withings.measuregrps[0]!;
          (group.measures as Record<string, number>[])[0]!.value = 72_300;
        },
        google_health: () => {
          const steps = vendor.state.data.google_health.steps!;
          steps.push({
            name: "users/me/dataTypes/steps/dataPoints/s4",
            steps: {
              interval: { startTime: "2026-10-02T18:00:00Z", endTime: "2026-10-02T18:01:00Z" },
              count: "300",
            },
          });
        },
      };
      revise[provider]();
      // The next incremental sync runs soon after the synthetic data days
      // (the window re-reads two days before the cursor).
      await db
        .update(wearableConnection)
        .set({ syncedThrough: new Date("2026-10-03T12:00:00.000Z") })
        .where(eq(wearableConnection.id, connectionId));
      const incremental = await service.syncConnection(connectionId);
      expect(incremental).toMatchObject({ status: "succeeded", accepted: 1, superseded: 1 });
      const afterRevision = await active("metric_sample");
      expect(afterRevision).toHaveLength(metrics.length);

      // Disconnect: upstream revoke, tokens gone, rows deleted on request.
      const result = await service.disconnect({
        organizationId: "org-a",
        userId: "u1",
        provider,
        deleteData: true,
      });
      expect(result.revoked).toBe(true);
      expect(result.deletedRows).toBeGreaterThan(0);
      expect(vendor.state.revoked.map((r) => r.provider)).toContain(provider);
      expect(await connectionOf(provider)).toBeUndefined();
      expect(await db.select().from(metricSample)).toHaveLength(0);
      expect(await db.select().from(healthEvent)).toHaveLength(0);
      const [pc] = await db.select().from(providerConnection);
      expect(pc).toMatchObject({ status: "disconnected" });
      const views = await service.listConnections({ organizationId: "org-a", userId: "u1" });
      expect(views.find((view) => view.provider === provider)?.status).toBe("not_connected");

      // Logs never carry tokens or health values.
      const logs = logLines.join("\n");
      expect(logs).not.toMatch(new RegExp(`${provider}-(at|rt)-`));
      expect(logs).not.toContain(TEST_CLIENT.clientSecret);
      expect(logs).not.toMatch(/"value"|8400|72\.45|61\.5/);
    },
  );

  test("#298: a workspace whose Cloud access ended is not synced, and resumes from its cursor", async () => {
    const asked: unknown[] = [];
    let allowed = false;
    const gated = createWearablesService({
      ...serviceDeps,
      canSync: async (connection) => {
        asked.push(connection);
        return allowed;
      },
    });
    const { connectionId } = await connect("oura");
    expect(await gated.syncConnection(connectionId)).toMatchObject({ status: "skipped" });
    expect(asked).toEqual([{ organizationId: "org-a", userId: "u1" }]);
    expect(await active("metric_sample")).toHaveLength(0);
    expect((await connectionOf("oura"))!.syncedThrough).toBeNull();

    allowed = true;
    expect(await gated.syncConnection(connectionId)).toMatchObject({ status: "succeeded" });
    expect((await active("metric_sample")).length).toBeGreaterThan(0);
  });

  test("disconnect without deleteData keeps the rows, attributed to the ended connection", async () => {
    const { connectionId } = await connect("oura");
    await service.syncConnection(connectionId);
    const before = (await active("metric_sample")).length;
    await service.disconnect({
      organizationId: "org-a",
      userId: "u1",
      provider: "oura",
      deleteData: false,
    });
    expect(await active("metric_sample")).toHaveLength(before);
  });

  test("OAuth state is single use, bound to the starting person, and provider-specific", async () => {
    const { authorizationUrl } = await service.startConnect({
      organizationId: "org-a",
      userId: "u1",
      provider: "oura",
    });
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    const code = vendor.issueCode("oura", "oura-user-1");
    await expect(
      service.completeConnect({ provider: "whoop", state, code, sessionUserId: "u1" }),
    ).rejects.toMatchObject({ code: "state_invalid" });
    await expect(
      service.completeConnect({ provider: "oura", state, code, sessionUserId: "u2" }),
    ).rejects.toMatchObject({ code: "session_mismatch" });
    // The mismatched attempt consumed the state.
    await expect(
      service.completeConnect({ provider: "oura", state, code, sessionUserId: "u1" }),
    ).rejects.toBeInstanceOf(WearableConnectError);
    expect(await connectionOf("oura")).toBeUndefined();
    await expect(
      service.startConnect({ organizationId: "org-a", userId: "u1", provider: "garmin" as never }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  test("tenant isolation: another workspace sees nothing and cannot disconnect or sync", async () => {
    await connect("oura");
    await service.runDueSyncs();
    const other = await service.listConnections({ organizationId: "org-b", userId: "u2" });
    expect(other.every((view) => view.status === "not_connected")).toBe(true);
    await expect(
      service.disconnect({
        organizationId: "org-b",
        userId: "u2",
        provider: "oura",
        deleteData: true,
      }),
    ).rejects.toBeInstanceOf(WearableNotConnectedError);
    await expect(
      service.requestSync({ organizationId: "org-b", userId: "u2", provider: "oura" }),
    ).rejects.toBeInstanceOf(WearableNotConnectedError);
    // Same user id in a workspace they are not in: still nothing.
    await expect(
      service.disconnect({
        organizationId: "org-b",
        userId: "u1",
        provider: "oura",
        deleteData: true,
      }),
    ).rejects.toBeInstanceOf(WearableNotConnectedError);
    expect((await active("metric_sample", "org-b")).length).toBe(0);
    expect((await active("metric_sample")).length).toBeGreaterThan(0);
  });

  test("phone-first: a day with phone and cloud data for the same metric counts once, both directions", async () => {
    const { providerConnectionId } = await registerMobileDevice(db, {
      organizationId: "org-a",
      userId: "u1",
      deviceId: DEVICE,
      platform: "ios",
    });
    expect(providerConnectionId).toBeGreaterThan(0);
    const phoneWeight: MobileHealthRecord = {
      type: "weight",
      externalRecordId: "hk-weight-1",
      startTime: "2026-10-02T06:00:30.000Z",
      valueKg: 72.4,
      sourceApp: "com.withings.wiscale2",
      sourceDevice: { type: "scale", model: "Body+" },
    };
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      traceId: "t",
      batch: {
        schemaVersion: 1,
        deviceId: DEVICE,
        provider: "apple_health",
        recordType: "weight",
        mode: "changes",
        clientTimezone: "UTC",
        upserts: [phoneWeight],
        deletions: [],
      },
    });

    const { connectionId } = await connect("withings");
    const sync = await service.syncConnection(connectionId);
    expect(sync).toMatchObject({ status: "succeeded", shadowed: 1 });
    const weights = (await active("metric_sample")).filter((row) => row.code === "weight");
    expect(weights.map((row) => row.ext)).toEqual(["hk-weight-1"]);
    // Cloud-only body fat (no phone body fat that day) stays visible.
    expect((await active("metric_sample")).some((row) => row.code === "body_fat")).toBe(true);
    // Sleep: the Withings session has no phone session, so it stays.
    expect((await active("health_event")).map((row) => row.ext)).toEqual(["withings-sleep-5501"]);

    // The phone weight is deleted on the device: the cloud weight comes back.
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      traceId: "t2",
      batch: {
        schemaVersion: 1,
        deviceId: DEVICE,
        provider: "apple_health",
        recordType: "weight",
        mode: "changes",
        clientTimezone: "UTC",
        upserts: [],
        deletions: [{ externalRecordId: "hk-weight-1" }],
      },
    });
    const restored = (await active("metric_sample")).filter((row) => row.code === "weight");
    expect(restored.map((row) => row.ext)).toEqual(["withings-measure-9001-weight"]);

    // And a phone sleep session arriving later hides the overlapping cloud one.
    await ingestMobileBatch(db, {
      organizationId: "org-a",
      traceId: "t3",
      batch: {
        schemaVersion: 1,
        deviceId: DEVICE,
        provider: "apple_health",
        recordType: "sleep_session",
        mode: "changes",
        clientTimezone: "UTC",
        upserts: [
          {
            type: "sleep_session",
            externalRecordId: "hk-sleep-1",
            startTime: "2026-10-01T22:35:00.000Z",
            endTime: "2026-10-02T06:10:00.000Z",
            sourceApp: "com.withings.wiscale2",
          },
        ],
        deletions: [],
      },
    });
    expect((await active("health_event")).map((row) => row.ext)).toEqual(["hk-sleep-1"]);
  });

  test("an unlink notification quarantines only after Withings rejects the grant; keep restores", async () => {
    const { connectionId } = await connect("withings");
    await service.syncConnection(connectionId);
    const visible = (await active("metric_sample")).length + (await active("health_event")).length;
    const unlink = { headers: new Headers(), rawBody: "userid=31337&appli=46&action=unlink" };

    // Forged: the grant still works, so nothing happens.
    expect(await service.handleWebhook("withings", unlink)).toMatchObject({
      status: 200,
      events: 1,
    });
    expect((await connectionOf("withings"))!.status).toBe("active");

    // Real: the person removed access at Withings.
    for (const [token, grant] of vendor.state.accessTokens)
      if (grant.provider === "withings") vendor.state.accessTokens.delete(token);
    vendor.state.refuseRefresh.withings = true;
    await service.handleWebhook("withings", unlink);
    const row = await connectionOf("withings");
    expect(row).toMatchObject({ status: "quarantined", accessTokenCiphertext: null });
    expect((await active("metric_sample")).length + (await active("health_event")).length).toBe(0);
    const [view] = (
      await service.listConnections({ organizationId: "org-a", userId: "u1" })
    ).filter((item) => item.provider === "withings");
    expect(view).toMatchObject({ status: "quarantined", quarantinedRecordCount: visible });

    const kept = await service.resolveQuarantine({
      organizationId: "org-a",
      userId: "u1",
      provider: "withings",
      action: "keep",
    });
    expect(kept.affectedRows).toBe(visible);
    expect((await active("metric_sample")).length + (await active("health_event")).length).toBe(
      visible,
    );
    expect(await connectionOf("withings")).toBeUndefined();
  });

  test("a quarantined connection's rows can be deleted instead", async () => {
    const { connectionId } = await connect("withings");
    await service.syncConnection(connectionId);
    for (const [token, grant] of vendor.state.accessTokens)
      if (grant.provider === "withings") vendor.state.accessTokens.delete(token);
    vendor.state.refuseRefresh.withings = true;
    await service.handleWebhook("withings", {
      headers: new Headers(),
      rawBody: "userid=31337&appli=46",
    });
    await service.resolveQuarantine({
      organizationId: "org-a",
      userId: "u1",
      provider: "withings",
      action: "delete",
    });
    expect(await db.select().from(metricSample)).toHaveLength(0);
    expect(await db.select().from(healthEvent)).toHaveLength(0);
  });

  test("an expired Google Testing-mode refresh token marks reconnect needed; reconnecting backfills the gap", async () => {
    vendor.state.expiresIn.google_health = 30; // always inside the refresh skew
    const { connectionId } = await connect("google_health");
    expect(await service.syncConnection(connectionId)).toMatchObject({ status: "succeeded" });
    const cursor = new Date("2026-10-03T12:00:00.000Z");
    await db
      .update(wearableConnection)
      .set({ syncedThrough: cursor })
      .where(eq(wearableConnection.id, connectionId));

    vendor.state.refuseRefresh.google_health = true;
    expect(await service.syncConnection(connectionId)).toMatchObject({
      status: "failed",
      errorCode: "reauthorization_required",
    });
    const [view] = (
      await service.listConnections({ organizationId: "org-a", userId: "u1" })
    ).filter((item) => item.provider === "google_health");
    expect(view).toMatchObject({
      status: "reconnect_needed",
      lastErrorCode: "reauthorization_required",
    });
    // Data stays visible while waiting for the reconnect.
    expect((await active("metric_sample")).length).toBeGreaterThan(0);
    // Not claimed by the poller while it needs a reconnect.
    expect((await service.runDueSyncs({ pollIntervalMs: 0 })).claimed).toBe(0);

    vendor.state.refuseRefresh.google_health = false;
    vendor.state.expiresIn.google_health = 3600;
    await connect("google_health");
    expect((await connectionOf("google_health"))!.status).toBe("active");
    fetchedUrls.length = 0;
    await service.runDueSyncs();
    const stepsQuery = fetchedUrls.find((item) => item.includes("/steps/dataPoints"));
    const filter = new URL(stepsQuery!).searchParams.get("filter")!;
    // Starts from the old cursor (minus the re-read overlap), not from "now".
    expect(filter).toContain(`>= "${new Date(cursor.getTime() - 2 * 86_400_000).toISOString()}"`);
  });

  test("concurrent refreshes of a single-use Oura token never lose the rotated token", async () => {
    vendor.state.expiresIn.oura = 30; // inside the 60 s refresh skew: every read refreshes
    const { connectionId } = await connect("oura");
    vendor.state.expiresIn.oura = 3600;
    vendor.state.refreshDelayMs = 150;
    const [a, b, c] = await Promise.all([
      service.freshAccessToken(connectionId),
      service.freshAccessToken(connectionId),
      service.freshAccessToken(connectionId),
    ]);
    expect(vendor.state.refreshCalls.oura).toBe(1);
    expect(a.accessToken).toBe(b.accessToken);
    expect(b.accessToken).toBe(c.accessToken);
    const row = await connectionOf("oura");
    expect(row).toMatchObject({ status: "active", tokenVersion: 2 });
    // The stored (rotated) token works for a sync.
    expect(await service.syncConnection(connectionId)).toMatchObject({ status: "succeeded" });
  });

  test("signed Whoop webhooks schedule a sync or hide a deleted record; unsigned ones are refused", async () => {
    const { connectionId } = await connect("whoop");
    await service.runDueSyncs();
    const deliver = (body: object, secret = TEST_CLIENT.clientSecret) => {
      const rawBody = JSON.stringify(body);
      const timestamp = String(Date.now());
      const headers = new Headers({
        "x-whoop-signature": createHmac("sha256", secret)
          .update(timestamp + rawBody)
          .digest("base64"),
        "x-whoop-signature-timestamp": timestamp,
      });
      return service.handleWebhook("whoop", { headers, rawBody });
    };
    expect(await deliver({ user_id: 4242, id: "wsl-1", type: "sleep.updated" }, "wrong")).toEqual({
      status: 401,
      events: 0,
    });
    expect(await deliver({ user_id: 4242, id: "wsl-1", type: "sleep.updated" })).toEqual({
      status: 200,
      events: 1,
    });
    expect((await connectionOf("whoop"))!.syncRequestedAt).not.toBeNull();
    expect(await service.runDueSyncs()).toMatchObject({ claimed: 1, succeeded: 1 });

    await deliver({ user_id: 4242, id: "wsl-1", type: "recovery.deleted" });
    const left = (await active("metric_sample")).map((row) => row.ext);
    expect(left.some((ext) => ext?.startsWith("whoop-recovery-wsl-1"))).toBe(false);
    // A webhook for an unknown vendor user touches nothing.
    expect(await deliver({ user_id: 9999, id: "wsl-1", type: "sleep.deleted" })).toMatchObject({
      status: 200,
    });
    expect((await active("health_event")).map((row) => row.ext)).toEqual(["whoop-sleep-wsl-1"]);
    expect(connectionId).toBeGreaterThan(0);
  });

  test("one vendor account cannot be linked by two people in one workspace", async () => {
    await db
      .insert(member)
      .values({ id: "m3", organizationId: "org-a", userId: "u2", role: "viewer" });
    try {
      await connect("oura");
      await expect(
        connect("oura", { organizationId: "org-a", userId: "u2" }),
      ).rejects.toMatchObject({ code: "account_in_use" });
    } finally {
      await db.delete(member).where(eq(member.id, "m3"));
    }
  });
});
