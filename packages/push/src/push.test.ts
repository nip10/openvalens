import { describe, expect, test } from "bun:test";

import { createPushProvider, describePushIntegration, parsePushConfig } from "./config";
import { describePushDeliveryError, PushDeliveryError } from "./provider";
import { buildExpoMessages, EXPO_PUSH_ENDPOINT } from "./providers/expo";

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbb]";
const MESSAGE = {
  to: [TOKEN_A, TOKEN_B],
  title: "OpenValens",
  body: "You have a new insight",
  path: "/",
};

describe("push config", () => {
  test("off by default; expo when selected", () => {
    expect(describePushIntegration(parsePushConfig({}))).toEqual({ provider: null, state: "off" });
    expect(describePushIntegration(parsePushConfig({ PUSH_PROVIDER: "" }))).toEqual({
      provider: null,
      state: "off",
    });
    expect(describePushIntegration(parsePushConfig({ PUSH_PROVIDER: "expo" }))).toEqual({
      provider: "expo",
      state: "configured",
    });
    expect(createPushProvider(parsePushConfig({}), { fetch })).toBeNull();
  });
});

describe("expo adapter", () => {
  test("sends quiet, minimal messages and maps tickets", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({
          data: [
            { status: "ok", id: "t1" },
            {
              status: "error",
              message: `"${TOKEN_B}" is not a registered push notification recipient`,
              details: { error: "DeviceNotRegistered" },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = createPushProvider(parsePushConfig({ PUSH_PROVIDER: "expo" }), {
      fetch: fakeFetch,
    })!;
    const tickets = await provider.send(MESSAGE);
    expect(tickets).toEqual([
      { token: TOKEN_A, status: "ok" },
      { token: TOKEN_B, status: "unregistered" },
    ]);
    expect(calls[0]!.url).toBe(EXPO_PUSH_ENDPOINT);
    expect(calls[0]!.body).toEqual(buildExpoMessages(MESSAGE));
    expect(buildExpoMessages(MESSAGE)[0]).toEqual({
      to: TOKEN_A,
      title: "OpenValens",
      body: "You have a new insight",
      data: { path: "/" },
      priority: "normal",
      sound: null,
      channelId: "insights",
      interruptionLevel: "passive",
    });
  });

  test("request failures become typed, value-free errors", async () => {
    const provider = createPushProvider(parsePushConfig({ PUSH_PROVIDER: "expo" }), {
      fetch: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch,
    })!;
    const error = await provider.send(MESSAGE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PushDeliveryError);
    const summary = describePushDeliveryError(error);
    expect(summary).toEqual({
      errorCode: "PUSH_DELIVERY",
      errorCategory: "provider_unavailable",
      retryable: true,
      status: 503,
    });
    expect(JSON.stringify(summary)).not.toContain("ExponentPushToken");
    expect(describePushDeliveryError(new Error("boom"))).toEqual({
      errorCode: "PUSH_UNKNOWN",
      errorCategory: "unknown",
      retryable: false,
    });
  });
});
