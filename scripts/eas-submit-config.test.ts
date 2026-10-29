import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type EasJson, submitProblems } from "./eas-submit-config";

type Profile = { environment?: string; env?: Record<string, string>; channel?: string };
const eas = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "apps", "native", "eas.json"), "utf8"),
) as EasJson & { cli: Record<string, unknown>; build: Record<string, Profile> };

describe("apps/native/eas.json (#306)", () => {
  test("build numbers stay remote on EAS", () => {
    expect(eas.cli.appVersionSource).toBe("remote");
  });

  test("each profile reads its own EAS environment", () => {
    expect(eas.build.development?.environment).toBe("development");
    expect(eas.build.preview?.environment).toBe("preview");
    expect(eas.build.production?.environment).toBe("production");
  });

  test("no profile fixes a server or carries a credential (#295)", () => {
    const text = JSON.stringify(eas.build);
    expect(text).not.toContain("EXPO_PUBLIC_SERVER_URL");
    expect(text).not.toMatch(/GOOGLE_SERVICES_JSON|EXPO_TOKEN|\.p8|service-account/i);
  });

  test("Android submits to the internal testing track first", () => {
    expect(eas.submit?.production?.android?.track).toBe("internal");
  });

  test("a placeholder App Store Connect id means iOS is not ready to submit", () => {
    const ascAppId = eas.submit?.production?.ios?.ascAppId;
    // Either the owner filled it in (#304) with the numeric Apple ID, or it
    // is the placeholder the release workflow recognises.
    if (typeof ascAppId === "string" && /^\d+$/.test(ascAppId))
      expect(submitProblems(eas, "ios")).toEqual([]);
    else
      expect(submitProblems(eas, "ios")).toEqual([
        `submit.production.ios.ascAppId is still ${ascAppId}`,
      ]);
  });

  test("submitProblems reports missing and placeholder values", () => {
    expect(submitProblems({}, "ios")).toEqual(["eas.json has no submit.production"]);
    expect(submitProblems({ submit: { production: {} } }, "android")).toEqual([
      "eas.json has no submit.production.android",
    ]);
    expect(
      submitProblems({ submit: { production: { ios: { ascAppId: "1234567890" } } } }, "ios"),
    ).toEqual([]);
    expect(
      submitProblems({ submit: { production: { android: { track: "internal" } } } }, "android"),
    ).toEqual([]);
    expect(
      submitProblems(
        { submit: { production: { android: { serviceAccountKeyPath: "REPLACE_WITH_PATH" } } } },
        "android",
      ),
    ).toEqual([
      "submit.production.android.serviceAccountKeyPath is still REPLACE_WITH_PATH",
      "submit.production.android.track is not set",
    ]);
  });
});
