import { randomUUID } from "node:crypto";
import type { AnalyticsService, ApprovedAnalyticsEvent } from "@openvalens/api/contracts/analytics";
import type { Database } from "@openvalens/db";
import { analyticsConsent } from "@openvalens/db/schema";
import { eq } from "drizzle-orm";

const POSTHOG_CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";
const CAPTURE_TIMEOUT_MS = 3_000;
const MAX_ACK_BYTES = 128;

const EVENT_NAMES: Record<ApprovedAnalyticsEvent, string> = {
  preferences_opened: "preferences_opened",
  appearance_control_used: "appearance_control_used",
  preferences_load_failed: "preferences_load_failed",
};

export type AnalyticsConfig = {
  enabled: boolean;
  projectToken?: string;
  ipCaptureDisabled: boolean;
};

export class AnalyticsUnavailableError extends Error {
  constructor() {
    super("Analytics is unavailable.");
    this.name = "AnalyticsUnavailableError";
  }
}

export function createAnalyticsService(
  db: Database,
  config: AnalyticsConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): AnalyticsService {
  const projectToken = config.projectToken?.trim();
  const available = Boolean(
    config.enabled && projectToken && config.ipCaptureDisabled,
  );

  async function readPreference(userId: string) {
    const [row] = await db
      .select({ enabled: analyticsConsent.enabled })
      .from(analyticsConsent)
      .where(eq(analyticsConsent.userId, userId))
      .limit(1);
    return { enabled: row?.enabled ?? false, available };
  }

  return {
    getPreference: readPreference,

    async setPreference(userId, enabled) {
      if (enabled && !available) throw new AnalyticsUnavailableError();
      await db
        .insert(analyticsConsent)
        .values({ userId, enabled, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: analyticsConsent.userId,
          set: { enabled, updatedAt: new Date() },
        });
      return await readPreference(userId);
    },

    async capture(userId, event) {
      if (!available || !Object.hasOwn(EVENT_NAMES, event)) return false;

      try {
        return await db.transaction(async (tx) => {
          const [consent] = await tx
            .select({ enabled: analyticsConsent.enabled })
            .from(analyticsConsent)
            .where(eq(analyticsConsent.userId, userId))
            .for("share")
            .limit(1);

          if (!consent?.enabled) return false;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
          try {
            const response = await fetchImpl(POSTHOG_CAPTURE_URL, {
              method: "POST",
              redirect: "error",
              signal: controller.signal,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                api_key: projectToken,
                event: EVENT_NAMES[event],
                distinct_id: randomUUID(),
                properties: { $process_person_profile: false },
              }),
            });
            if (response.status !== 200 || !response.body) {
              await response.body?.cancel().catch(() => undefined);
              return false;
            }

            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            let finished = false;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  finished = true;
                  break;
                }
                size += value.byteLength;
                if (size > MAX_ACK_BYTES) return false;
                chunks.push(value);
              }
              const bytes = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
              }
              try {
                return (JSON.parse(new TextDecoder().decode(bytes)) as { status?: unknown }).status === "ok";
              } catch {
                return false;
              }
            } finally {
              if (!finished) await reader.cancel().catch(() => undefined);
              reader.releaseLock();
            }
          } finally {
            clearTimeout(timeout);
            controller.abort();
          }
        });
      } catch {
        return false;
      }
    },
  };
}
