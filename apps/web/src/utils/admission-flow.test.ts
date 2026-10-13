import "@/testing/varlock-test-setup";

import { describe, expect, jest, test } from "bun:test";

import { createAdmissionFlow, type AdmissionApi } from "./admission-flow";

function makeApi(overrides: Partial<AdmissionApi> & { delay?: number } = {}): {
  api: AdmissionApi;
  calls: unknown[];
  secrets: string[];
} {
  const calls: unknown[] = [];
  const secrets: string[] = [];
  const delay = overrides.delay ?? 0;

  const api: AdmissionApi = {
    begin: async (input) => {
      calls.push({ type: "begin", input });
      secrets.push(input.credential, input.email);
      if (overrides.begin) return overrides.begin(input);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return {
        enrollmentId: `enr-${calls.filter((c) => (c as { type: string }).type === "begin").length}`,
      };
    },
    complete: async (input) => {
      calls.push({ type: "complete", input });
      secrets.push(input.credential, input.verificationCode, input.enrollmentId);
      if (overrides.complete) return overrides.complete(input);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return { completed: true };
    },
  };

  return { api, calls, secrets };
}

function makeFlow({
  kind = "setup",
  userId = null,
  sessionEmail = null,
  api,
  onMagicLink = jest.fn(async (_email: string, _purpose: "resume" | "dashboard") => {}),
}: {
  kind?: "setup" | "invitation";
  userId?: string | null;
  sessionEmail?: string | null;
  api: AdmissionApi;
  onMagicLink?: (email: string, purpose: "resume" | "dashboard") => Promise<void>;
}) {
  const states: ReturnType<typeof createAdmissionFlow>["state"][] = [];
  const flow = createAdmissionFlow({
    kind,
    userId,
    sessionEmail,
    onRequestMagicLink: onMagicLink,
    onStateChange: (state) => states.push(state),
    admissionApi: api,
  });
  return { flow, states };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function deferredWithReject<T>() {
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((_, rej) => {
    reject = rej;
  });
  return { promise, reject };
}

describe("createAdmissionFlow", () => {
  test("begin → code step with enrollmentId, then complete → success", async () => {
    const { api } = makeApi();
    const { flow, states } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();

    expect(flow.state.step).toBe("code");
    expect(flow.state.enrollmentId).toMatch(/^enr-/);

    flow.setCode("proof-1");
    await flow.complete();

    expect(flow.state.step).toBe("success");
    expect(flow.state.credential).toBe("");
    expect(flow.state.code).toBe("");
    expect(flow.state.enrollmentId).toBe("");
    expect(flow.state.hasMatchingSession).toBe(false);
    expect(states.at(-1)?.step).toBe("success");
  });

  test("blocks same-tick duplicate submit", async () => {
    const { api, calls } = makeApi({ delay: 10 });
    const { flow } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    const first = flow.begin();
    const second = flow.begin();
    await Promise.all([first, second]);

    expect(calls.filter((c) => (c as { type: string }).type === "begin")).toHaveLength(1);
  });

  test("ignores late response after reset", async () => {
    const d = deferred<{ enrollmentId: string }>();
    const { api, calls } = makeApi({ begin: async () => d.promise });
    const { flow, states } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    const promise = flow.begin();
    flow.reset();
    d.resolve({ enrollmentId: "late" });
    await promise;

    expect(flow.state.step).toBe("token");
    expect(flow.state.enrollmentId).toBe("");
    expect(calls).toHaveLength(1);
    expect(states.every((s) => s.step !== "code")).toBe(true);
  });

  test("ignores late response after unmount", async () => {
    const d = deferred<{ enrollmentId: string }>();
    const { api } = makeApi({ begin: async () => d.promise });
    const { flow, states } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    const promise = flow.begin();
    flow._unmount();
    d.resolve({ enrollmentId: "late" });
    await promise;

    expect(states.every((s) => s.step !== "code")).toBe(true);
  });

  test("unmount wipes retained secrets from controller state", () => {
    const { api } = makeApi();
    const { flow } = makeFlow({ api, userId: "user-1" });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    flow.setCode("proof-1");
    flow._unmount();

    expect(flow.state.credential).toBe("");
    expect(flow.state.code).toBe("");
    expect(flow.state.email).toBe("");
  });

  test("controller captures stable principal identity", () => {
    const { api } = makeApi();
    const { flow } = makeFlow({ api, userId: "user-1" });
    expect(flow.userId).toBe("user-1");
  });

  test("new recipient with unrelated signed-in user shows sign-in, not dashboard", async () => {
    const { api } = makeApi();
    const { flow } = makeFlow({
      kind: "invitation",
      sessionEmail: "other@example.com",
      api,
    });

    flow.setEmail("new@example.com");
    flow.setCredential("invitation-token");
    await flow.begin();
    flow.setCode("proof-1");
    await flow.complete();

    expect(flow.state.step).toBe("success");
    expect(flow.state.hasMatchingSession).toBe(false);
  });

  test("existing recipient with matching session offers dashboard hint", async () => {
    const { api } = makeApi();
    const { flow } = makeFlow({
      kind: "invitation",
      sessionEmail: "existing@example.com",
      api,
    });

    flow.setEmail("existing@example.com");
    flow.setCredential("invitation-token");
    await flow.begin();
    flow.setCode("proof-1");
    await flow.complete();

    expect(flow.state.step).toBe("success");
    expect(flow.state.hasMatchingSession).toBe(true);
  });

  test("resend uses same credential/email and clears code", async () => {
    const { api, calls } = makeApi();
    const { flow } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();
    flow.setCode("old-code");
    await flow.resend();

    expect(flow.state.code).toBe("");
    expect(calls.filter((c) => (c as { type: string }).type === "begin")).toHaveLength(2);
  });

  test("delivery failure surfaces actionable error", async () => {
    const onMagicLink = jest.fn(async (_email: string, _purpose: "resume" | "dashboard") => {
      throw new Error("delivery failed");
    });
    const { api } = makeApi();
    const { flow } = makeFlow({ api, onMagicLink });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();
    flow.setCode("proof-1");
    await flow.complete();
    await flow.requestMagicLink("dashboard");

    expect(flow.state.linkDelivery).toBe("error");
    expect(flow.state.errorCode).toBe("delivery_failed");
  });

  test("secrets are never persisted in state after success", async () => {
    const { api } = makeApi();
    const { flow } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();
    flow.setCode("proof-1");
    await flow.complete();

    const snapshot = JSON.stringify(flow.state);
    expect(snapshot).not.toInclude("setup-token");
    expect(snapshot).not.toInclude("proof-1");
    expect(snapshot).not.toInclude("enr-");
  });

  test("old begin finally does not release new begin guard", async () => {
    const d1 = deferred<{ enrollmentId: string }>();
    const d2 = deferred<{ enrollmentId: string }>();
    let callIndex = 0;
    const { api, calls } = makeApi({
      begin: async () => (callIndex++ === 0 ? d1.promise : d2.promise),
    });
    const { flow } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    const p1 = flow.begin();

    flow.reset();
    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    const p2 = flow.begin();

    d1.resolve({ enrollmentId: "late" });
    await p1;

    // While D2 is still pending, a third begin must be blocked.
    const p3 = flow.begin();
    expect(calls.filter((c) => (c as { type: string }).type === "begin")).toHaveLength(2);

    d2.resolve({ enrollmentId: "ok" });
    await p2;

    // After D2 settles, a fresh begin is allowed.
    await flow.begin();
    expect(calls.filter((c) => (c as { type: string }).type === "begin")).toHaveLength(3);
    expect(p3).resolves.toBeUndefined();
  });

  test("old complete finally does not release new complete guard", async () => {
    const d1 = deferredWithReject<{ completed: true }>();
    const d2 = deferredWithReject<{ completed: true }>();
    let callIndex = 0;
    const { api, calls } = makeApi({
      complete: async () => (callIndex++ === 0 ? d1.promise : d2.promise),
    });
    const { flow } = makeFlow({ api });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();
    flow.setCode("proof-1");

    const p1 = flow.complete();

    flow.reset();
    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();
    flow.setCode("proof-2");
    const p2 = flow.complete();

    d1.reject(new Error("fail"));
    await p1;

    const p3 = flow.complete();
    expect(calls.filter((c) => (c as { type: string }).type === "complete")).toHaveLength(2);

    d2.reject(new Error("fail"));
    await p2;

    await flow.complete();
    expect(calls.filter((c) => (c as { type: string }).type === "complete")).toHaveLength(3);
    expect(p3).resolves.toBeUndefined();
  });

  test("old magic-link finally does not release new magic-link guard", async () => {
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    let callIndex = 0;
    const onMagicLink = jest.fn(async () => (callIndex++ === 0 ? d1.promise : d2.promise));
    const { api } = makeApi();
    const { flow } = makeFlow({ api, onMagicLink });

    flow.setEmail("new@example.com");
    flow.setCredential("setup-token");
    await flow.begin();
    flow.setCode("proof-1");
    await flow.complete();

    const p1 = flow.requestMagicLink("dashboard");

    flow.reset();
    flow.setEmail("new@example.com");
    const p2 = flow.requestMagicLink("dashboard");

    d1.resolve();
    await p1;

    const p3 = flow.requestMagicLink("dashboard");
    expect(onMagicLink).toHaveBeenCalledTimes(2);

    d2.resolve();
    await p2;

    await flow.requestMagicLink("dashboard");
    expect(onMagicLink).toHaveBeenCalledTimes(3);
    expect(p3).resolves.toBeUndefined();
  });
});
