import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  SERVER_API_VERSION,
  SERVER_META_PATH,
  SERVER_VERSION,
  serverMetaSchema,
  type ServerMeta,
} from "@openvalens/api/server-meta";
import { parseDeploymentConfig } from "@openvalens/auth/deployment";
import { Hono } from "hono";

import { deploymentProfile, registerServerMetaRoute } from "./server-meta-route";

function appWith(options: Parameters<typeof registerServerMetaRoute>[1]) {
  const app = new Hono();
  registerServerMetaRoute(app, options);
  return app;
}

describe("GET /.well-known/openvalens (#295)", () => {
  test("answers without a session, with exactly the documented fields", async () => {
    const response = await appWith({ signInOptions: { oidc: null } }).request(SERVER_META_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const body = (await response.json()) as ServerMeta;
    expect(body).toEqual({
      product: "openvalens",
      apiVersion: SERVER_API_VERSION,
      serverVersion: SERVER_VERSION,
      mode: "self-hosted",
      signIn: { magicLink: true, oidc: false, google: false, apple: false, signUp: false },
    });
    expect(serverMetaSchema.strict().parse(body)).toEqual(body);
  });

  test("advertises OIDC as a flag only, never the provider id or label", async () => {
    const response = await appWith({
      signInOptions: { oidc: { providerId: "authentik", displayName: "Acme SSO" } },
    }).request(SERVER_META_PATH);
    const text = await response.text();
    expect(JSON.parse(text).signIn.oidc).toBe(true);
    expect(text).not.toContain("authentik");
    expect(text).not.toContain("Acme SSO");
  });

  test("takes mode and sign-up from the deployment profile", async () => {
    const response = await appWith({
      signInOptions: { oidc: null },
      profile: () => ({ mode: "cloud", signUp: true }),
    }).request(SERVER_META_PATH);
    const body = (await response.json()) as ServerMeta;
    expect(body.mode).toBe("cloud");
    expect(body.signIn.signUp).toBe(true);
  });

  test("self-host stays invite-only by default", () => {
    expect(deploymentProfile()).toEqual({ mode: "self-hosted", signUp: false });
    expect(deploymentProfile({ mode: "self-hosted" })).toEqual({
      mode: "self-hosted",
      signUp: false,
    });
  });

  test("cloud mode (#294) advertises public sign-up from the parsed DEPLOYMENT_MODE", async () => {
    const config = parseDeploymentConfig({
      DEPLOYMENT_MODE: "cloud",
      LEGAL_TERMS_URL: "https://legal.test/terms",
      LEGAL_TERMS_VERSION: "t-1",
      LEGAL_PRIVACY_URL: "https://legal.test/privacy",
      LEGAL_PRIVACY_VERSION: "p-1",
    });
    expect(deploymentProfile(config)).toEqual({ mode: "cloud", signUp: true });

    const response = await appWith({
      signInOptions: { oidc: null },
      profile: () => deploymentProfile(config),
    }).request(SERVER_META_PATH);
    const text = await response.text();
    const body = JSON.parse(text) as ServerMeta;
    expect(body.mode).toBe("cloud");
    expect(body.signIn.signUp).toBe(true);
    expect(serverMetaSchema.strict().parse(body)).toEqual(body);
    // Value-free: no legal URL or version leaks into the public meta.
    expect(text).not.toContain("legal.test");
  });

  test("is GET only", async () => {
    const response = await appWith({ signInOptions: { oidc: null } }).request(SERVER_META_PATH, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  test("reports the release version from the root package.json", async () => {
    const root = await Bun.file(join(import.meta.dir, "../../../package.json")).json();
    expect(SERVER_VERSION).toBe(root.version);
  });
});
