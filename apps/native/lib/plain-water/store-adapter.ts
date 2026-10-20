import { canDiscardWaterItem, mutationIdOf, type WaterItem, type WaterStore } from "./outbox";
import {
  plainWaterAddInput,
  plainWaterChangeInput,
  plainWaterDeleteInput,
} from "@openvalens/api/contracts/plain-water";
import {
  hasValidWaterConflictReceipt,
  isValidWaterAttemptHistory,
} from "@openvalens/api/presenters/water-proof";

// The prefix keeps water ids visually distinct from meal mutation ids. Rows
// themselves live in `plain_water_outbox`, never the meal outbox.
const prefix = "plain-water:";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sameSnapshot(left: WaterItem, right: WaterItem): boolean {
  return canonical(left) === canonical(right);
}

function isPersistedWaterItem(
  value: unknown,
  row: { seq: number; scope: string; id: string },
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const op = item.op;
  if (!op || typeof op !== "object" || Array.isArray(op)) return false;
  const operation = op as Record<string, unknown>;
  if (!operation.input || typeof operation.input !== "object" || Array.isArray(operation.input))
    return false;
  const input = operation.input as Record<string, unknown>;
  const schema =
    operation.kind === "add"
      ? plainWaterAddInput
      : operation.kind === "change"
        ? plainWaterChangeInput
        : operation.kind === "delete"
          ? plainWaterDeleteInput
          : null;
  if (!schema?.safeParse(input).success) return false;
  const id = row.id.slice(prefix.length);
  if (
    input.clientMutationId !== id ||
    !["queued", "syncing", "needs_attention"].includes(String(item.status)) ||
    !isValidWaterAttemptHistory(item.attempts) ||
    typeof item.createdAt !== "number" ||
    !Number.isFinite(item.createdAt) ||
    !(
      item.lastErrorCode === null ||
      (typeof item.lastErrorCode === "string" && item.lastErrorCode.length > 0)
    )
  )
    return false;
  const target = operation.kind === "add" ? undefined : input.id;
  if (item.conflict === null) return item.lastErrorCode !== "CONFLICT";
  return hasValidWaterConflictReceipt(item.conflict, item.lastErrorCode, target);
}

export type WaterSqlite = {
  getAllSync<T>(query: string, ...params: unknown[]): T[];
  getFirstSync<T>(query: string, ...params: unknown[]): T | null;
  runSync(query: string, ...params: unknown[]): { changes: number };
};

export function createSqliteWaterStore(db: WaterSqlite): WaterStore {
  return {
    list(scope) {
      const rows = db.getAllSync<{ seq: number; scope: string; id: string; item: string }>(
        "SELECT seq,scope,id,item FROM plain_water_outbox WHERE scope=? AND id LIKE ? ORDER BY seq ASC",
        scope,
        `${prefix}%`,
      );
      return rows.flatMap((row) => {
        try {
          const parsed: unknown = JSON.parse(row.item);
          if (!isPersistedWaterItem(parsed, row)) throw new Error("invalid persisted water item");
          return [
            {
              ...(parsed as WaterItem),
              id: row.id.slice(prefix.length),
              scope: row.scope,
              seq: row.seq,
            },
          ];
        } catch {
          // Do not make a corrupt unresolved row look like an empty outbox.
          throw new Error("Could not read persisted plain-water changes");
        }
      });
    },
    put(item) {
      const id = `${prefix}${item.id}`;
      const json = JSON.stringify(item);
      const updated = db.runSync(
        "UPDATE plain_water_outbox SET item=? WHERE scope=? AND id=?",
        json,
        item.scope,
        id,
      );
      if (!updated.changes)
        db.runSync(
          "INSERT INTO plain_water_outbox(scope,id,item) VALUES(?,?,?)",
          item.scope,
          id,
          json,
        );
    },
    remove(scope, id) {
      db.runSync("DELETE FROM plain_water_outbox WHERE scope=? AND id=?", scope, `${prefix}${id}`);
    },
    replaceConflict(expected, replacement) {
      if (
        !canDiscardWaterItem(expected) ||
        expected.status !== "needs_attention" ||
        expected.lastErrorCode !== "CONFLICT" ||
        expected.conflict === null ||
        expected.conflict.deleted ||
        expected.op.kind === "add" ||
        expected.op.input.id !== expected.conflict.id ||
        replacement.scope !== expected.scope ||
        replacement.seq !== expected.seq ||
        replacement.id === expected.id ||
        mutationIdOf(replacement.op) !== replacement.id ||
        replacement.status !== "queued" ||
        replacement.attempts !== 0 ||
        replacement.lastErrorCode !== null ||
        replacement.conflict !== null
      )
        return false;

      const row = db.getAllSync<{ seq: number; scope: string; id: string; item: string }>(
        "SELECT seq,scope,id,item FROM plain_water_outbox WHERE scope=? AND id=?",
        expected.scope,
        `${prefix}${expected.id}`,
      )[0];
      if (
        !row ||
        row.seq !== expected.seq ||
        row.scope !== expected.scope ||
        row.id !== `${prefix}${expected.id}`
      )
        return false;
      let stored: WaterItem;
      let normalized: WaterItem;
      try {
        stored = JSON.parse(row.item) as WaterItem;
        normalized = { ...stored, id: expected.id, scope: row.scope, seq: row.seq };
      } catch {
        return false;
      }
      if (!sameSnapshot(normalized, expected)) return false;

      const changes = db.runSync(
        "UPDATE plain_water_outbox SET id=?,item=? WHERE scope=? AND id=? AND seq=? AND item=?",
        `${prefix}${replacement.id}`,
        JSON.stringify(replacement),
        expected.scope,
        `${prefix}${expected.id}`,
        expected.seq,
        row.item,
      ).changes;
      return changes === 1;
    },
    nextSeq() {
      return (
        db.getFirstSync<{ next: number }>(
          "SELECT coalesce(max(seq),0)+1 AS next FROM plain_water_outbox",
        )?.next ?? 1
      );
    },
  };
}
