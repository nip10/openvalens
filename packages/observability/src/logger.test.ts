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

describe("createStructuredLogger", () => {
  test("routes info to stdout and warn/error to stderr", () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const logger = createStructuredLogger();
      logger.info("event.info", { a: 1 });
      logger.warn("event.warn", { a: 2 });
      logger.error("event.error", { a: 3 });

      expect(stdout).toHaveBeenCalledTimes(1);
      expect(stderr).toHaveBeenCalledTimes(2);

      const stdoutLine = String(stdout.mock.calls[0]?.[0]);
      const stderrLines = stderr.mock.calls.map((call) => String(call[0]));

      expect(stdoutLine).toContain('"level":"info"');
      expect(stdoutLine.endsWith("\n")).toBe(true);
      expect(stderrLines[0]).toContain('"level":"warn"');
      expect(stderrLines[1]).toContain('"level":"error"');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
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
