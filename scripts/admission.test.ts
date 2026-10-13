import { describe, expect, test } from "bun:test";

import type { AdmissionService } from "../packages/auth/src/admission/index.ts";

import { isLoopbackDatabaseUrl, parseArgs, runAdmissionCli, type MintFileOps } from "./admission";

const CANARY_TOKEN = "canary-setup-token-9f3a2b";

function fakeService(overrides: Partial<AdmissionService> = {}): AdmissionService {
  return {
    mintSetupToken: async () => ({
      token: CANARY_TOKEN,
      expiresAt: new Date("2026-10-14T00:00:00.000Z"),
      generation: 1,
    }),
    pruneExpiredGrants: async () => ({ pruned: 3 }),
    ...overrides,
  } as unknown as AdmissionService;
}

function recordingFileOps(existing = false) {
  const events: string[] = [];
  let fd = 0;
  const ops: MintFileOps = {
    reserve: (path) => {
      events.push(`reserve:${path}`);
      if (existing) throw new Error("EEXIST");
      fd += 1;
      return fd;
    },
    verifyPrivate: () => true,
    write: (handle, text) => {
      events.push(`write:${handle}:${text.includes(CANARY_TOKEN) ? "token" : "other"}`);
    },
    close: (handle) => {
      events.push(`close:${handle}`);
    },
    remove: (path) => {
      events.push(`remove:${path}`);
    },
  };
  return { ops, events };
}

describe("admission CLI parseArgs", () => {
  test("accepts mint with exactly one selector", () => {
    expect(parseArgs(["mint", "--output", "/tmp/x"])).toEqual({
      ok: true,
      command: { action: "mint", toStdout: false, outputPath: "/tmp/x", allowRemote: false },
    });
    expect(parseArgs(["mint", "--stdout"])).toEqual({
      ok: true,
      command: { action: "mint", toStdout: true, outputPath: null, allowRemote: false },
    });
  });

  test("rejects mint with zero or two output selectors", () => {
    expect(parseArgs(["mint"]).ok).toBe(false);
    expect(parseArgs(["mint", "--stdout", "--output", "/tmp/x"]).ok).toBe(false);
  });

  test("rejects unknown and secret-like flags without echoing them", () => {
    for (const argv of [
      ["mint", "--stdout", "--bogus"],
      ["mint", "--stdout", "--token=leak"],
      ["mint", "--stdout", "--credential", "abc"],
      ["prune", "--limit", "1", "--email=user@example.com"],
    ]) {
      const result = parseArgs(argv);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).not.toContain("leak");
        expect(result.message).not.toContain("abc");
        expect(result.message).not.toContain("user@example.com");
      }
    }
  });

  test("bounds prune limit", () => {
    expect(parseArgs(["prune", "--limit", "500"])).toEqual({
      ok: true,
      command: { action: "prune", limit: 500, allowRemote: false },
    });
    expect(parseArgs(["prune", "--limit", "501"]).ok).toBe(false);
    expect(parseArgs(["prune", "--limit", "abc"]).ok).toBe(false);
    expect(parseArgs(["prune", "--limit", "0"]).ok).toBe(false);
  });
});

describe("isLoopbackDatabaseUrl", () => {
  test("allows loopback hosts and rejects the rest", () => {
    expect(isLoopbackDatabaseUrl("postgres://u:p@127.0.0.1:5432/db")).toBe(true);
    expect(isLoopbackDatabaseUrl("postgres://u:p@localhost/db")).toBe(true);
    expect(isLoopbackDatabaseUrl("postgres://u:p@db.example.com/db")).toBe(false);
    expect(isLoopbackDatabaseUrl("not-a-url")).toBe(false);
  });
});

describe("runAdmissionCli", () => {
  test("mint --stdout prints the token once and succeeds", async () => {
    const out: string[] = [];
    const code = await runAdmissionCli(
      { action: "mint", toStdout: true, outputPath: null, allowRemote: false },
      { stdout: (l) => out.push(l), stderr: () => {}, loadService: async () => fakeService() },
    );
    expect(code).toBe(0);
    expect(out).toEqual([CANARY_TOKEN]);
  });

  test("mint to a file reserves before minting and writes the token", async () => {
    const { ops, events } = recordingFileOps();
    const out: string[] = [];
    let minted = false;
    const code = await runAdmissionCli(
      { action: "mint", toStdout: false, outputPath: "/tmp/tok", allowRemote: false },
      {
        stdout: (l) => out.push(l),
        stderr: () => {},
        fileOps: ops,
        loadService: async () => {
          minted = true;
          return fakeService();
        },
      },
    );
    expect(code).toBe(0);
    expect(minted).toBe(true);
    expect(events[0]).toBe("reserve:/tmp/tok");
    expect(events.some((e) => e.startsWith("write:") && e.endsWith(":token"))).toBe(true);
    expect(out).toEqual(["Setup token written."]);
    expect(out.join("\n")).not.toContain(CANARY_TOKEN);
  });

  test("an existing output file never mints or advances the generation", async () => {
    const { ops, events } = recordingFileOps(true);
    let loadCalled = false;
    const err: string[] = [];
    const code = await runAdmissionCli(
      { action: "mint", toStdout: false, outputPath: "/tmp/tok", allowRemote: false },
      {
        stdout: () => {},
        stderr: (l) => err.push(l),
        fileOps: ops,
        loadService: async () => {
          loadCalled = true;
          return fakeService();
        },
      },
    );
    expect(code).toBe(1);
    expect(loadCalled).toBe(false);
    expect(events).toEqual(["reserve:/tmp/tok"]);
    expect(err.join("\n")).not.toContain(CANARY_TOKEN);
  });

  test("a mint failure cleans up the reserved file and reports generically", async () => {
    const { ops, events } = recordingFileOps();
    const err: string[] = [];
    const code = await runAdmissionCli(
      { action: "mint", toStdout: false, outputPath: "/tmp/tok", allowRemote: false },
      {
        stdout: () => {},
        stderr: (l) => err.push(l),
        fileOps: ops,
        loadService: async () => {
          throw new Error("db down");
        },
      },
    );
    expect(code).toBe(1);
    expect(events).toContain("remove:/tmp/tok");
    expect(err.join("\n")).not.toContain("db down");
    expect(err.join("\n")).not.toContain("/tmp/tok");
  });

  test("a non-private output handle is rejected and removed", async () => {
    const { ops, events } = recordingFileOps();
    ops.verifyPrivate = () => false;
    const code = await runAdmissionCli(
      { action: "mint", toStdout: false, outputPath: "/tmp/tok", allowRemote: false },
      {
        stdout: () => {},
        stderr: () => {},
        fileOps: ops,
        loadService: async () => fakeService(),
      },
    );
    expect(code).toBe(1);
    expect(events).toContain("close:1");
    expect(events).toContain("remove:/tmp/tok");
  });

  test("prune is bounded and reports generically", async () => {
    const out: string[] = [];
    const code = await runAdmissionCli(
      { action: "prune", limit: 250, allowRemote: false },
      { stdout: (l) => out.push(l), stderr: () => {}, loadService: async () => fakeService() },
    );
    expect(code).toBe(0);
    expect(out).toEqual(["Pruned expired admission grants."]);
  });
});
