import { describe, expect, spyOn, test } from "bun:test";

import { createStructuredLogger, type LogLevel } from "./logger";

function createCapturingLogger(level: LogLevel = "debug") {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const logger = createStructuredLogger({
    level,
    sink: (emittedLevel, line) => lines.push({ level: emittedLevel, line }),
  });

  return { logger, lines };
}

function parseLine(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

// Unique, test-owned event names. Asserting on these instead of raw
// `process.stdout`/`process.stderr` call counts keeps the stream-routing check
// correct even when other test files write to the same process streams
// concurrently, while still catching a genuine misroute or duplicate emit.
const INFO_EVENT = "logger.route.sentinel.info.6c1f";
const WARN_EVENT = "logger.route.sentinel.warn.6c1f";
const ERROR_EVENT = "logger.route.sentinel.error.6c1f";

/** Captures everything written to the process streams while `run` executes. */
function captureStreams(run: () => void): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const errSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    run();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }

  return { stdout, stderr };
}

/** The captured lines that belong to this test (identified by its sentinel). */
function ownedLines(lines: string[], event: string): string[] {
  return lines.filter((line) => line.includes(event));
}

describe("createStructuredLogger", () => {
  test("routes info to stdout and warn/error to stderr", () => {
    const logger = createStructuredLogger();
    const { stdout, stderr } = captureStreams(() => {
      logger.info(INFO_EVENT, { a: 1 });
      logger.warn(WARN_EVENT, { a: 2 });
      logger.error(ERROR_EVENT, { a: 3 });
    });

    const infoLines = ownedLines(stdout, INFO_EVENT);
    const warnLines = ownedLines(stderr, WARN_EVENT);
    const errorLines = ownedLines(stderr, ERROR_EVENT);

    // Each logger message is emitted exactly once, on its correct stream.
    expect(infoLines).toHaveLength(1);
    expect(warnLines).toHaveLength(1);
    expect(errorLines).toHaveLength(1);

    expect(infoLines[0]).toContain('"level":"info"');
    expect(infoLines[0]?.endsWith("\n")).toBe(true);
    expect(warnLines[0]).toContain('"level":"warn"');
    expect(errorLines[0]).toContain('"level":"error"');

    // No logger message is emitted on the wrong stream.
    expect(ownedLines(stdout, WARN_EVENT)).toHaveLength(0);
    expect(ownedLines(stdout, ERROR_EVENT)).toHaveLength(0);
    expect(ownedLines(stderr, INFO_EVENT)).toHaveLength(0);
  });

  test("stays correct when unrelated stderr output is interleaved", () => {
    const logger = createStructuredLogger();
    const { stdout, stderr } = captureStreams(() => {
      // Simulates another test file writing to the shared process stream. A
      // raw total-call-count assertion would over-count because of this noise.
      process.stderr.write("unrelated noise from a concurrent test file\n");
      logger.warn(WARN_EVENT, { a: 2 });
      logger.error(ERROR_EVENT, { a: 3 });
    });

    // The unrelated write is present, so a total-count assertion would fail...
    expect(stderr.length).toBeGreaterThan(2);
    // ...yet the logger-owned messages remain exactly one each, on stderr only.
    expect(ownedLines(stderr, WARN_EVENT)).toHaveLength(1);
    expect(ownedLines(stderr, ERROR_EVENT)).toHaveLength(1);
    expect(ownedLines(stdout, WARN_EVENT)).toHaveLength(0);
    expect(ownedLines(stdout, ERROR_EVENT)).toHaveLength(0);
  });

  test("suppresses levels below the configured minimum", () => {
    const { logger, lines } = createCapturingLogger("info");

    logger.debug("event.debug");
    logger.info("event.info");

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
  });

  test("drops BLOCKED_FIELDS recursively across nested objects and arrays", () => {
    const { logger, lines } = createCapturingLogger();

    logger.info("phi.test", {
      safe: "keep",
      email: "patient@example.com",
      nested: { token: "secret-token", keep: 1, deeper: { body: "raw-body", ok: true } },
      list: [
        { payload: "raw-payload", ok: 2 },
        { text: "raw-text", ok: 3 },
      ],
    });

    const record = parseLine(lines[0]?.line ?? "");

    expect(record).toEqual({
      level: "info",
      event: "phi.test",
      safe: "keep",
      nested: { keep: 1, deeper: { ok: true } },
      list: [{ ok: 2 }, { ok: 3 }],
    });

    const raw = lines[0]?.line ?? "";
    expect(raw).not.toContain("patient@example.com");
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain("raw-body");
    expect(raw).not.toContain("raw-payload");
    expect(raw).not.toContain("raw-text");
  });

  test("serializes errors as { name, code? } only", () => {
    const { logger, lines } = createCapturingLogger();

    const withCode = Object.assign(new Error("secret message"), { code: "E_BOOM" });
    const withoutCode = new Error("another secret");

    logger.error("err.with-code", { error: withCode });
    logger.error("err.without-code", { error: withoutCode });

    const first = parseLine(lines[0]?.line ?? "");
    const second = parseLine(lines[1]?.line ?? "");

    expect(first.error).toEqual({ name: "Error", code: "E_BOOM" });
    expect(second.error).toEqual({ name: "Error" });

    expect(lines[0]?.line).not.toContain("secret message");
    expect(lines[0]?.line).not.toContain("stack");
    expect(lines[1]?.line).not.toContain("another secret");
  });

  test("child({ correlationId }) propagates the correlation id into log lines", () => {
    const { logger, lines } = createCapturingLogger();

    const requestLogger = logger.child({ correlationId: "corr-123" });
    requestLogger.info("request.completed", { status: 200 });

    const record = parseLine(lines[0]?.line ?? "");
    expect(record).toEqual({
      level: "info",
      event: "request.completed",
      correlationId: "corr-123",
      status: 200,
    });
  });

  test("nested child loggers merge their context", () => {
    const { logger, lines } = createCapturingLogger();

    logger.child({ correlationId: "corr-1" }).child({ userId: "user-1" }).info("nested");

    const record = parseLine(lines[0]?.line ?? "");
    expect(record.correlationId).toBe("corr-1");
    expect(record.userId).toBe("user-1");
  });

  test("auto-strips undefined and null values at any depth", () => {
    const { logger, lines } = createCapturingLogger();

    logger.info("strip.test", {
      a: undefined,
      b: null,
      c: 0,
      d: "",
      e: false,
      nested: { x: undefined, y: null, z: 1 },
      list: [1, undefined, null, 2],
    });

    const record = parseLine(lines[0]?.line ?? "");
    expect(record).toEqual({
      level: "info",
      event: "strip.test",
      c: 0,
      d: "",
      e: false,
      nested: { z: 1 },
      list: [1, 2],
    });
  });

  test("replaces circular references with '[Circular]'", () => {
    const { logger, lines } = createCapturingLogger();

    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    logger.info("circular.test", { circular });

    const record = parseLine(lines[0]?.line ?? "");
    expect(record.circular).toEqual({ name: "root", self: "[Circular]" });
  });
});
