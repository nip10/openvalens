import { describe, expect, test } from "bun:test";

import {
  CLOUD_REQUIRED_KEYS,
  DeploymentConfigError,
  deploymentCapabilities,
  parseDeploymentConfig,
} from "./deployment";

const CLOUD_ENV = {
  DEPLOYMENT_MODE: "cloud",
  LEGAL_TERMS_URL: "https://openvalens.example/terms",
  LEGAL_TERMS_VERSION: "2026-11-01",
  LEGAL_PRIVACY_URL: "https://openvalens.example/privacy",
  LEGAL_PRIVACY_VERSION: "2026-11-01",
};

describe("parseDeploymentConfig (Issue #294)", () => {
  test("unset or empty DEPLOYMENT_MODE is self-hosted", () => {
    expect(parseDeploymentConfig({})).toEqual({ mode: "self-hosted" });
    expect(parseDeploymentConfig({ DEPLOYMENT_MODE: "" })).toEqual({ mode: "self-hosted" });
    expect(parseDeploymentConfig({ DEPLOYMENT_MODE: "self-hosted" })).toEqual({
      mode: "self-hosted",
    });
  });

  test("self-host ignores the legal settings entirely", () => {
    expect(
      parseDeploymentConfig({ DEPLOYMENT_MODE: "self-hosted", LEGAL_TERMS_URL: "not a url" }),
    ).toEqual({ mode: "self-hosted" });
  });

  test("an unknown mode refuses to start", () => {
    expect(() => parseDeploymentConfig({ DEPLOYMENT_MODE: "saas" })).toThrow(DeploymentConfigError);
  });

  test("a complete cloud config carries the legal documents", () => {
    expect(parseDeploymentConfig(CLOUD_ENV)).toEqual({
      mode: "cloud",
      legal: {
        terms: { url: CLOUD_ENV.LEGAL_TERMS_URL, version: "2026-11-01" },
        privacy: { url: CLOUD_ENV.LEGAL_PRIVACY_URL, version: "2026-11-01" },
      },
    });
  });

  test("cloud without every required key fails fast, naming each missing key and no value", () => {
    for (const key of CLOUD_REQUIRED_KEYS) {
      const env = { ...CLOUD_ENV, [key]: "" };
      let error: unknown;
      try {
        parseDeploymentConfig(env);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(DeploymentConfigError);
      expect((error as DeploymentConfigError).issues.join(" ")).toContain(key);
    }
    let error: unknown;
    try {
      parseDeploymentConfig({ DEPLOYMENT_MODE: "cloud" });
    } catch (caught) {
      error = caught;
    }
    expect((error as DeploymentConfigError).issues).toHaveLength(CLOUD_REQUIRED_KEYS.length);
  });

  test("cloud rejects a non-http legal URL without echoing it", () => {
    let error: unknown;
    try {
      parseDeploymentConfig({ ...CLOUD_ENV, LEGAL_TERMS_URL: "javascript:alert(1)" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DeploymentConfigError);
    expect((error as Error).message).toContain("LEGAL_TERMS_URL");
    expect((error as Error).message).not.toContain("javascript");
  });
});

describe("deploymentCapabilities", () => {
  test("self-host never offers sign-up", () => {
    expect(deploymentCapabilities({ mode: "self-hosted" })).toEqual({
      mode: "self-hosted",
      signUp: false,
    });
  });

  test("cloud offers sign-up and exposes no legal value", () => {
    const capabilities = deploymentCapabilities(parseDeploymentConfig(CLOUD_ENV));
    expect(capabilities).toEqual({ mode: "cloud", signUp: true });
  });
});
