import { describe, expect, test } from "bun:test";
import { phoneAppLink } from "@openvalens/api/presenters/onboarding";

import {
  linkedServer,
  noteLinkOffered,
  parseServerLink,
  rememberLinkedServer,
  serverLinkAddress,
  wasLinkOffered,
} from "./server-link";

const strict = { allowLocalHttp: false };

describe("serverLinkAddress", () => {
  test("reads the address the web's QR code carries", () => {
    expect(serverLinkAddress(phoneAppLink("https://health.example.org/"))).toBe(
      "https://health.example.org",
    );
    expect(serverLinkAddress("openvalens://server?url=https%3A%2F%2Fa.example%3A8443")).toBe(
      "https://a.example:8443",
    );
    expect(serverLinkAddress("openvalens:///server/?x=1&url=https%3A%2F%2Fb.example")).toBe(
      "https://b.example",
    );
    expect(serverLinkAddress("exp://192.168.1.2:8081/--/server?url=https%3A%2F%2Fc.example")).toBe(
      "https://c.example",
    );
  });

  test("other links, or a server link without an address, are not server links", () => {
    expect(serverLinkAddress(null)).toBeNull();
    expect(serverLinkAddress("")).toBeNull();
    expect(serverLinkAddress("openvalens://")).toBeNull();
    expect(serverLinkAddress("openvalens://sign-in?cookie=x")).toBeNull();
    expect(serverLinkAddress("openvalens://servers?url=https%3A%2F%2Fa.example")).toBeNull();
    expect(serverLinkAddress("openvalens://server")).toBeNull();
    expect(serverLinkAddress("openvalens://server?url=")).toBeNull();
    expect(serverLinkAddress("openvalens://server?url=%E0%A4%A")).toBeNull();
    expect(serverLinkAddress("not a link")).toBeNull();
  });
});

describe("parseServerLink", () => {
  test("checks the address like a typed one", () => {
    expect(parseServerLink(phoneAppLink("https://Health.Example.org/app"), strict)).toEqual({
      ok: true,
      url: "https://health.example.org",
    });
    expect(parseServerLink(phoneAppLink("http://example.org"), strict)).toEqual({
      ok: false,
      problem: "not-https",
    });
    expect(
      parseServerLink(phoneAppLink("http://localhost:3000"), { allowLocalHttp: true }),
    ).toEqual({ ok: true, url: "http://localhost:3000" });
    expect(parseServerLink("openvalens://other", strict)).toBeNull();
  });
});

describe("the remembered address", () => {
  test("is kept until cleared", () => {
    rememberLinkedServer("https://a.example");
    expect(linkedServer()).toBe("https://a.example");
    rememberLinkedServer(null);
    expect(linkedServer()).toBeNull();
  });

  test("a link offered on the server choice is not offered again", () => {
    expect(wasLinkOffered("https://b.example")).toBe(false);
    noteLinkOffered("https://b.example");
    expect(wasLinkOffered("https://b.example")).toBe(true);
  });
});
