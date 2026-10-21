/// <reference types="bun" />
import * as React from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createORPCClient } from "@orpc/client";

import { useAnalyticsConsent, type AnalyticsConsentApi } from "./use-analytics-consent";

type Preference = { enabled: boolean; available: boolean };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let renderer: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useAnalyticsConsent> | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
  latest = undefined;
});

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function mount(
  api: AnalyticsConsentApi,
  scope: string,
  ownerId: string,
  active = true,
  strict = false,
) {
  const probe = <ProbeForTest api={api} scope={scope} ownerId={ownerId} active={active} />;
  act(() => {
    renderer = create(strict ? <React.StrictMode>{probe}</React.StrictMode> : probe);
  });
  return renderer!;
}

const enabled: Preference = { enabled: true, available: true };
const disabled: Preference = { enabled: false, available: true };

describe("mounted analytics consent hook", () => {
  test("uses real unstable oRPC proxies safely and waits for fresh consent before capture", async () => {
    const read = deferred<Preference>();
    let reads = 0;
    let captures = 0;
    type ApiClient = { analytics: AnalyticsConsentApi };
    const client = createORPCClient<ApiClient>({
      call(path) {
        if (path.join(".") === "analytics.getPreference") {
          reads += 1;
          return read.promise;
        }
        if (path.join(".") === "analytics.capture") {
          captures += 1;
          return Promise.resolve({ accepted: true });
        }
        return Promise.resolve(enabled);
      },
    });
    expect(client.analytics).not.toBe(client.analytics);
    const stableApi = client.analytics;
    mount(stableApi, JSON.stringify(["user-proxy", "org-a"]), "user-proxy");
    expect(reads).toBe(1);
    expect(captures).toBe(0);
    await act(async () => {
      read.resolve(enabled);
      await read.promise;
    });
    expect(captures).toBe(1);
    await act(async () => {
      renderer!.update(
        <ProbeForTest
          api={stableApi}
          scope={JSON.stringify(["user-proxy", "org-a"])}
          ownerId="user-proxy"
          active
          version={2}
        />,
      );
      await flush();
    });
    expect(reads).toBe(1);
  });

  test("failed revoke remains latched across organizations and blocks later page capture", async () => {
    const captures: string[] = [];
    const reads: Array<Promise<Preference>> = [Promise.resolve(enabled), Promise.resolve(enabled)];
    let writes = 0;
    const api: AnalyticsConsentApi = {
      getPreference: () => reads.shift()!,
      setPreference: async () => {
        writes += 1;
        throw new Error("write failed");
      },
      capture: async ({ event }) => {
        captures.push(event);
        return { accepted: true };
      },
    };
    const first = mount(api, JSON.stringify(["same-actor", "org-a"]), "same-actor");
    await act(async () => {
      await flush();
    });
    expect(captures).toEqual(["preferences_opened"]);
    await act(async () => {
      await latest!.setPreference(false);
    });
    expect(latest!.error).toBe("revoke");
    await act(async () => {
      first.update(
        <ProbeForTest
          api={api}
          scope={JSON.stringify(["same-actor", "org-b"])}
          ownerId="same-actor"
        />,
      );
      await flush();
    });
    expect(writes).toBe(1);
    expect(captures).toEqual(["preferences_opened"]);
    expect(latest!.locallyRevoked).toBe(true);
  });

  test("remount plus failed preference read retries with false write, not another read", async () => {
    const firstWrite = deferred<Preference>();
    let writes = 0;
    let reads = 0;
    const api: AnalyticsConsentApi = {
      getPreference: async () => {
        reads += 1;
        if (reads === 1) return enabled;
        throw new Error("read failed");
      },
      setPreference: async ({ enabled: value }) => {
        expect(value).toBe(false);
        writes += 1;
        if (writes === 1) throw new Error("revoke failed");
        return firstWrite.promise;
      },
      capture: async () => ({ accepted: true }),
    };
    const first = mount(api, JSON.stringify(["remount-actor", "org-a"]), "remount-actor");
    await act(async () => {
      await flush();
    });
    await act(async () => {
      await latest!.setPreference(false);
    });
    act(() => first.unmount());
    renderer = undefined;
    mount(api, JSON.stringify(["remount-actor", "org-a"]), "remount-actor");
    await act(async () => {
      await flush();
    });
    expect(latest!.error).toBe("revoke");
    await act(async () => {
      latest!.retry();
      await flush();
    });
    expect(reads).toBe(2);
    expect(writes).toBe(2);
    await act(async () => {
      firstWrite.resolve(disabled);
      await firstWrite.promise;
    });
    expect(latest!.locallyRevoked).toBe(false);
  });

  test("synchronous pending claim blocks rapid duplicate writes", async () => {
    const write = deferred<Preference>();
    let writes = 0;
    const api: AnalyticsConsentApi = {
      getPreference: async () => enabled,
      setPreference: async () => {
        writes += 1;
        return write.promise;
      },
      capture: async () => ({ accepted: true }),
    };
    mount(api, JSON.stringify(["double-click-actor", "org-a"]), "double-click-actor");
    await act(async () => {
      await flush();
    });
    act(() => {
      void latest!.setPreference(false);
      void latest!.setPreference(false);
    });
    expect(writes).toBe(1);
    await act(async () => {
      write.resolve(disabled);
      await write.promise;
    });
  });

  test("A-B-A stale reads cannot authorize, and initial opt-in does not backfill page-open", async () => {
    const reads = [deferred<Preference>(), deferred<Preference>(), deferred<Preference>()];
    let readIndex = 0;
    let captures = 0;
    let writes = 0;
    const api: AnalyticsConsentApi = {
      getPreference: () => reads[readIndex++]!.promise,
      setPreference: async () => {
        writes += 1;
        return enabled;
      },
      capture: async () => {
        captures += 1;
        return { accepted: true };
      },
    };
    const first = mount(api, JSON.stringify(["aba-actor", "org-a"]), "aba-actor");
    await act(async () => {
      first.update(
        <ProbeForTest
          api={api}
          scope={JSON.stringify(["aba-actor", "org-b"])}
          ownerId="aba-actor"
        />,
      );
    });
    await act(async () => {
      first.update(
        <ProbeForTest
          api={api}
          scope={JSON.stringify(["aba-actor", "org-a"])}
          ownerId="aba-actor"
        />,
      );
    });
    await act(async () => {
      reads[0]!.resolve(enabled);
      reads[1]!.resolve(enabled);
      await Promise.all([reads[0]!.promise, reads[1]!.promise]);
    });
    expect(captures).toBe(0);
    await act(async () => {
      reads[2]!.resolve(disabled);
      await reads[2]!.promise;
    });
    await act(async () => {
      await latest!.setPreference(true);
    });
    expect(writes).toBe(1);
    expect(captures).toBe(0);
  });

  test("native-style deactivate invalidates pending read; activate starts a fresh visit", async () => {
    const firstRead = deferred<Preference>();
    let reads = 0;
    let captures = 0;
    const api: AnalyticsConsentApi = {
      getPreference: () => (++reads === 1 ? firstRead.promise : Promise.resolve(enabled)),
      setPreference: async () => disabled,
      capture: async () => {
        captures += 1;
        return { accepted: true };
      },
    };
    mount(api, JSON.stringify(["focus-actor", "org-a"]), "focus-actor", false);
    act(() => {
      latest!.activate();
    });
    expect(reads).toBe(1);
    act(() => {
      latest!.deactivate();
    });
    await act(async () => {
      firstRead.resolve(enabled);
      await firstRead.promise;
    });
    expect(captures).toBe(0);
    act(() => {
      latest!.activate();
    });
    await act(async () => {
      await flush();
    });
    expect(reads).toBe(2);
    expect(captures).toBe(1);
  });

  test("StrictMode effect replay produces at most one page-open capture", async () => {
    let captures = 0;
    const api: AnalyticsConsentApi = {
      getPreference: async () => enabled,
      setPreference: async () => disabled,
      capture: async () => {
        captures += 1;
        return { accepted: true };
      },
    };
    mount(api, JSON.stringify(["strict-actor", "org-a"]), "strict-actor", true, true);
    await act(async () => {
      await flush();
    });
    expect(captures).toBe(1);
  });

  test("web settings component stabilizes the actual oRPC namespace proxy across hook rerenders", async () => {
    let reads = 0;
    let captures = 0;
    type ApiClient = { analytics: AnalyticsConsentApi };
    const client = createORPCClient<ApiClient>({
      call(path) {
        if (path.join(".") === "analytics.getPreference") {
          reads += 1;
          return Promise.resolve({ enabled: false, available: true });
        }
        if (path.join(".") === "analytics.capture") {
          captures += 1;
          return Promise.resolve({ accepted: true });
        }
        return Promise.resolve({ enabled: false, available: true });
      },
    });
    mock.module("@/lib/auth-client", () => ({
      authClient: {
        useSession: () => ({
          data: {
            user: { id: "component-proxy-user" },
            session: { activeOrganizationId: "component-proxy-org" },
          },
          isPending: false,
        }),
      },
    }));
    mock.module("@/utils/orpc", () => ({ client }));
    const componentPath = "../../../../apps/web/src/components/analytics-consent-section";
    const { AnalyticsConsentSection } = await import(componentPath);
    act(() => {
      renderer = create(React.createElement(AnalyticsConsentSection));
    });
    await act(async () => {
      await flush();
    });
    expect(client.analytics).not.toBe(client.analytics);
    expect(reads).toBe(1);
    expect(captures).toBe(0);
  });
});

function ProbeForTest({
  api,
  scope,
  ownerId,
  active = true,
}: {
  api: AnalyticsConsentApi;
  scope: string;
  ownerId: string;
  active?: boolean;
  version?: number;
}) {
  latest = useAnalyticsConsent({ api, scope, ownerId, active });
  return null;
}
