import {
  directDeviceRefusalReason,
  ingestDirectDeviceBatchOutput,
  type IngestDirectDeviceBatchInput,
  type IngestDirectDeviceBatchOutput,
} from "@openvalens/api/contracts/direct-device";

import { isAuthorityTicketCurrent, type AuthorityTicket } from "./authority";
import { directDeviceRepositoryIdentity, type DirectDeviceErrorCode, type DirectDeviceStore } from "./persistence/store";

export type DirectUploadSummary = Readonly<{
  sent: number;
  blocked: number;
  stopped: "already_draining" | "stale_authority" | "retryable_error" | null;
}>;

const inFlight = new WeakSet<object>();

export function classifyDirectDeviceUploadError(error: unknown): {
  state: "pending" | "blocked";
  code: DirectDeviceErrorCode;
} {
  const shaped = error && typeof error === "object" ? error as { code?: unknown; data?: unknown } : {};
  const raw = String(shaped.code ?? "");
  if (raw.toUpperCase() === "PERMISSION_DENIED" && shaped.data && typeof shaped.data === "object") {
    const data = shaped.data as { reason?: unknown };
    const parsed = directDeviceRefusalReason.safeParse(data.reason);
    if (parsed.success) return { state: "blocked", code: parsed.data === "REVOKED" ? "REVOKED" : "WRONG_OWNER" };
  }
  switch (raw.toUpperCase()) {
    case "TIMEOUT":
    case "ETIMEDOUT":
      return { state: "pending", code: "TIMEOUT" };
    case "UNAUTHENTICATED":
    case "UNAUTHORIZED":
      return { state: "pending", code: "UNAUTHENTICATED" };
    case "READ_ONLY":
    case "ACCESS_READ_ONLY":
    case "FORBIDDEN_READ_ONLY":
    case "FORBIDDEN":
      return { state: "pending", code: "READ_ONLY" };
    case "BAD_REQUEST":
    case "INVALID_INPUT":
      return { state: "blocked", code: "INVALID_INPUT" };
    case "REVOKED":
    case "DIRECT_DEVICE_REVOKED":
      return { state: "blocked", code: "REVOKED" };
    case "WRONG_OWNER":
    case "DIRECT_DEVICE_WRONG_OWNER":
      return { state: "blocked", code: "WRONG_OWNER" };
    default:
      return { state: "pending", code: "NETWORK" };
  }
}

export async function drainDirectDeviceOutbox(
  ticket: AuthorityTicket,
  deps: {
    store: DirectDeviceStore;
    send: (request: IngestDirectDeviceBatchInput) => Promise<IngestDirectDeviceBatchOutput>;
  },
): Promise<DirectUploadSummary> {
  const repository = directDeviceRepositoryIdentity(deps.store);
  if (inFlight.has(repository)) return { sent: 0, blocked: 0, stopped: "already_draining" };
  inFlight.add(repository);
  let sent = 0;
  let blocked = 0;
  try {
    while (isAuthorityTicketCurrent(ticket)) {
      const [row] = deps.store.listPending(ticket, 1);
      if (!row) return { sent, blocked, stopped: null };

      // Read, don't pop: the exact serialized request remains retryable after ambiguity.
      if (!isAuthorityTicketCurrent(ticket)) return { sent, blocked, stopped: "stale_authority" };
      let response: IngestDirectDeviceBatchOutput;
      try {
        response = await deps.send(row.request);
      } catch (error) {
        if (!isAuthorityTicketCurrent(ticket)) return { sent, blocked, stopped: "stale_authority" };
        const classified = classifyDirectDeviceUploadError(error);
        if (classified.state === "blocked") {
          deps.store.markBlocked(ticket, row.ref, classified.code);
          blocked += 1;
          continue;
        }
        return { sent, blocked, stopped: "retryable_error" };
      }

      // Never persist a late receipt under a revoked account/session authority.
      if (!isAuthorityTicketCurrent(ticket)) return { sent, blocked, stopped: "stale_authority" };
      const parsed = ingestDirectDeviceBatchOutput.safeParse(response);
      if (!parsed.success) {
        deps.store.markBlocked(ticket, row.ref, "INVALID_RECEIPT");
        blocked += 1;
        continue;
      }
      deps.store.recordServerReceipt(ticket, row.ref, parsed.data);
      sent += 1;
    }
    return { sent, blocked, stopped: "stale_authority" };
  } finally {
    inFlight.delete(repository);
  }
}
