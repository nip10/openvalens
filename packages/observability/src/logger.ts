/**
 * PHI-safe structured logger (Issue #9).
 *
 * Emits one JSON object per log line to stdout (`debug`/`info`) or stderr
 * (`warn`/`error`). Metadata is sanitized recursively before it is serialized:
 *
 * - any key listed in {@link BLOCKED_FIELDS} is dropped at any depth;
 * - `undefined` and `null` values are dropped;
 * - `Error` instances are reduced to `{ name, code? }` — message and stack are
 *   never emitted;
 * - circular references are replaced with `"[Circular]"`.
 *
 * A `child({ correlationId })` logger carries its context into every line so a
 * request-scoped logger always tags its output with the correlation id.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMetadata = Record<string, unknown>;

/** Receives one fully-serialized JSON line per emitted log record. */
export type LogSink = (level: LogLevel, line: string) => void;

export type StructuredLogger = {
  debug(event: string, metadata?: LogMetadata): void;
  info(event: string, metadata?: LogMetadata): void;
  warn(event: string, metadata?: LogMetadata): void;
  error(event: string, metadata?: LogMetadata): void;
  /** Returns a logger that merges `context` into every emitted line. */
  child(context: LogMetadata): StructuredLogger;
};

export type CreateStructuredLoggerOptions = {
  /** Minimum level to emit. Defaults to `"info"`. */
  level?: LogLevel;
  /** Destination for serialized lines. Defaults to stdout/stderr. */
  sink?: LogSink;
  /** Base metadata merged into every line (used by {@link StructuredLogger.child}). */
  context?: LogMetadata;
};

export const BLOCKED_FIELDS = [
  "body",
  "payload",
  "text",
  "messageText",
  "email",
  "token",
  "authorization",
  "rawPayload",
  "aiPrompt",
  "aiResponse",
  // Admission credentials (Issue #63) — never log a bearer, proof code or hash.
  "credential",
  "setupToken",
  "verificationCode",
  "invitationToken",
  "tokenHash",
  "codeHash",
  "setup_token_hash",
  "invitation_token_hash",
  "verification_code_hash",
  // Issue #125 — reminder-domain PHI carriers. The redactor is key-name-based,
  // so these keys are stripped before serialization to keep raw reminder
  // labels, telegram chat ids, and Telegram chat ids out of any log line,
  // even if a future caller passes them under an unlisted parent.
  "label",
  "chatId",
  "telegramChatId",
] as const;

const BLOCKED_FIELD_SET = new Set<string>(BLOCKED_FIELDS);

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function writeToProcess(level: LogLevel, line: string): void {
  const output = level === "warn" || level === "error" ? process.stderr : process.stdout;
  output.write(`${line}\n`);
}

function safeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    const serialized: LogMetadata = { name: value.name };
    const code = (value as { code?: unknown }).code;
    if (typeof code !== "undefined" && code !== null) {
      serialized.code = code;
    }
    return serialized;
  }

  if (value === null || typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeValue(item, seen)).filter((item) => typeof item !== "undefined");
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const serialized: LogMetadata = {};
    for (const [key, nested] of Object.entries(value)) {
      if (BLOCKED_FIELD_SET.has(key)) {
        continue;
      }

      const safe = safeValue(nested, seen);
      if (typeof safe !== "undefined") {
        serialized[key] = safe;
      }
    }

    return serialized;
  }

  return undefined;
}

export function createStructuredLogger(
  options: CreateStructuredLoggerOptions = {},
): StructuredLogger {
  const minLevel = options.level ?? "info";
  const sink = options.sink ?? writeToProcess;
  const context = options.context ?? {};

  const emit = (level: LogLevel, event: string, metadata?: LogMetadata): void => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) {
      return;
    }

    const merged = safeValue({ ...context, ...metadata }) as LogMetadata;
    sink(level, JSON.stringify({ level, event, ...merged }));
  };

  return {
    debug: (event, metadata) => emit("debug", event, metadata),
    info: (event, metadata) => emit("info", event, metadata),
    warn: (event, metadata) => emit("warn", event, metadata),
    error: (event, metadata) => emit("error", event, metadata),
    child: (childContext) =>
      createStructuredLogger({ level: minLevel, sink, context: { ...context, ...childContext } }),
  };
}
